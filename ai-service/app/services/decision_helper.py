# app/services/decision_helper.py
# ============================================================
# Zero Plus — AI Service
# Decision helper — fuse signals → recommendation + future
# Fast, deterministic, policy-aligned with Gateway vocabulary
# ============================================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.config import Settings, get_settings
from app.features.path_sensitivity import (
    PathSensitivityLevel,
    PathSensitivityResult,
    get_path_sensitivity,
    sensitivity_to_weight,
)
from app.features.session_tracker import SessionDriftResult
from app.models.base_model import ScoreResult
from app.schemas.request import AnalyzeRequest, FutureAction
from app.schemas.response import (
    AnomalyResult,
    ConfidenceLevel,
    FutureGuidance,
    PathSensitivityResult as RespPathSensitivity,
    Recommendation,
    ReasonItem,
    SessionDriftResult as RespSessionDrift,
    SurgeResult as RespSurge,
)


# =============================================================================
# Input bundle (what /analyze will pass in)
# =============================================================================

@dataclass
class DecisionInput:
    """All signals available at decision time."""

    request: AnalyzeRequest
    anomaly: ScoreResult
    surge: ScoreResult
    drift: SessionDriftResult
    path: Optional[PathSensitivityResult] = None
    # optional overrides from config thresholds already applied upstream
    processing_ms: float = 0.0


@dataclass
class DecisionOutput:
    """Structured decision for response builders."""

    recommendation: Recommendation
    confidence: float
    confidence_level: ConfidenceLevel
    reasons: List[ReasonItem] = field(default_factory=list)
    future: FutureGuidance = field(default_factory=FutureGuidance)
    # echo blocks ready for AnalyzeResponse
    anomaly: Optional[AnomalyResult] = None
    session_drift: Optional[RespSessionDrift] = None
    surge: Optional[RespSurge] = None
    path_sensitivity: Optional[RespPathSensitivity] = None
    # debug / metrics
    scores: Dict[str, float] = field(default_factory=dict)
    flags: Dict[str, bool] = field(default_factory=dict)

    def to_response_parts(self) -> Dict[str, Any]:
        return {
            "recommendation": self.recommendation,
            "confidence": self.confidence,
            "confidence_level": self.confidence_level,
            "reasons": self.reasons,
            "future": self.future,
            "anomaly": self.anomaly,
            "session_drift": self.session_drift,
            "surge": self.surge,
            "path_sensitivity": self.path_sensitivity,
        }


# =============================================================================
# Threshold helpers
# =============================================================================

def _clip01(x: float) -> float:
    if x != x:
        return 0.0
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else float(x)


def _clearance_valid(req: AnalyzeRequest) -> bool:
    c = req.clearance
    if c is None:
        return False
    if c.valid is True and c.revoked is not True and c.expired is not True:
        return True
    return False


def _clearance_present(req: AnalyzeRequest) -> bool:
    c = req.clearance
    if c is None:
        return False
    if c.present is False:
        return False
    return c.present is True or c.valid is True


def _risk_norm(req: AnalyzeRequest) -> float:
    r = req.risk_score_so_far
    if r is None:
        return 0.0
    try:
        return _clip01(float(r) / 100.0)
    except (TypeError, ValueError):
        return 0.0


def _path_level(path: Optional[PathSensitivityResult], req: AnalyzeRequest, settings: Settings) -> PathSensitivityResult:
    if path is not None:
        return path
    return get_path_sensitivity(req.path, settings=settings)


# =============================================================================
# Core decision
# =============================================================================

def decide(inp: DecisionInput, *, settings: Optional[Settings] = None) -> DecisionOutput:
    """
    Fuse anomaly + drift + surge + path + clearance + gateway risk
    into a single recommendation and optional future action.

    Priority (high → low influence on hard actions):
      1) Extreme anomaly / explicit attack-ish combo → BLOCK or STRICT
      2) Valid clearance + high drift/anomaly → REVOKE_CLEARANCE
      3) High path sensitivity + elevated signals → challenge / strict
      4) Surge → rate_limit / monitor
      5) Mild elevation → monitor
      6) Else → allow
    """
    settings = settings or get_settings()
    req = inp.request

    a = _clip01(float(inp.anomaly.score))
    s = _clip01(float(inp.surge.score))
    d = _clip01(float(inp.drift.score))
    risk = _risk_norm(req)
    path_info = _path_level(inp.path, req, settings)
    sens_w = sensitivity_to_weight(path_info.level)

    a_high = settings.anomaly_high_threshold
    a_med = settings.anomaly_medium_threshold
    d_high = settings.session_drift_high_threshold
    d_med = settings.session_drift_medium_threshold
    revoke_on = bool(settings.revoke_on_high_drift)

    clr_valid = _clearance_valid(req)
    clr_present = _clearance_present(req)
    surge_detected = bool(inp.surge.details.get("detected")) if inp.surge.details else (s >= 0.55)

    reasons: List[ReasonItem] = []
    flags = {
        "clearance_valid": clr_valid,
        "clearance_present": clr_present,
        "surge_detected": surge_detected,
        "path_critical": path_info.level == PathSensitivityLevel.CRITICAL,
        "path_high": path_info.level in (PathSensitivityLevel.HIGH, PathSensitivityLevel.CRITICAL),
        "anomaly_high": a >= a_high,
        "anomaly_medium": a_med <= a < a_high,
        "drift_high": d >= d_high,
        "drift_medium": d_med <= d < d_high,
    }

    # --- composite pressure score (for confidence + mild tiers) ---
    pressure = _clip01(
        0.38 * a
        + 0.22 * d
        + 0.18 * s
        + 0.12 * risk
        + 0.10 * sens_w * max(a, d, s)
    )

    # ---------- decision ladder ----------
    rec = Recommendation.ALLOW
    future = FutureGuidance(action=None)

    # 1) Hard block territory
    if a >= 0.93 and (risk >= 0.7 or s >= 0.7 or flags["path_critical"]):
        rec = Recommendation.BLOCK
        reasons.append(ReasonItem(code="extreme_anomaly", message="Anomaly score in extreme range", weight=a))
        if risk >= 0.7:
            reasons.append(ReasonItem(code="high_gateway_risk", message="Gateway risk score is high", weight=risk))
        if s >= 0.7:
            reasons.append(ReasonItem(code="surge_with_anomaly", message="Traffic surge combined with extreme anomaly", weight=s))
        future = FutureGuidance(
            action=FutureAction.BLOCK,
            reason="Recent extreme anomaly — keep blocked briefly",
            ttl_sec=300,
            confidence=0.85,
        )

    # 2) Revoke clearance — core product behaviour
    elif clr_valid and revoke_on and (d >= d_high or (a >= a_high and d >= d_med)):
        rec = Recommendation.REVOKE_CLEARANCE
        reasons.append(ReasonItem(code="clearance_active", message="Request presented valid clearance", weight=1.0))
        if d >= d_high:
            reasons.append(ReasonItem(code="high_session_drift", message="Behaviour changed significantly after clearance", weight=d))
        if a >= a_high:
            reasons.append(ReasonItem(code="high_anomaly_with_clearance", message="High anomaly while cleared", weight=a))
        future = FutureGuidance(
            action=FutureAction.ADVANCED_FINGERPRINT_CHECK
            if flags["path_high"]
            else FutureAction.JAVASCRIPT_CHALLENGE,
            reason="Re-verify client after clearance revoke",
            ttl_sec=600,
            confidence=_clip01(0.55 + 0.4 * max(a, d)),
        )

    # 3) High anomaly without needing revoke
    elif a >= a_high:
        if flags["path_critical"] or flags["path_high"]:
            rec = Recommendation.STRICT
            reasons.append(ReasonItem(code="high_anomaly", message="Anomaly above high threshold", weight=a))
            reasons.append(ReasonItem(code="sensitive_path", message=f"Path sensitivity is {path_info.level.value}", weight=sens_w))
            future = FutureGuidance(
                action=FutureAction.ADVANCED_FINGERPRINT_CHECK,
                reason="Sensitive path + high anomaly",
                ttl_sec=600,
                confidence=_clip01(0.5 + 0.45 * a),
            )
        else:
            rec = Recommendation.ADVANCED_FINGERPRINT
            reasons.append(ReasonItem(code="high_anomaly", message="Anomaly above high threshold", weight=a))
            future = FutureGuidance(
                action=FutureAction.JAVASCRIPT_CHALLENGE,
                reason="Follow-up soft challenge on next request",
                ttl_sec=450,
                confidence=_clip01(0.45 + 0.4 * a),
            )

    # 4) Medium anomaly / drift — path aware
    elif a >= a_med or d >= d_high:
        if flags["path_critical"]:
            rec = Recommendation.JAVASCRIPT_CHALLENGE
            reasons.append(ReasonItem(code="elevated_on_critical_path", message="Elevated signals on critical path", weight=max(a, d)))
            future = FutureGuidance(
                action=FutureAction.MONITOR,
                reason="Watch next requests after challenge",
                ttl_sec=300,
                confidence=0.6,
            )
        elif d >= d_high:
            rec = Recommendation.STRICT if flags["path_high"] else Recommendation.JAVASCRIPT_CHALLENGE
            reasons.append(ReasonItem(code="high_session_drift", message="Session behaviour drifted sharply", weight=d))
            if a >= a_med:
                reasons.append(ReasonItem(code="medium_anomaly", message="Anomaly in medium range", weight=a))
            future = FutureGuidance(
                action=FutureAction.REVALIDATE_CLEARANCE if clr_present else FutureAction.MONITOR,
                reason="Drift requires revalidation path",
                ttl_sec=500,
                confidence=_clip01(0.5 + 0.35 * d),
            )
        else:
            rec = Recommendation.MONITOR if not flags["path_high"] else Recommendation.JAVASCRIPT_CHALLENGE
            reasons.append(ReasonItem(code="medium_anomaly", message="Anomaly in medium range", weight=a))
            if flags["path_high"]:
                reasons.append(ReasonItem(code="sensitive_path", message=f"Path sensitivity is {path_info.level.value}", weight=sens_w))
            future = FutureGuidance(action=FutureAction.MONITOR, reason="Mild elevation", ttl_sec=300, confidence=0.55)

    # 5) Surge-dominant
    elif surge_detected or s >= 0.60:
        if flags["path_critical"] or flags["path_high"]:
            rec = Recommendation.RATE_LIMIT
            reasons.append(ReasonItem(code="surge_on_sensitive_path", message="Traffic surge on sensitive path", weight=s))
            future = FutureGuidance(
                action=FutureAction.RATE_LIMIT,
                reason="Sustain tighter limits briefly",
                ttl_sec=180,
                confidence=_clip01(0.5 + 0.4 * s),
            )
        else:
            rec = Recommendation.RATE_LIMIT if s >= 0.72 else Recommendation.MONITOR
            reasons.append(ReasonItem(code="traffic_surge", message="Elevated traffic intensity detected", weight=s))
            future = FutureGuidance(
                action=FutureAction.MONITOR if s < 0.72 else FutureAction.RATE_LIMIT,
                reason="Post-surge observation",
                ttl_sec=120,
                confidence=_clip01(0.45 + 0.4 * s),
            )

    # 6) Medium drift alone
    elif d >= d_med:
        rec = Recommendation.MONITOR
        reasons.append(ReasonItem(code="medium_session_drift", message="Moderate behaviour change in session", weight=d))
        if clr_valid:
            future = FutureGuidance(
                action=FutureAction.MONITOR,
                reason="Cleared session with mild drift — watch only",
                ttl_sec=400,
                confidence=0.5,
            )
        else:
            future = FutureGuidance(action=None)

    # 7) High gateway risk alone
    elif risk >= 0.65:
        rec = Recommendation.MONITOR if risk < 0.8 else Recommendation.JAVASCRIPT_CHALLENGE
        reasons.append(ReasonItem(code="gateway_risk", message="Gateway risk score elevated", weight=risk))
        future = FutureGuidance(action=FutureAction.MONITOR, reason="Risk follow-up", ttl_sec=240, confidence=0.5)

    # 8) Clean
    else:
        rec = Recommendation.ALLOW
        reasons.append(ReasonItem(code="low_anomaly", message="Behaviour within normal range", weight=1.0 - a))
        if path_info.level in (PathSensitivityLevel.HIGH, PathSensitivityLevel.CRITICAL) and a >= (a_med * 0.6):
            # still allow but keep a soft future watch on sensitive paths
            future = FutureGuidance(
                action=FutureAction.MONITOR,
                reason="Sensitive path with non-zero residual anomaly",
                ttl_sec=180,
                confidence=0.4,
            )
        else:
            future = FutureGuidance(action=None)

    # ensure at least one reason
    if not reasons:
        reasons.append(ReasonItem(code="default", message="Default policy path", weight=0.1))

    # ---------- confidence ----------
    model_conf = _clip01(float(inp.anomaly.confidence or 0.5))
    surge_conf = _clip01(float(inp.surge.confidence or 0.5))
    maturity = 0.55 * model_conf + 0.25 * surge_conf + 0.20 * (1.0 if inp.anomaly.ready else 0.35)
    # sharper decisions when signals agree
    agreement = 1.0 - abs(a - d) * 0.35
    conf = _clip01(0.35 * maturity + 0.40 * max(a, d, s, pressure) * 0.5 + 0.25 * _clip01(agreement) + 0.15)
    # boost confidence on clear allow / clear block
    if rec == Recommendation.ALLOW and a < a_med and d < d_med:
        conf = max(conf, 0.7 * maturity + 0.2)
    if rec in (Recommendation.BLOCK, Recommendation.REVOKE_CLEARANCE):
        conf = max(conf, 0.65)

    conf = _clip01(conf)
    if conf >= 0.75:
        conf_level = ConfidenceLevel.HIGH
    elif conf >= 0.45:
        conf_level = ConfidenceLevel.MEDIUM
    else:
        conf_level = ConfidenceLevel.LOW

    # ---------- response echo blocks ----------
    anomaly_block = AnomalyResult(
        score=a,
        is_high=a >= a_high,
        is_medium=a_med <= a < a_high,
        model_version=inp.anomaly.model_version,
        components={
            "raw": float(inp.anomaly.raw_score) if inp.anomaly.raw_score is not None else a,
            "pressure": pressure,
        },
    )
    drift_block = RespSessionDrift(
        score=d,
        is_high=d >= d_high,
        is_medium=d_med <= d < d_high,
        history_size=int(inp.drift.history_size or 0),
        compared_against=inp.drift.compared_against,
    )
    surge_block = RespSurge(
        detected=surge_detected,
        score=s,
        scope=str((inp.surge.details or {}).get("scope") or "org"),
        hint="high" if s >= 0.72 else ("medium" if s >= 0.45 else "low"),
    )
    path_block = RespPathSensitivity(
        level=_map_path_level(path_info.level),
        path=path_info.path,
        matched_rule=path_info.matched_rule,
    )

    return DecisionOutput(
        recommendation=rec,
        confidence=round(conf, 4),
        confidence_level=conf_level,
        reasons=reasons,
        future=future,
        anomaly=anomaly_block,
        session_drift=drift_block,
        surge=surge_block,
        path_sensitivity=path_block,
        scores={
            "anomaly": a,
            "drift": d,
            "surge": s,
            "risk": risk,
            "path_weight": sens_w,
            "pressure": pressure,
        },
        flags=flags,
    )


def _map_path_level(level: PathSensitivityLevel):
    from app.schemas.response import PathSensitivityLevel as RLevel

    return {
        PathSensitivityLevel.LOW: RLevel.LOW,
        PathSensitivityLevel.MEDIUM: RLevel.MEDIUM,
        PathSensitivityLevel.HIGH: RLevel.HIGH,
        PathSensitivityLevel.CRITICAL: RLevel.CRITICAL,
    }.get(level, RLevel.LOW)


# =============================================================================
# Convenience for analyze.py
# =============================================================================

def decide_from_parts(
    request: AnalyzeRequest,
    anomaly: ScoreResult,
    surge: ScoreResult,
    drift: SessionDriftResult,
    *,
    path: Optional[PathSensitivityResult] = None,
    settings: Optional[Settings] = None,
    processing_ms: float = 0.0,
) -> DecisionOutput:
    return decide(
        DecisionInput(
            request=request,
            anomaly=anomaly,
            surge=surge,
            drift=drift,
            path=path,
            processing_ms=processing_ms,
        ),
        settings=settings,
    )


__all__ = [
    "DecisionInput",
    "DecisionOutput",
    "decide",
    "decide_from_parts",
]