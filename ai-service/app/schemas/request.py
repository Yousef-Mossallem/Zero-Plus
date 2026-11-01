# app/schemas/request.py
# ============================================================
# Zero Plus — AI Service
# Request schemas (Phase 1 + Phase 2)
# Fully optional fields, highly extensible, null-safe
# ============================================================

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# =============================================================================
# Enums — fixed vocabularies (Gateway + AI speak the same language)
# =============================================================================

class AnalysisPhase(str, Enum):
    """Which call is this?"""
    PRE_DECISION = "pre_decision"      # Phase 1: before Gateway decides
    POST_DECISION = "post_decision"    # Phase 2: after Gateway finished


class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"
    HEAD = "HEAD"
    OPTIONS = "OPTIONS"
    OTHER = "OTHER"


class FutureAction(str, Enum):
    """
    Actions the AI may recommend for the *next* request of the same client.
    Gateway stores this in Redis and applies it on the subsequent request.
    Never invent random URLs or "clear all cookies" — only these known actions.
    """
    ALLOW_NORMAL = "allow_normal"
    REVALIDATE_CLEARANCE = "revalidate_clearance"
    JAVASCRIPT_CHALLENGE = "javascript_challenge"
    ADVANCED_FINGERPRINT_CHECK = "advanced_fingerprint_check"
    RATE_LIMIT = "rate_limit"
    MONITOR = "monitor"
    BLOCK = "block"


class ChallengeOutcome(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"
    NOT_APPLICABLE = "not_applicable"


class OriginResultStatus(str, Enum):
    SUCCESS = "success"
    ERROR = "error"
    TIMEOUT = "timeout"
    BLOCKED = "blocked"
    NOT_REACHED = "not_reached"


# =============================================================================
# Nested payloads — one block per Gateway module
# All fields Optional so partial data is always valid
# =============================================================================

class FingerprintAuthPayload(BaseModel):
    """
    From fingerprint-authenticator module.
    Source: authenticateFingerprints / applyFingerprintsToSignals
    """
    model_config = ConfigDict(extra="allow")

    has_usable_device_fp: Optional[bool] = None
    device_fp: Optional[str] = None
    device_fp_source: Optional[str] = None          # header | cookie | none
    ja4: Optional[str] = None
    ja3: Optional[str] = None
    ja4_valid_format: Optional[bool] = None
    ja3_valid_format: Optional[bool] = None
    edge_server_token_ok: Optional[bool] = None
    fingerprint_ban_key: Optional[str] = None
    signals: Optional[Dict[str, Any]] = None        # free-form extra signals


class IpReputationPayload(BaseModel):
    """
    From ip-reputation module.
    Source: inspectIpReputation / ipReputationForAi / geoAnomalyHint
    """
    model_config = ConfigDict(extra="allow")

    score: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    is_tor_exit: Optional[bool] = None
    is_proxy: Optional[bool] = None
    is_datacenter: Optional[bool] = None
    is_known_attacker: Optional[bool] = None
    asn: Optional[int] = None
    asn_org: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    geo_anomaly_hint: Optional[str] = None
    reputation_sources: Optional[List[str]] = None
    raw: Optional[Dict[str, Any]] = None


class RateLimitPayload(BaseModel):
    """
    From rate-limiter module.
    Source: checkRateLimit / resolveRateLimitPolicy
    """
    model_config = ConfigDict(extra="allow")

    limited: Optional[bool] = None
    current_count: Optional[int] = None
    limit: Optional[int] = None
    window_sec: Optional[int] = None
    remaining: Optional[int] = None
    policy_name: Optional[str] = None
    retry_after_sec: Optional[int] = None


class JsChallengeTelemetry(BaseModel):
    """
    From js-challenge module.
    Source: telemetryForAi
    """
    model_config = ConfigDict(extra="allow")

    challenged: Optional[bool] = None
    outcome: Optional[ChallengeOutcome] = None
    solve_time_ms: Optional[float] = None
    min_solve_ms: Optional[float] = None
    max_solve_ms: Optional[float] = None
    suspicion_score: Optional[float] = None
    challenge_id: Optional[str] = None
    hard_failure: Optional[bool] = None
    expired_open: Optional[bool] = None
    raw: Optional[Dict[str, Any]] = None


class AdvancedFingerprintTelemetry(BaseModel):
    """
    From advanced-fingerprint module.
    Source: advancedTelemetryForAi / mergeForAi / evaluateAdvancedFingerprint
    """
    model_config = ConfigDict(extra="allow")

    challenged: Optional[bool] = None
    outcome: Optional[ChallengeOutcome] = None
    score: Optional[float] = None
    fail_threshold: Optional[float] = None
    review_threshold: Optional[float] = None
    ua_family: Optional[str] = None
    ja4_looks_valid: Optional[bool] = None
    ja3_looks_valid: Optional[bool] = None
    ua_tls_consistency: Optional[float] = None
    session_key: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class ClearancePayload(BaseModel):
    """
    From clearance module.
    Source: verifyClearanceFromRequest / resolveClearanceTtlMinutes
    """
    model_config = ConfigDict(extra="allow")

    present: Optional[bool] = None
    valid: Optional[bool] = None
    expired: Optional[bool] = None
    revoked: Optional[bool] = None
    issued_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    ttl_minutes: Optional[int] = None
    source: Optional[str] = None                    # cookie | header | none


class PreviousAiContext(BaseModel):
    """
    What the AI said on a previous call for this client (if any).
    Gateway can send this so the model has continuity.
    """
    model_config = ConfigDict(extra="allow")

    anomaly_score: Optional[float] = None
    recommendation: Optional[str] = None
    future_action: Optional[FutureAction] = None
    model_version: Optional[str] = None
    decided_at: Optional[datetime] = None


# =============================================================================
# Phase 2 only — what actually happened after Gateway decided
# =============================================================================

class GatewayOutcomePayload(BaseModel):
    """
    Feedback block sent in Phase 2 (post_decision).
    Lets the AI compare its earlier recommendation with reality
    and learn + emit a future_action for the next request.
    """
    model_config = ConfigDict(extra="allow")

    # Identity of the earlier AI call
    request_id: Optional[str] = None
    ai_model_version: Optional[str] = None
    ai_anomaly_score: Optional[float] = None
    ai_recommendation: Optional[str] = None

    # What Gateway computed / chose
    gateway_risk_score: Optional[float] = None
    router_decision: Optional[str] = None           # path chosen by suspicion-router
    policy_decision: Optional[str] = None           # final policy outcome
    actual_action: Optional[str] = None             # what was really executed

    # Challenge & origin results
    challenge_result: Optional[ChallengeOutcome] = None
    origin_result: Optional[OriginResultStatus] = None
    origin_status_code: Optional[int] = None
    origin_latency_ms: Optional[float] = None

    # Server pressure at decision time
    server_load: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    server_load_hint: Optional[str] = None            # low | medium | high | critical

    # Any extra free-form notes
    notes: Optional[Dict[str, Any]] = None


# =============================================================================
# Top-level request — one schema for both phases
# =============================================================================

class AnalyzeRequest(BaseModel):
    """
    Unified request body for POST /analyze.

    Phase 1 (pre_decision):
        Gateway sends everything it already knows *before* deciding.
        AI returns anomaly scores + recommended path + optional future_action.

    Phase 2 (post_decision):
        Gateway sends the same identity fields + gateway_outcome.
        AI compares prediction vs reality, learns, and may return a
        future_action that Gateway stores in Redis for the next request
        of the same client.

    Design rules:
    - Almost every field is Optional → partial data never crashes the service.
    - extra="allow" on nested models → new signals can be added without
      breaking old Gateway versions.
    - Null handling is the responsibility of feature_extractor later
      (e.g. missing JA4 → specific feature value + reason flag).
    """

    model_config = ConfigDict(
        extra="allow",          # forward-compatible with future Gateway fields
        str_strip_whitespace=True,
        validate_assignment=True,
    )

    # ------------------------------------------------------------------
    # Required-ish identity (still Optional for maximum safety;
    # feature_extractor / analyze will apply sensible defaults)
    # ------------------------------------------------------------------
    phase: AnalysisPhase = Field(
        default=AnalysisPhase.PRE_DECISION,
        description="pre_decision | post_decision",
    )
    org_id: Optional[str] = Field(default=None, description="Organization / tenant id")
    request_id: Optional[str] = Field(default=None, description="Unique id for this HTTP request")
    session_id: Optional[str] = Field(default=None, description="Client session / visitor id")

    # ------------------------------------------------------------------
    # Core request context
    # ------------------------------------------------------------------
    ip: Optional[str] = None
    path: Optional[str] = None
    method: Optional[HttpMethod] = None
    status_code: Optional[int] = None               # usually null in phase 1
    user_agent: Optional[str] = None
    referer: Optional[str] = None
    content_length: Optional[int] = None
    timestamp: Optional[datetime] = None
    received_at: Optional[datetime] = None

    # ------------------------------------------------------------------
    # TLS / edge fingerprints (top-level shortcuts + full nested block)
    # ------------------------------------------------------------------
    ja4: Optional[str] = None
    ja3: Optional[str] = None
    device_fp: Optional[str] = None

    # ------------------------------------------------------------------
    # Risk so far (Gateway may already have a partial score)
    # ------------------------------------------------------------------
    risk_score_so_far: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    suspicion_level: Optional[str] = None           # low | medium | high | critical

    # ------------------------------------------------------------------
    # Module payloads (all optional)
    # ------------------------------------------------------------------
    fingerprint_auth: Optional[FingerprintAuthPayload] = None
    ip_reputation: Optional[IpReputationPayload] = None
    rate_limit: Optional[RateLimitPayload] = None
    js_challenge: Optional[JsChallengeTelemetry] = None
    advanced_fingerprint: Optional[AdvancedFingerprintTelemetry] = None
    clearance: Optional[ClearancePayload] = None

    # ------------------------------------------------------------------
    # Continuity
    # ------------------------------------------------------------------
    previous_ai: Optional[PreviousAiContext] = None
    future_action_applied: Optional[FutureAction] = Field(
        default=None,
        description="If Gateway applied a previous future_action, tell the AI which one",
    )

    # ------------------------------------------------------------------
    # Phase 2 feedback
    # ------------------------------------------------------------------
    gateway_outcome: Optional[GatewayOutcomePayload] = Field(
        default=None,
        description="Required for real learning in post_decision phase",
    )

    # ------------------------------------------------------------------
    # Free-form escape hatch
    # ------------------------------------------------------------------
    extra: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Any additional signals not yet modeled",
    )

    # ------------------------------------------------------------------
    # Light normalisation
    # ------------------------------------------------------------------
    @field_validator("method", mode="before")
    @classmethod
    def normalise_method(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            v = v.upper().strip()
            if v not in HttpMethod.__members__:
                return HttpMethod.OTHER
        return v

    @field_validator("path", mode="before")
    @classmethod
    def normalise_path(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip() or "/"
            if not v.startswith("/"):
                v = "/" + v
        return v

    @model_validator(mode="after")
    def phase_consistency(self) -> "AnalyzeRequest":
        """
        Soft checks only — we never reject the request.
        Logging / metrics can later warn on inconsistencies.
        """
        # In post_decision it is strongly recommended to send gateway_outcome,
        # but we still accept the call so the pipeline never breaks.
        return self


# =============================================================================
# Convenience helpers (used later by feature_extractor / tests)
# =============================================================================

def empty_analyze_request(**overrides: Any) -> AnalyzeRequest:
    """Create a minimal valid request (everything else null)."""
    return AnalyzeRequest(**overrides)