# app/api/analyze.py
# ============================================================
# Zero Plus — AI Service
# POST /analyze — main pipeline
#
# Pipeline:
#   1) token auth
#   2) cache check (org+ip, TTL from config)
#   3) extract_features
#   4) session_tracker.observe  → drift
#   5) registry.score_and_learn → anomaly + surge
#   6) path_sensitivity
#   7) decision_helper.decide   → recommendation + reasons + future
#   8) clearance_monitor        → optional merge
#   9) phase-2 comparison
#  10) build AnalyzeResponse
#  11) cache write
#
# Non-goals:
#   - Never raises to the caller (FastAPI exception handler catches the rest)
#   - Never blocks on Redis failure (fail-open everywhere)
# ============================================================

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.features.feature_extractor import extract_features
from app.features.path_sensitivity import get_path_sensitivity
from app.features.session_tracker import observe_session
from app.models.model_registry import OrgScoreBundle, get_registry
from app.persistence.redis_client import get_redis
from app.schemas.request import AnalysisPhase, AnalyzeRequest, FutureAction
from app.schemas.response import (
    AnalyzeResponse,
    AnomalyResult,
    ConfidenceLevel,
    FutureGuidance,
    LearningMeta,
    Phase2Comparison,
    PathSensitivityResult as RespPathSensitivity,
    PathSensitivityLevel as RespPathLevel,
    Recommendation,
    ReasonItem,
    SessionDriftResult as RespSessionDrift,
    SurgeResult as RespSurge,
)
from app.services.clearance_monitor import (
    clearance_future,
    clearance_recommendation,
    evaluate_request_clearance,
    merge_recommendation,
)
from app.services.decision_helper import decide_from_parts

logger = logging.getLogger("zero-plus-ai.analyze")

router = APIRouter()


# =============================================================================
# Auth dependency
# =============================================================================

def _verify_token(request: Request, settings: Settings = Depends(get_settings)) -> None:
    """
    بيتحقق من AI_INTERNAL_TOKEN.
    لو الـ token فاضي في الـ config → مفيش check (dev mode).
    """
    expected = (settings.ai_internal_token or "").strip()
    if not expected:
        return
    auth = (request.headers.get("x-ai-token") or "").strip()
    if not auth:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-AI-Token header",
        )
    if not _safe_eq(auth, expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid AI internal token",
        )


def _safe_eq(a: str, b: str) -> bool:
    """Timing-safe compare بدون import hmac هنا."""
    import hmac as _hmac
    return _hmac.compare_digest(
        a.encode("utf-8"),
        b.encode("utf-8"),
    )


# =============================================================================
# Cache helpers
# =============================================================================

def _cache_key(req: AnalyzeRequest) -> str:
    """
    مفتاح الكاش: org + ip + path + method + phase.
    قصير بس كافي للطلبات المتطابقة في نفس اللحظة.
    """
    raw = "|".join([
        str(req.org_id or ""),
        str(req.ip or ""),
        str(req.path or ""),
        str(req.method.value if req.method else ""),
        str(req.phase.value),
    ])
    return "zp:cache:analyze:" + hashlib.sha256(raw.encode()).hexdigest()[:24]


def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    try:
        return get_redis().get_json(key)
    except Exception:
        return None


def _cache_set(key: str, data: Dict[str, Any], ttl: int) -> None:
    try:
        get_redis().set_json(key, data, ttl_sec=ttl)
    except Exception:
        pass


# =============================================================================
# Phase-2 comparison builder
# =============================================================================

def _build_comparison(req: AnalyzeRequest, bundle: OrgScoreBundle) -> Optional[Phase2Comparison]:
    if req.phase != AnalysisPhase.POST_DECISION:
        return None
    gw = req.gateway_outcome
    if gw is None:
        return None

    prev_score = gw.ai_anomaly_score
    prev_rec   = gw.ai_recommendation
    actual     = gw.actual_action

    matched: Optional[bool] = None
    drift_from_pred: Optional[float] = None

    if prev_rec and actual:
        matched = prev_rec.lower() == actual.lower()

    if prev_score is not None:
        try:
            drift_from_pred = round(abs(float(bundle.anomaly.score) - float(prev_score)), 4)
        except (TypeError, ValueError):
            pass

    return Phase2Comparison(
        request_id=gw.request_id,
        previous_anomaly_score=prev_score,
        previous_recommendation=prev_rec,
        actual_action=actual,
        matched=matched,
        drift_from_prediction=drift_from_pred,
        notes=None,
    )


# =============================================================================
# Response builder
# =============================================================================

def _safe_path_level(level_str: Optional[str]) -> RespPathLevel:
    mapping = {
        "low":      RespPathLevel.LOW,
        "medium":   RespPathLevel.MEDIUM,
        "high":     RespPathLevel.HIGH,
        "critical": RespPathLevel.CRITICAL,
    }
    return mapping.get(str(level_str or "").lower(), RespPathLevel.LOW)


def _make_error_response(
    req: AnalyzeRequest,
    error_msg: str,
    start_ms: float,
    model_version: str = "unknown",
) -> AnalyzeResponse:
    """
    Fail-open: لو حاجة اتعطلت في أي خطوة، نرجع allow مع flag.
    """
    logger.error("analyze pipeline error: %s", error_msg)
    return AnalyzeResponse(
        request_id=req.request_id,
        phase=req.phase.value,
        org_id=req.org_id,
        session_id=req.session_id,
        anomaly=AnomalyResult(score=0.0, model_version=model_version),
        session_drift=RespSessionDrift(score=0.0, history_size=0),
        surge=RespSurge(detected=False),
        path_sensitivity=RespPathSensitivity(level=RespPathLevel.LOW),
        recommendation=Recommendation.ALLOW,
        confidence=0.3,
        confidence_level=ConfidenceLevel.LOW,
        reasons=[ReasonItem(
            code="pipeline_error",
            message="Internal error — defaulting to allow (fail-open)",
            weight=0.0,
        )],
        future=FutureGuidance(action=None),
        learning=LearningMeta(
            learned=False,
            model_version=model_version,
            processing_ms=round((time.perf_counter() - start_ms) * 1000, 2),
        ),
        model_version=model_version,
    )


# =============================================================================
# Main pipeline
# =============================================================================

@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Analyze a request and return a recommendation",
    response_model_exclude_none=False,
)
async def analyze(
    req: AnalyzeRequest,
    _auth: None = Depends(_verify_token),
    settings: Settings = Depends(get_settings),
) -> AnalyzeResponse:
    t0 = time.perf_counter()
    model_version = "unknown"

    try:
        # ----------------------------------------------------------------
        # 1) كاش: نفس org+ip+path خلال TTL؟
        # ----------------------------------------------------------------
        cache_key = _cache_key(req)
        if req.phase == AnalysisPhase.PRE_DECISION:
            # الكاش للـ pre_decision بس — post_decision دايماً بيتعالج
            cached = _cache_get(cache_key)
            if cached is not None:
                try:
                    resp = AnalyzeResponse.model_validate(cached)
                    resp.learning.cache_hit = True
                    return resp
                except Exception:
                    pass  # كاش فاسد → نكمل

        # ----------------------------------------------------------------
        # 2) Extract features
        # ----------------------------------------------------------------
        features: Dict[str, float] = extract_features(req)

        # ----------------------------------------------------------------
        # 3) Session drift
        # ----------------------------------------------------------------
        drift_update = observe_session(req, features, store=True, trusted=True)
        drift        = drift_update.drift

        # ----------------------------------------------------------------
        # 4) Score + learn (anomaly + surge)
        # ----------------------------------------------------------------
        registry = get_registry()
        org_id   = (req.org_id or "unknown").strip() or "unknown"

        bundle = registry.score_and_learn(org_id, features)
        model_version = bundle.anomaly.model_version or "unknown"

        # ----------------------------------------------------------------
        # 5) Path sensitivity (قد تكون اتعملت جوه extractor لكن نعيدها)
        # ----------------------------------------------------------------
        path_sens = get_path_sensitivity(req.path, settings=settings)

        # ----------------------------------------------------------------
        # 6) Decision
        # ----------------------------------------------------------------
        decision = decide_from_parts(
            request      = req,
            anomaly      = bundle.anomaly,
            surge        = bundle.surge,
            drift        = drift,
            path         = path_sens,
            settings     = settings,
            processing_ms= bundle.processing_ms,
        )

        # ----------------------------------------------------------------
        # 7) Clearance monitor
        # ----------------------------------------------------------------
        cl_decision = evaluate_request_clearance(
            req,
            identity_key  = drift.identity_key or "",
            drift         = drift,
            anomaly_score = float(bundle.anomaly.score),
            path_level    = path_sens.level,
        )

        # merge recommendation (ENFORCE only — SHADOW يرجع None)
        final_rec = merge_recommendation(
            decision.recommendation,
            clearance_recommendation(cl_decision),
        )

        # future action: clearance يتقدم لو أشد
        cl_future = clearance_future(cl_decision)
        base_future_action = (
            decision.future.action if decision.future else None
        )
        final_future_action = _stronger_future(cl_future, base_future_action)

        final_future = FutureGuidance(
            action     = final_future_action,
            reason     = decision.future.reason if decision.future else None,
            ttl_sec    = decision.future.ttl_sec if decision.future else None,
            confidence = decision.future.confidence if decision.future else None,
        )

        # لو clearance monitor أضاف reason
        extra_reasons: List[ReasonItem] = []
        if cl_decision and cl_decision.action.value != "keep":
            extra_reasons.append(ReasonItem(
                code    = f"clearance_{cl_decision.action.value}",
                message = f"Clearance monitor: {', '.join(cl_decision.reasons[:3])}",
                weight  = min(1.0, cl_decision.points / 10.0),
                meta    = {
                    "points":  cl_decision.points,
                    "streak":  cl_decision.streak,
                    "mode":    cl_decision.mode.value,
                    "would":   cl_decision.would_execute,
                },
            ))

        # ----------------------------------------------------------------
        # 8) Phase-2 comparison
        # ----------------------------------------------------------------
        comparison = _build_comparison(req, bundle)

        # ----------------------------------------------------------------
        # 9) Build response
        # ----------------------------------------------------------------
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

        response = AnalyzeResponse(
            request_id  = req.request_id,
            phase       = req.phase.value,
            org_id      = req.org_id,
            session_id  = req.session_id,

            anomaly         = decision.anomaly,
            session_drift   = decision.session_drift,
            surge           = decision.surge,
            path_sensitivity= decision.path_sensitivity,

            recommendation  = final_rec,
            confidence      = decision.confidence,
            confidence_level= decision.confidence_level,
            reasons         = decision.reasons + extra_reasons,

            future      = final_future,
            comparison  = comparison,

            learning = LearningMeta(
                learned          = bool(bundle.anomaly_learn and bundle.anomaly_learn.learned),
                model_version    = model_version,
                org_model_exists = True,
                cache_hit        = False,
                processing_ms    = elapsed_ms,
            ),
            model_version = model_version,
        )

        # ----------------------------------------------------------------
        # 10) Cache write (pre_decision فقط)
        # ----------------------------------------------------------------
        if req.phase == AnalysisPhase.PRE_DECISION:
            try:
                _cache_set(
                    cache_key,
                    response.model_dump(mode="json"),
                    settings.ai_cache_ttl_sec,
                )
            except Exception:
                pass

        return response

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception("analyze unhandled error req_id=%s: %s", req.request_id, exc)
        return _make_error_response(req, str(exc), t0, model_version)


# =============================================================================
# Helper: أشد future action
# =============================================================================

_FUTURE_SEVERITY: Dict[Optional[FutureAction], int] = {
    None:                                        0,
    FutureAction.ALLOW_NORMAL:                   0,
    FutureAction.MONITOR:                        1,
    FutureAction.RATE_LIMIT:                     2,
    FutureAction.REVALIDATE_CLEARANCE:           3,
    FutureAction.JAVASCRIPT_CHALLENGE:           4,
    FutureAction.ADVANCED_FINGERPRINT_CHECK:     5,
    FutureAction.BLOCK:                          6,
}


def _stronger_future(
    a: Optional[FutureAction],
    b: Optional[FutureAction],
) -> Optional[FutureAction]:
    sa = _FUTURE_SEVERITY.get(a, 0)
    sb = _FUTURE_SEVERITY.get(b, 0)
    return a if sa >= sb else b