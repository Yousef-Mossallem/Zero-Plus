# app/models/base_model.py
# ============================================================
# Zero Plus — AI Service
# Base model contract for all online learners
# Standard, versioned, serializable, org-aware
# ============================================================

from __future__ import annotations

import abc
import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

logger = logging.getLogger("zero-plus-ai.models")


# =============================================================================
# Types & constants
# =============================================================================

FeatureDict = Dict[str, float]
PathLike = Union[str, Path]


class ModelKind(str, Enum):
    ANOMALY = "anomaly"
    SURGE = "surge"
    GENERIC = "generic"


class ModelState(str, Enum):
    NEW = "new"                 # just created, never learned
    WARMING = "warming"         # below min_samples
    READY = "ready"             # usable for decisions
    STALE = "stale"             # not updated for a long time
    ERROR = "error"             # last operation failed
    DISABLED = "disabled"


# =============================================================================
# Metadata
# =============================================================================

@dataclass
class ModelMeta:
    """
    Immutable-ish identity + runtime counters for a model instance.
    Stored alongside the algorithm payload on disk / in registry.
    """

    org_id: str
    kind: ModelKind = ModelKind.GENERIC
    name: str = "base"
    version: str = "1"
    algorithm: str = "unknown"

    created_at: float = field(default_factory=lambda: time.time())
    updated_at: float = field(default_factory=lambda: time.time())
    last_score_at: Optional[float] = None
    last_learn_at: Optional[float] = None

    n_learned: int = 0
    n_scored: int = 0
    n_saved: int = 0
    n_loaded: int = 0

    min_samples_ready: int = 20
    feature_dim: int = 0
    feature_keys_hash: Optional[str] = None
    state: ModelState = ModelState.NEW

    extra: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------
    def touch_score(self) -> None:
        self.last_score_at = time.time()
        self.n_scored += 1
        self.updated_at = self.last_score_at

    def touch_learn(self) -> None:
        self.last_learn_at = time.time()
        self.n_learned += 1
        self.updated_at = self.last_learn_at
        if self.state in (ModelState.NEW, ModelState.WARMING):
            if self.n_learned >= self.min_samples_ready:
                self.state = ModelState.READY
            else:
                self.state = ModelState.WARMING

    def touch_save(self) -> None:
        self.n_saved += 1
        self.updated_at = time.time()

    def touch_load(self) -> None:
        self.n_loaded += 1
        self.updated_at = time.time()

    def mark_error(self, message: str) -> None:
        self.state = ModelState.ERROR
        self.extra["last_error"] = message
        self.extra["last_error_at"] = time.time()
        self.updated_at = time.time()

    def mark_ready(self) -> None:
        if self.state != ModelState.DISABLED:
            self.state = ModelState.READY
            self.updated_at = time.time()

    def mark_disabled(self) -> None:
        self.state = ModelState.DISABLED
        self.updated_at = time.time()

    @property
    def is_ready(self) -> bool:
        return self.state == ModelState.READY and self.n_learned >= self.min_samples_ready

    @property
    def age_sec(self) -> float:
        return max(0.0, time.time() - self.created_at)

    @property
    def idle_sec(self) -> float:
        ref = self.last_learn_at or self.created_at
        return max(0.0, time.time() - ref)

    @property
    def model_id(self) -> str:
        """Stable id: org + kind + name + version."""
        raw = f"{self.org_id}:{self.kind.value}:{self.name}:{self.version}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["kind"] = self.kind.value
        d["state"] = self.state.value
        d["model_id"] = self.model_id
        d["is_ready"] = self.is_ready
        return d

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ModelMeta":
        kind = data.get("kind", ModelKind.GENERIC)
        if isinstance(kind, str):
            kind = ModelKind(kind)
        state = data.get("state", ModelState.NEW)
        if isinstance(state, str):
            state = ModelState(state)
        return cls(
            org_id=str(data.get("org_id", "unknown")),
            kind=kind,
            name=str(data.get("name", "base")),
            version=str(data.get("version", "1")),
            algorithm=str(data.get("algorithm", "unknown")),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            last_score_at=_opt_float(data.get("last_score_at")),
            last_learn_at=_opt_float(data.get("last_learn_at")),
            n_learned=int(data.get("n_learned", 0)),
            n_scored=int(data.get("n_scored", 0)),
            n_saved=int(data.get("n_saved", 0)),
            n_loaded=int(data.get("n_loaded", 0)),
            min_samples_ready=int(data.get("min_samples_ready", 20)),
            feature_dim=int(data.get("feature_dim", 0)),
            feature_keys_hash=data.get("feature_keys_hash"),
            state=state,
            extra=dict(data.get("extra") or {}),
        )


def _opt_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def hash_feature_keys(keys: Sequence[str]) -> str:
    payload = "|".join(sorted(keys))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


# =============================================================================
# Score / learn result wrappers
# =============================================================================

@dataclass
class ScoreResult:
    """Normalized output of score_one."""

    score: float                              # typically 0..1 (higher = more anomalous / more surge)
    raw_score: Optional[float] = None         # algorithm-native value before normalization
    confidence: float = 0.5                   # how much we trust this score given model maturity
    ready: bool = False
    model_version: Optional[str] = None
    model_id: Optional[str] = None
    org_id: Optional[str] = None
    kind: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=lambda: time.time())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "score": self.score,
            "raw_score": self.raw_score,
            "confidence": self.confidence,
            "ready": self.ready,
            "model_version": self.model_version,
            "model_id": self.model_id,
            "org_id": self.org_id,
            "kind": self.kind,
            "details": self.details,
            "ts": self.ts,
        }


@dataclass
class LearnResult:
    """Output of learn_one."""

    learned: bool
    n_learned: int
    state: ModelState
    model_version: Optional[str] = None
    model_id: Optional[str] = None
    message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "learned": self.learned,
            "n_learned": self.n_learned,
            "state": self.state.value,
            "model_version": self.model_version,
            "model_id": self.model_id,
            "message": self.message,
        }


# =============================================================================
# Feature sanitization (shared by all models)
# =============================================================================

def sanitize_features(
    features: Mapping[str, Any],
    *,
    allowed_keys: Optional[Sequence[str]] = None,
    fill_missing: float = 0.0,
) -> FeatureDict:
    """
    Ensure a clean Dict[str, float]:
    - drop non-finite values
    - coerce to float
    - optionally restrict / pad to allowed_keys
    """
    clean: FeatureDict = {}

    if allowed_keys is not None:
        for k in allowed_keys:
            v = features.get(k, fill_missing)
            try:
                fv = float(v)
                if not _isfinite(fv):
                    fv = fill_missing
            except (TypeError, ValueError):
                fv = fill_missing
            clean[str(k)] = fv
        return clean

    for k, v in features.items():
        try:
            fv = float(v)
            if not _isfinite(fv):
                continue
            clean[str(k)] = fv
        except (TypeError, ValueError):
            continue
    return clean


def _isfinite(x: float) -> bool:
    return x == x and x not in (float("inf"), float("-inf"))


# =============================================================================
# Abstract base model
# =============================================================================

class BaseOnlineModel(abc.ABC):
    """
    Contract for every online model in Zero Plus AI Service.

    Subclasses MUST implement:
      - _score_impl(features) -> (normalized_score, raw_score, details)
      - _learn_impl(features) -> None
      - _get_algorithm_state() / _set_algorithm_state(...) for persistence
      - _create_fresh_algorithm() for bootstrap

    Optional overrides:
      - normalize_raw_score
      - compute_confidence
      - on_after_learn / on_after_score
    """

    kind: ModelKind = ModelKind.GENERIC
    default_name: str = "base"
    algorithm_name: str = "unknown"

    def __init__(
        self,
        org_id: str,
        *,
        name: Optional[str] = None,
        version: str = "1",
        min_samples_ready: int = 20,
        feature_keys: Optional[Sequence[str]] = None,
        meta: Optional[ModelMeta] = None,
        **kwargs: Any,
    ) -> None:
        self.org_id = str(org_id or "unknown")
        self._feature_keys: Optional[List[str]] = (
            list(feature_keys) if feature_keys else None
        )
        self._algorithm: Any = None
        self._last_error: Optional[str] = None

        if meta is not None:
            self.meta = meta
            self.meta.org_id = self.org_id
        else:
            self.meta = ModelMeta(
                org_id=self.org_id,
                kind=self.kind,
                name=name or self.default_name,
                version=str(version),
                algorithm=self.algorithm_name,
                min_samples_ready=int(min_samples_ready),
                feature_dim=len(self._feature_keys) if self._feature_keys else 0,
                feature_keys_hash=(
                    hash_feature_keys(self._feature_keys) if self._feature_keys else None
                ),
                state=ModelState.NEW,
            )

        # Bootstrap algorithm instance
        try:
            self._algorithm = self._create_fresh_algorithm(**kwargs)
        except Exception as exc:
            self._last_error = str(exc)
            self.meta.mark_error(str(exc))
            logger.exception("Failed to create algorithm for %s", self.meta.model_id)
            raise

    # ------------------------------------------------------------------
    # Public API — used by registry / analyze
    # ------------------------------------------------------------------

    def score_one(self, features: Mapping[str, Any]) -> ScoreResult:
        """
        Score a single feature dict.
        Never raises to the caller for normal numeric issues; returns safe defaults on failure.
        """
        if self.meta.state == ModelState.DISABLED:
            return ScoreResult(
                score=0.0,
                confidence=0.0,
                ready=False,
                model_version=self.meta.version,
                model_id=self.meta.model_id,
                org_id=self.org_id,
                kind=self.kind.value,
                details={"disabled": True},
            )

        try:
            clean = sanitize_features(features, allowed_keys=self._feature_keys)
            if self._feature_keys is None and clean:
                # lock schema on first real observation
                self._feature_keys = sorted(clean.keys())
                self.meta.feature_dim = len(self._feature_keys)
                self.meta.feature_keys_hash = hash_feature_keys(self._feature_keys)

            norm, raw, details = self._score_impl(clean)
            norm = self._clip01(float(norm))
            conf = self.compute_confidence(norm, raw, details)

            self.meta.touch_score()
            self.on_after_score(clean, norm, raw)

            return ScoreResult(
                score=norm,
                raw_score=raw,
                confidence=conf,
                ready=self.meta.is_ready,
                model_version=self.meta.version,
                model_id=self.meta.model_id,
                org_id=self.org_id,
                kind=self.kind.value,
                details=details or {},
            )
        except Exception as exc:
            self._last_error = str(exc)
            self.meta.mark_error(str(exc))
            logger.exception("score_one failed for %s", self.meta.model_id)
            return ScoreResult(
                score=0.0,
                confidence=0.0,
                ready=False,
                model_version=self.meta.version,
                model_id=self.meta.model_id,
                org_id=self.org_id,
                kind=self.kind.value,
                details={"error": str(exc)},
            )

    def learn_one(self, features: Mapping[str, Any]) -> LearnResult:
        """
        Online update from a single feature dict.
        """
        if self.meta.state == ModelState.DISABLED:
            return LearnResult(
                learned=False,
                n_learned=self.meta.n_learned,
                state=self.meta.state,
                model_version=self.meta.version,
                model_id=self.meta.model_id,
                message="disabled",
            )

        try:
            clean = sanitize_features(features, allowed_keys=self._feature_keys)
            if self._feature_keys is None and clean:
                self._feature_keys = sorted(clean.keys())
                self.meta.feature_dim = len(self._feature_keys)
                self.meta.feature_keys_hash = hash_feature_keys(self._feature_keys)

            self._learn_impl(clean)
            self.meta.touch_learn()
            self.on_after_learn(clean)

            return LearnResult(
                learned=True,
                n_learned=self.meta.n_learned,
                state=self.meta.state,
                model_version=self.meta.version,
                model_id=self.meta.model_id,
                message=None,
            )
        except Exception as exc:
            self._last_error = str(exc)
            self.meta.mark_error(str(exc))
            logger.exception("learn_one failed for %s", self.meta.model_id)
            return LearnResult(
                learned=False,
                n_learned=self.meta.n_learned,
                state=self.meta.state,
                model_version=self.meta.version,
                model_id=self.meta.model_id,
                message=str(exc),
            )

    def score_and_learn(self, features: Mapping[str, Any]) -> Tuple[ScoreResult, LearnResult]:
        """
        Convenience: score first (on current state), then learn.
        Typical online anomaly pattern.
        """
        score = self.score_one(features)
        learn = self.learn_one(features)
        return score, learn

    def learn_many(self, batch: Iterable[Mapping[str, Any]]) -> int:
        """Batch online updates. Returns number of successful learns."""
        ok = 0
        for item in batch:
            if self.learn_one(item).learned:
                ok += 1
        return ok

    # ------------------------------------------------------------------
    # Persistence helpers (payload format shared with model_store)
    # ------------------------------------------------------------------

    def export_state(self) -> Dict[str, Any]:
        """
        Full serializable snapshot:
          { meta, feature_keys, algorithm }
        """
        return {
            "format": "zero-plus-model-v1",
            "meta": self.meta.to_dict(),
            "feature_keys": list(self._feature_keys) if self._feature_keys else None,
            "algorithm": self._get_algorithm_state(),
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }

    def import_state(self, payload: Mapping[str, Any]) -> None:
        """Restore from export_state payload."""
        if not isinstance(payload, Mapping):
            raise ValueError("payload must be a mapping")

        meta_raw = payload.get("meta") or {}
        self.meta = ModelMeta.from_dict(meta_raw)
        self.meta.org_id = self.org_id  # keep constructor org authoritative if needed

        keys = payload.get("feature_keys")
        self._feature_keys = list(keys) if keys else None
        if self._feature_keys:
            self.meta.feature_dim = len(self._feature_keys)
            self.meta.feature_keys_hash = hash_feature_keys(self._feature_keys)

        algo_state = payload.get("algorithm")
        if algo_state is not None:
            self._set_algorithm_state(algo_state)
        else:
            self._algorithm = self._create_fresh_algorithm()

        self.meta.touch_load()
        if self.meta.n_learned >= self.meta.min_samples_ready and self.meta.state != ModelState.DISABLED:
            self.meta.state = ModelState.READY
        elif self.meta.n_learned > 0 and self.meta.state != ModelState.DISABLED:
            self.meta.state = ModelState.WARMING

    def save_json(self, path: PathLike) -> Path:
        """Debug-friendly JSON dump (algorithm may be large / partial). Prefer joblib via model_store."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = self.export_state()
        # algorithm might not be JSON-serializable — store a marker
        try:
            json.dumps(payload["algorithm"])
        except (TypeError, ValueError):
            payload["algorithm"] = {"_non_json": True, "type": type(self._algorithm).__name__}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.meta.touch_save()
        return path

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    @property
    def feature_keys(self) -> Optional[List[str]]:
        return list(self._feature_keys) if self._feature_keys else None

    @property
    def is_ready(self) -> bool:
        return self.meta.is_ready

    @property
    def n_learned(self) -> int:
        return self.meta.n_learned

    def info(self) -> Dict[str, Any]:
        return {
            **self.meta.to_dict(),
            "feature_keys_count": len(self._feature_keys) if self._feature_keys else 0,
            "last_error": self._last_error,
            "algorithm_type": type(self._algorithm).__name__ if self._algorithm is not None else None,
        }

    def reset_algorithm(self, **kwargs: Any) -> None:
        """Drop learned state, keep identity meta (counters can be zeroed optionally)."""
        self._algorithm = self._create_fresh_algorithm(**kwargs)
        self.meta.n_learned = 0
        self.meta.n_scored = 0
        self.meta.state = ModelState.NEW
        self.meta.updated_at = time.time()
        self._last_error = None

    def disable(self) -> None:
        self.meta.mark_disabled()

    def enable(self) -> None:
        if self.meta.n_learned >= self.meta.min_samples_ready:
            self.meta.mark_ready()
        elif self.meta.n_learned > 0:
            self.meta.state = ModelState.WARMING
        else:
            self.meta.state = ModelState.NEW
        self.meta.updated_at = time.time()

    # ------------------------------------------------------------------
    # Hooks for subclasses
    # ------------------------------------------------------------------

    def compute_confidence(
        self,
        norm_score: float,
        raw_score: Optional[float],
        details: Optional[Dict[str, Any]],
    ) -> float:
        """
        Default confidence from maturity:
        - 0 samples → ~0.2
        - reaches min_samples_ready → ~0.85+
        """
        if self.meta.state == ModelState.DISABLED:
            return 0.0
        n = self.meta.n_learned
        m = max(1, self.meta.min_samples_ready)
        maturity = min(1.0, n / float(m))
        base = 0.2 + 0.7 * maturity
        if self.meta.state == ModelState.ERROR:
            base *= 0.5
        return self._clip01(base)

    def normalize_raw_score(self, raw: float) -> float:
        """Override if algorithm outputs unbounded scores."""
        return self._clip01(raw)

    def on_after_score(self, features: FeatureDict, norm: float, raw: Optional[float]) -> None:
        return None

    def on_after_learn(self, features: FeatureDict) -> None:
        return None

    # ------------------------------------------------------------------
    # Abstract — subclasses implement
    # ------------------------------------------------------------------

    @abc.abstractmethod
    def _create_fresh_algorithm(self, **kwargs: Any) -> Any:
        """Return a new underlying algorithm instance (e.g. River model)."""

    @abc.abstractmethod
    def _score_impl(self, features: FeatureDict) -> Tuple[float, Optional[float], Dict[str, Any]]:
        """
        Returns (normalized_score_0_1, raw_score, details).
        Must not train the model.
        """

    @abc.abstractmethod
    def _learn_impl(self, features: FeatureDict) -> None:
        """Update algorithm with one observation."""

    @abc.abstractmethod
    def _get_algorithm_state(self) -> Any:
        """Return picklable algorithm state."""

    @abc.abstractmethod
    def _set_algorithm_state(self, state: Any) -> None:
        """Restore algorithm from picklable state."""

    # ------------------------------------------------------------------
    # Utils
    # ------------------------------------------------------------------

    @staticmethod
    def _clip01(x: float) -> float:
        if x != x:  # NaN
            return 0.0
        if x < 0.0:
            return 0.0
        if x > 1.0:
            return 1.0
        return float(x)

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"org={self.org_id!r}, kind={self.kind.value}, "
            f"v={self.meta.version}, n_learned={self.meta.n_learned}, "
            f"state={self.meta.state.value})"
        )


# =============================================================================
# Minimal concrete stub (for tests without River)
# =============================================================================

class NullModel(BaseOnlineModel):
    """
    No-op model: always scores 0.0, learns by counting only.
    Useful for wiring tests before anomaly_detector exists.
    """

    kind = ModelKind.GENERIC
    default_name = "null"
    algorithm_name = "null"

    def _create_fresh_algorithm(self, **kwargs: Any) -> Any:
        return {"counter": 0}

    def _score_impl(self, features: FeatureDict) -> Tuple[float, Optional[float], Dict[str, Any]]:
        return 0.0, 0.0, {"null": True, "n_features": len(features)}

    def _learn_impl(self, features: FeatureDict) -> None:
        self._algorithm["counter"] = int(self._algorithm.get("counter", 0)) + 1

    def _get_algorithm_state(self) -> Any:
        return dict(self._algorithm)

    def _set_algorithm_state(self, state: Any) -> None:
        self._algorithm = dict(state) if state else {"counter": 0}


__all__ = [
    "FeatureDict",
    "ModelKind",
    "ModelState",
    "ModelMeta",
    "ScoreResult",
    "LearnResult",
    "BaseOnlineModel",
    "NullModel",
    "sanitize_features",
    "hash_feature_keys",
]