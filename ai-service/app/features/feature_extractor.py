# app/features/feature_extractor.py
# ============================================================
# Zero Plus — AI Service
# Feature extractor — Request → clean numeric feature dict
# Fast, null-safe, River-ready (Dict[str, float])
# ============================================================

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from app.config import Settings, get_settings
from app.features.path_sensitivity import (
    PathSensitivityLevel,
    get_path_sensitivity,
    sensitivity_to_weight,
)
from app.schemas.request import (
    AdvancedFingerprintTelemetry,
    AnalyzeRequest,
    ChallengeOutcome,
    ClearancePayload,
    FingerprintAuthPayload,
    IpReputationPayload,
    JsChallengeTelemetry,
    RateLimitPayload,
)


# =============================================================================
# Small pure helpers (no I/O — keep it fast)
# =============================================================================

_UA_MOBILE_RE = re.compile(
    r"mobile|android|iphone|ipad|ipod|webos|blackberry|opera mini",
    re.I,
)
_UA_BOT_RE = re.compile(
    r"bot|crawler|spider|slurp|facebookexternalhit|preview|headless|phantom|selenium|puppeteer",
    re.I,
)


def _f(value: Any, default: float = 0.0) -> float:
    """Coerce to float safely."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _b(value: Any) -> float:
    """Bool → 1.0 / 0.0 (None → 0.0)."""
    if value is None:
        return 0.0
    return 1.0 if bool(value) else 0.0


def _present(value: Any) -> float:
    """1.0 if value is not None and not empty string."""
    if value is None:
        return 0.0
    if isinstance(value, str) and not value.strip():
        return 0.0
    return 1.0


def _clip(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _log1p(value: float) -> float:
    return math.log1p(max(0.0, value))


def _hour_features(ts: Optional[datetime]) -> Tuple[float, float, float]:
    """
    Hour of day → continuous features + weekend flag.
    Returns: (hour_sin, hour_cos, is_weekend)
    """
    if ts is None:
        return 0.0, 1.0, 0.0
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    hour = ts.hour + ts.minute / 60.0
    # cycle encoding
    angle = 2.0 * math.pi * (hour / 24.0)
    is_weekend = 1.0 if ts.weekday() >= 5 else 0.0
    return math.sin(angle), math.cos(angle), is_weekend


def _ua_signals(ua: Optional[str]) -> Dict[str, float]:
    if not ua:
        return {
            "ua_present": 0.0,
            "ua_len_log": 0.0,
            "ua_mobile": 0.0,
            "ua_bot_hint": 0.0,
        }
    return {
        "ua_present": 1.0,
        "ua_len_log": _log1p(len(ua)),
        "ua_mobile": 1.0 if _UA_MOBILE_RE.search(ua) else 0.0,
        "ua_bot_hint": 1.0 if _UA_BOT_RE.search(ua) else 0.0,
    }


def _outcome_to_score(outcome: Optional[ChallengeOutcome]) -> float:
    """Map challenge outcome to a suspicion-ish score [0,1]."""
    if outcome is None:
        return 0.0
    return {
        ChallengeOutcome.PASSED: 0.0,
        ChallengeOutcome.SKIPPED: 0.15,
        ChallengeOutcome.NOT_APPLICABLE: 0.0,
        ChallengeOutcome.TIMEOUT: 0.65,
        ChallengeOutcome.FAILED: 0.90,
    }.get(outcome, 0.0)


# =============================================================================
# Block extractors — each returns a flat dict of floats
# =============================================================================

def _extract_path(req: AnalyzeRequest, settings: Settings) -> Dict[str, float]:
    result = get_path_sensitivity(req.path, settings=settings)
    level_weight = sensitivity_to_weight(result.level)

    # one-hot style (helps tree models & River)
    return {
        "path_sens_weight": level_weight,
        "path_sens_low": 1.0 if result.level == PathSensitivityLevel.LOW else 0.0,
        "path_sens_medium": 1.0 if result.level == PathSensitivityLevel.MEDIUM else 0.0,
        "path_sens_high": 1.0 if result.level == PathSensitivityLevel.HIGH else 0.0,
        "path_sens_critical": 1.0 if result.level == PathSensitivityLevel.CRITICAL else 0.0,
        "path_len_log": _log1p(len(result.path or "")),
        "path_depth": float(max(0, (result.path or "/").count("/") - (0 if (result.path or "/").endswith("/") else 0))),
    }


def _extract_core(req: AnalyzeRequest) -> Dict[str, float]:
    method = (req.method.value if req.method else "") or ""
    hour_sin, hour_cos, is_weekend = _hour_features(req.timestamp or req.received_at)

    features = {
        "method_get": 1.0 if method == "GET" else 0.0,
        "method_post": 1.0 if method == "POST" else 0.0,
        "method_other": 1.0 if method not in ("", "GET", "POST") else 0.0,
        "has_body": 1.0 if (req.content_length or 0) > 0 else 0.0,
        "body_len_log": _log1p(_f(req.content_length)),
        "risk_score_norm": _clip(_f(req.risk_score_so_far) / 100.0),
        "hour_sin": hour_sin,
        "hour_cos": hour_cos,
        "is_weekend": is_weekend,
        "ja4_present": _present(req.ja4),
        "ja3_present": _present(req.ja3),
        "device_fp_present": _present(req.device_fp),
    }
    features.update(_ua_signals(req.user_agent))
    return features


def _extract_fingerprint_auth(block: Optional[FingerprintAuthPayload], req: AnalyzeRequest) -> Dict[str, float]:
    if block is None:
        return {
            "fp_auth_present": 0.0,
            "fp_usable_device": 0.0,
            "fp_ja4_valid": 0.0,
            "fp_ja3_valid": 0.0,
            "fp_edge_token_ok": 0.0,
            "fp_device_src_header": 0.0,
            "fp_device_src_cookie": 0.0,
        }

    src = (block.device_fp_source or "").lower()
    return {
        "fp_auth_present": 1.0,
        "fp_usable_device": _b(block.has_usable_device_fp),
        "fp_ja4_valid": _b(block.ja4_valid_format) if block.ja4_valid_format is not None else _present(block.ja4 or req.ja4),
        "fp_ja3_valid": _b(block.ja3_valid_format) if block.ja3_valid_format is not None else _present(block.ja3 or req.ja3),
        "fp_edge_token_ok": _b(block.edge_server_token_ok),
        "fp_device_src_header": 1.0 if src == "header" else 0.0,
        "fp_device_src_cookie": 1.0 if src == "cookie" else 0.0,
    }


def _extract_ip_reputation(block: Optional[IpReputationPayload]) -> Dict[str, float]:
    if block is None:
        return {
            "iprep_present": 0.0,
            "iprep_score_norm": 0.0,
            "iprep_tor": 0.0,
            "iprep_proxy": 0.0,
            "iprep_datacenter": 0.0,
            "iprep_known_attacker": 0.0,
            "iprep_has_geo": 0.0,
            "iprep_geo_anomaly": 0.0,
        }

    score = _f(block.score)  # expected 0..100
    return {
        "iprep_present": 1.0,
        "iprep_score_norm": _clip(score / 100.0),
        "iprep_tor": _b(block.is_tor_exit),
        "iprep_proxy": _b(block.is_proxy),
        "iprep_datacenter": _b(block.is_datacenter),
        "iprep_known_attacker": _b(block.is_known_attacker),
        "iprep_has_geo": 1.0 if (block.country or block.city) else 0.0,
        "iprep_geo_anomaly": 1.0 if block.geo_anomaly_hint else 0.0,
    }


def _extract_rate_limit(block: Optional[RateLimitPayload]) -> Dict[str, float]:
    if block is None:
        return {
            "rl_present": 0.0,
            "rl_limited": 0.0,
            "rl_usage_ratio": 0.0,
            "rl_remaining_norm": 1.0,
        }

    limit = _f(block.limit, default=0.0)
    current = _f(block.current_count, default=0.0)
    remaining = _f(block.remaining, default=-1.0)

    usage = _clip(current / limit) if limit > 0 else 0.0
    rem_norm = _clip(remaining / limit) if limit > 0 and remaining >= 0 else (0.0 if block.limited else 1.0)

    return {
        "rl_present": 1.0,
        "rl_limited": _b(block.limited),
        "rl_usage_ratio": usage,
        "rl_remaining_norm": rem_norm,
    }


def _extract_js_challenge(block: Optional[JsChallengeTelemetry]) -> Dict[str, float]:
    if block is None:
        return {
            "js_present": 0.0,
            "js_challenged": 0.0,
            "js_outcome_score": 0.0,
            "js_hard_failure": 0.0,
            "js_expired_open": 0.0,
            "js_suspicion_norm": 0.0,
            "js_solve_time_norm": 0.0,
            "js_solve_too_fast": 0.0,
            "js_solve_too_slow": 0.0,
        }

    solve = _f(block.solve_time_ms, default=-1.0)
    min_ms = _f(block.min_solve_ms, default=0.0)
    max_ms = _f(block.max_solve_ms, default=0.0)

    # normalize solve time into 0..1 against provided bounds when possible
    if solve >= 0 and max_ms > min_ms > 0:
        solve_norm = _clip((solve - min_ms) / (max_ms - min_ms))
        too_fast = 1.0 if solve < min_ms else 0.0
        too_slow = 1.0 if solve > max_ms else 0.0
    elif solve >= 0:
        # fallback heuristic: 0..10s window
        solve_norm = _clip(solve / 10000.0)
        too_fast = 1.0 if solve < 50 else 0.0
        too_slow = 1.0 if solve > 15000 else 0.0
    else:
        solve_norm, too_fast, too_slow = 0.0, 0.0, 0.0

    suspicion = _f(block.suspicion_score)
    # suspicion may already be 0..1 or 0..100 — normalize gently
    if suspicion > 1.0:
        suspicion = _clip(suspicion / 100.0)

    return {
        "js_present": 1.0,
        "js_challenged": _b(block.challenged),
        "js_outcome_score": _outcome_to_score(block.outcome),
        "js_hard_failure": _b(block.hard_failure),
        "js_expired_open": _b(block.expired_open),
        "js_suspicion_norm": _clip(suspicion),
        "js_solve_time_norm": solve_norm,
        "js_solve_too_fast": too_fast,
        "js_solve_too_slow": too_slow,
    }


def _extract_advanced_fp(block: Optional[AdvancedFingerprintTelemetry]) -> Dict[str, float]:
    if block is None:
        return {
            "adv_present": 0.0,
            "adv_challenged": 0.0,
            "adv_outcome_score": 0.0,
            "adv_score_norm": 0.0,
            "adv_ua_tls_consistency": 0.5,   # neutral when unknown
            "adv_ja4_valid": 0.0,
            "adv_ja3_valid": 0.0,
            "adv_above_fail": 0.0,
            "adv_above_review": 0.0,
        }

    score = _f(block.score)
    fail_th = _f(block.fail_threshold, default=0.0)
    review_th = _f(block.review_threshold, default=0.0)

    # normalize score if it looks like 0..100
    score_norm = _clip(score / 100.0) if score > 1.0 else _clip(score)

    consistency = block.ua_tls_consistency
    if consistency is None:
        cons_norm = 0.5
    else:
        cons_norm = _clip(_f(consistency) / 100.0) if _f(consistency) > 1.0 else _clip(_f(consistency))

    return {
        "adv_present": 1.0,
        "adv_challenged": _b(block.challenged),
        "adv_outcome_score": _outcome_to_score(block.outcome),
        "adv_score_norm": score_norm,
        "adv_ua_tls_consistency": cons_norm,
        "adv_ja4_valid": _b(block.ja4_looks_valid),
        "adv_ja3_valid": _b(block.ja3_looks_valid),
        "adv_above_fail": 1.0 if (fail_th > 0 and score >= fail_th) else 0.0,
        "adv_above_review": 1.0 if (review_th > 0 and score >= review_th) else 0.0,
    }


def _extract_clearance(block: Optional[ClearancePayload]) -> Dict[str, float]:
    if block is None:
        return {
            "clr_present": 0.0,
            "clr_valid": 0.0,
            "clr_expired": 0.0,
            "clr_revoked": 0.0,
            "clr_has_ttl": 0.0,
        }

    return {
        "clr_present": _b(block.present) if block.present is not None else 1.0,
        "clr_valid": _b(block.valid),
        "clr_expired": _b(block.expired),
        "clr_revoked": _b(block.revoked),
        "clr_has_ttl": 1.0 if block.ttl_minutes is not None else 0.0,
    }


def _extract_continuity(req: AnalyzeRequest) -> Dict[str, float]:
    prev = req.previous_ai
    if prev is None:
        return {
            "prev_ai_present": 0.0,
            "prev_anomaly": 0.0,
            "prev_has_future_action": 0.0,
            "future_action_applied": 0.0,
        }

    return {
        "prev_ai_present": 1.0,
        "prev_anomaly": _clip(_f(prev.anomaly_score)),
        "prev_has_future_action": 1.0 if prev.future_action is not None else 0.0,
        "future_action_applied": 1.0 if req.future_action_applied is not None else 0.0,
    }


def _extract_phase2(req: AnalyzeRequest) -> Dict[str, float]:
    """Light signals from gateway_outcome (useful even in pre if sent)."""
    go = req.gateway_outcome
    if go is None:
        return {
            "p2_present": 0.0,
            "p2_origin_latency_log": 0.0,
            "p2_server_load": 0.0,
            "p2_challenge_failed": 0.0,
            "p2_origin_error": 0.0,
        }

    latency = _f(go.origin_latency_ms, default=-1.0)
    load = _f(go.server_load)
    ch_failed = 1.0 if go.challenge_result in (
        ChallengeOutcome.FAILED,
        ChallengeOutcome.TIMEOUT,
    ) else 0.0

    origin_err = 0.0
    if go.origin_result is not None:
        origin_err = 1.0 if go.origin_result.value in ("error", "timeout", "blocked") else 0.0

    return {
        "p2_present": 1.0,
        "p2_origin_latency_log": _log1p(latency) if latency >= 0 else 0.0,
        "p2_server_load": _clip(load),
        "p2_challenge_failed": ch_failed,
        "p2_origin_error": origin_err,
    }


# =============================================================================
# Public API
# =============================================================================

def extract_features(
    req: AnalyzeRequest,
    *,
    settings: Optional[Settings] = None,
) -> Dict[str, float]:
    """
    Convert an AnalyzeRequest into a flat Dict[str, float] ready for River.

    Properties:
    - Every value is a finite float
    - Missing blocks → explicit zeros / neutral defaults (never KeyError later)
    - Fast: pure CPU, no I/O, no allocations beyond the dict
    - Stable feature names (model can rely on the same keys over time)
    """
    settings = settings or get_settings()

    features: Dict[str, float] = {}
    features.update(_extract_core(req))
    features.update(_extract_path(req, settings))
    features.update(_extract_fingerprint_auth(req.fingerprint_auth, req))
    features.update(_extract_ip_reputation(req.ip_reputation))
    features.update(_extract_rate_limit(req.rate_limit))
    features.update(_extract_js_challenge(req.js_challenge))
    features.update(_extract_advanced_fp(req.advanced_fingerprint))
    features.update(_extract_clearance(req.clearance))
    features.update(_extract_continuity(req))
    features.update(_extract_phase2(req))

    # Phase flag (useful for the model to know context)
    phase = (req.phase.value if req.phase else "pre_decision")
    features["phase_pre"] = 1.0 if phase == "pre_decision" else 0.0
    features["phase_post"] = 1.0 if phase == "post_decision" else 0.0

    # Final safety: no NaN/Inf
    for k, v in list(features.items()):
        if not math.isfinite(v):
            features[k] = 0.0

    return features


def feature_names() -> Tuple[str, ...]:
    """
    Deterministic list of feature names (from an empty request).
    Useful for tests and documentation.
    """
    empty = AnalyzeRequest()
    return tuple(sorted(extract_features(empty).keys()))


__all__ = [
    "extract_features",
    "feature_names",
]