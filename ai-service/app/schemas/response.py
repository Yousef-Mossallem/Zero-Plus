# app/schemas/response.py
# ============================================================
# Zero Plus — AI Service
# Response schemas (Phase 1 + Phase 2)
# Complete, extensible, production-grade
# ============================================================

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.request import FutureAction


# =============================================================================
# Enums
# =============================================================================

class Recommendation(str, Enum):
    """
    Immediate recommendation for *this* request (Phase 1).
    Gateway maps it to a known path — never to random URLs.
    """
    ALLOW = "allow"                                 # full pass
    MONITOR = "monitor"                             # allow but watch
    RATE_LIMIT = "rate_limit"                       # apply tighter limits
    JAVASCRIPT_CHALLENGE = "javascript_challenge"   # silent / soft JS
    ADVANCED_FINGERPRINT = "advanced_fingerprint"   # advanced check
    STRICT = "strict"                               # strong challenge / extra scrutiny
    REVOKE_CLEARANCE = "revoke_clearance"           # kill current clearance
    BLOCK = "block"                                 # hard block


class PathSensitivityLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ConfidenceLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# =============================================================================
# Nested result blocks
# =============================================================================

class AnomalyResult(BaseModel):
    """Core anomaly output from the online model."""
    model_config = ConfigDict(extra="allow")

    score: float = Field(..., ge=0.0, le=1.0, description="0 = normal, 1 = highly anomalous")
    is_high: bool = Field(default=False)
    is_medium: bool = Field(default=False)
    model_version: Optional[str] = None
    components: Optional[Dict[str, float]] = Field(
        default=None,
        description="Optional per-feature contribution / sub-scores",
    )


class SessionDriftResult(BaseModel):
    """How different this request is from the recent behaviour of the same session."""
    model_config = ConfigDict(extra="allow")

    score: float = Field(..., ge=0.0, le=1.0)
    is_high: bool = Field(default=False)
    is_medium: bool = Field(default=False)
    history_size: int = Field(default=0, ge=0)
    compared_against: Optional[str] = Field(
        default=None,
        description="session_id or composite key used for comparison",
    )


class SurgeResult(BaseModel):
    """Traffic surge / drift detection at org or path level."""
    model_config = ConfigDict(extra="allow")

    detected: bool = Field(default=False)
    score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    scope: Optional[str] = Field(default=None, description="org | path | ip | global")
    hint: Optional[str] = None


class PathSensitivityResult(BaseModel):
    """Sensitivity of the requested path."""
    model_config = ConfigDict(extra="allow")

    level: PathSensitivityLevel = Field(default=PathSensitivityLevel.LOW)
    path: Optional[str] = None
    matched_rule: Optional[str] = None


class ReasonItem(BaseModel):
    """Single human/machine readable reason for the decision."""
    model_config = ConfigDict(extra="allow")

    code: str = Field(..., description="Stable machine code, e.g. high_anomaly, ja4_missing")
    message: str = Field(..., description="Short human-readable explanation")
    weight: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    meta: Optional[Dict[str, Any]] = None


class FutureGuidance(BaseModel):
    """
    What Gateway should do on the *next* request of the same client.
    Stored by Gateway in Redis (keyed by org + client identity).
    If the AI has nothing special to say → action = null / none.
    """
    model_config = ConfigDict(extra="allow")

    action: Optional[FutureAction] = Field(
        default=None,
        description="null / omitted = no special future action (treat as none)",
    )
    reason: Optional[str] = None
    ttl_sec: Optional[int] = Field(
        default=None,
        ge=1,
        description="Suggested Redis TTL for this future action",
    )
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class LearningMeta(BaseModel):
    """Metadata about what the model did with this request."""
    model_config = ConfigDict(extra="allow")

    learned: bool = Field(default=False, description="Did the model call learn_one?")
    model_version: Optional[str] = None
    org_model_exists: bool = Field(default=False)
    cache_hit: bool = Field(default=False)
    processing_ms: Optional[float] = None


class Phase2Comparison(BaseModel):
    """
    Only meaningful in post_decision responses.
    Shows how the earlier AI recommendation compared with reality.
    """
    model_config = ConfigDict(extra="allow")

    request_id: Optional[str] = None
    previous_anomaly_score: Optional[float] = None
    previous_recommendation: Optional[str] = None
    actual_action: Optional[str] = None
    matched: Optional[bool] = Field(
        default=None,
        description="True if AI recommendation roughly matched what Gateway did",
    )
    drift_from_prediction: Optional[float] = None
    notes: Optional[str] = None


# =============================================================================
# Top-level response
# =============================================================================

class AnalyzeResponse(BaseModel):
    """
    Unified response for POST /analyze (both phases).

    Phase 1 (pre_decision):
        - anomaly, session_drift, surge, path_sensitivity
        - recommendation (immediate path for *this* request)
        - reasons[]
        - future (optional guidance for the *next* request)
        - learning meta

    Phase 2 (post_decision):
        - same core fields (model may update scores after seeing outcome)
        - comparison block
        - future action is especially important here
          (Gateway will store it in Redis for the next request)
    """

    model_config = ConfigDict(
        extra="allow",
        str_strip_whitespace=True,
    )

    # ------------------------------------------------------------------
    # Identity / correlation
    # ------------------------------------------------------------------
    request_id: Optional[str] = Field(
        default=None,
        description="Echo of the incoming request_id so Gateway can correlate",
    )
    phase: Optional[str] = Field(
        default=None,
        description="pre_decision | post_decision (echo)",
    )
    org_id: Optional[str] = None
    session_id: Optional[str] = None

    # ------------------------------------------------------------------
    # Core AI outputs
    # ------------------------------------------------------------------
    anomaly: AnomalyResult
    session_drift: SessionDriftResult
    surge: SurgeResult = Field(default_factory=SurgeResult)
    path_sensitivity: PathSensitivityResult = Field(default_factory=PathSensitivityResult)

    # ------------------------------------------------------------------
    # Decision
    # ------------------------------------------------------------------
    recommendation: Recommendation = Field(
        ...,
        description="Immediate action Gateway should consider for *this* request",
    )
    confidence: float = Field(..., ge=0.0, le=1.0)
    confidence_level: ConfidenceLevel = Field(default=ConfidenceLevel.MEDIUM)
    reasons: List[ReasonItem] = Field(default_factory=list)

    # ------------------------------------------------------------------
    # Future guidance (for the next request of the same client)
    # ------------------------------------------------------------------
    future: FutureGuidance = Field(
        default_factory=FutureGuidance,
        description="action=null means 'none' — no special treatment next time",
    )

    # ------------------------------------------------------------------
    # Phase 2 extras
    # ------------------------------------------------------------------
    comparison: Optional[Phase2Comparison] = Field(
        default=None,
        description="Only populated in post_decision responses",
    )

    # ------------------------------------------------------------------
    # Meta
    # ------------------------------------------------------------------
    learning: LearningMeta = Field(default_factory=LearningMeta)
    model_version: Optional[str] = None
    ts: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp of this AI response",
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @model_validator(mode="after")
    def derive_flags_and_levels(self) -> "AnalyzeResponse":
        # Derive is_high / is_medium on anomaly if caller only set score
        if self.anomaly:
            if self.anomaly.score >= 0.75:
                self.anomaly.is_high = True
            elif self.anomaly.score >= 0.45:
                self.anomaly.is_medium = True

        if self.session_drift:
            if self.session_drift.score >= 0.60:
                self.session_drift.is_high = True
            elif self.session_drift.score >= 0.35:
                self.session_drift.is_medium = True

        # Confidence level from numeric confidence
        if self.confidence >= 0.75:
            self.confidence_level = ConfidenceLevel.HIGH
        elif self.confidence >= 0.45:
            self.confidence_level = ConfidenceLevel.MEDIUM
        else:
            self.confidence_level = ConfidenceLevel.LOW

        return self


# =============================================================================
# Convenience constructors (useful in tests and later in decision_helper)
# =============================================================================

def make_allow_response(
    *,
    request_id: Optional[str] = None,
    anomaly_score: float = 0.1,
    drift_score: float = 0.05,
    model_version: str = "bootstrap",
) -> AnalyzeResponse:
    """Quick normal response."""
    return AnalyzeResponse(
        request_id=request_id,
        phase="pre_decision",
        anomaly=AnomalyResult(score=anomaly_score, model_version=model_version),
        session_drift=SessionDriftResult(score=drift_score, history_size=0),
        recommendation=Recommendation.ALLOW,
        confidence=0.85,
        reasons=[ReasonItem(code="low_anomaly", message="Behaviour looks normal")],
        future=FutureGuidance(action=None),
        model_version=model_version,
        learning=LearningMeta(learned=False, model_version=model_version),
    )


def make_revoke_response(
    *,
    request_id: Optional[str] = None,
    anomaly_score: float = 0.88,
    drift_score: float = 0.72,
    model_version: str = "bootstrap",
) -> AnalyzeResponse:
    """Example of strong suspicion after clearance."""
    return AnalyzeResponse(
        request_id=request_id,
        phase="pre_decision",
        anomaly=AnomalyResult(score=anomaly_score, model_version=model_version),
        session_drift=SessionDriftResult(score=drift_score, history_size=4),
        recommendation=Recommendation.REVOKE_CLEARANCE,
        confidence=0.91,
        reasons=[
            ReasonItem(code="high_anomaly", message="Anomaly score above threshold"),
            ReasonItem(code="high_session_drift", message="Behaviour changed significantly after clearance"),
        ],
        future=FutureGuidance(
            action=FutureAction.ADVANCED_FINGERPRINT_CHECK,
            reason="Re-check fingerprint on next request",
            ttl_sec=600,
            confidence=0.8,
        ),
        model_version=model_version,
        learning=LearningMeta(learned=True, model_version=model_version),
    )