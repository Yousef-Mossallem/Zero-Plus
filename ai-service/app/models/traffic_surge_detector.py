# app/models/traffic_surge_detector.py
# ============================================================
# Zero Plus — AI Service
# Traffic surge / rate-drift detector (org + path, sensitivity-aware)
# Fast, stable, low false-positive bias
# ============================================================

from __future__ import annotations

import logging
import math
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from river.drift import ADWIN, PageHinkley

from app.models.base_model import (
    BaseOnlineModel,
    FeatureDict,
    ModelKind,
    ModelState,
    sanitize_features,
)

logger = logging.getLogger("zero-plus-ai.surge")


# =============================================================================
# Defaults
# =============================================================================

DEFAULT_MIN_SAMPLES_READY = 30

# Rate estimation
EWMA_ALPHA_FAST = 0.25          # reacts quickly
EWMA_ALPHA_SLOW = 0.04          # baseline / normality
MIN_INTERVAL_SEC = 1e-3         # avoid div-by-zero on burst timestamps

# Path tracking
MAX_TRACKED_PATHS = 64          # LRU cap per org model
PATH_EWMA_ALPHA = 0.20

# Scoring weights (sum ≈ 1)
W_ORG_RATE = 0.40
W_ORG_DRIFT = 0.25
W_PATH_RATE = 0.20
W_PATH_SENS = 0.15

# Hysteresis to reduce flicker
SURGE_ENTER = 0.55
SURGE_EXIT = 0.40


def _clip01(x: float) -> float:
    if x != x or x in (float("inf"), float("-inf")):
        return 0.0
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else float(x)


def _safe_log1p(x: float) -> float:
    return math.log1p(max(0.0, x))


# =============================================================================
# Small internal structures
# =============================================================================

@dataclass
class PathBucket:
    """Per-path rate memory (for sensitive / active paths)."""

    key: str
    ewma_rate: float = 0.0
    slow_rate: float = 0.0
    last_ts: float = 0.0
    hits: int = 0
    sens_weight: float = 0.15
    last_score: float = 0.0


class _LRUPaths:
    """Bounded path map — evict least-recently used."""

    def __init__(self, capacity: int = MAX_TRACKED_PATHS) -> None:
        self.capacity = max(8, int(capacity))
        self._data: OrderedDict[str, PathBucket] = OrderedDict()

    def get(self, key: str) -> Optional[PathBucket]:
        b = self._data.get(key)
        if b is not None:
            self._data.move_to_end(key)
        return b

    def get_or_create(self, key: str, sens_weight: float) -> PathBucket:
        b = self.get(key)
        if b is not None:
            b.sens_weight = max(b.sens_weight, sens_weight)
            return b
        while len(self._data) >= self.capacity:
            self._data.popitem(last=False)
        b = PathBucket(key=key, sens_weight=sens_weight, last_ts=time.time())
        self._data[key] = b
        return b

    def items(self) -> List[Tuple[str, PathBucket]]:
        return list(self._data.items())

    def __len__(self) -> int:
        return len(self._data)

    def export(self) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        for k, b in self._data.items():
            out[k] = {
                "key": b.key,
                "ewma_rate": b.ewma_rate,
                "slow_rate": b.slow_rate,
                "last_ts": b.last_ts,
                "hits": b.hits,
                "sens_weight": b.sens_weight,
                "last_score": b.last_score,
            }
        return out

    def load(self, raw: Mapping[str, Any]) -> None:
        self._data.clear()
        if not isinstance(raw, Mapping):
            return
        for k, v in raw.items():
            if not isinstance(v, Mapping):
                continue
            b = PathBucket(
                key=str(v.get("key", k)),
                ewma_rate=float(v.get("ewma_rate", 0.0)),
                slow_rate=float(v.get("slow_rate", 0.0)),
                last_ts=float(v.get("last_ts", 0.0)),
                hits=int(v.get("hits", 0)),
                sens_weight=float(v.get("sens_weight", 0.15)),
                last_score=float(v.get("last_score", 0.0)),
            )
            self._data[str(k)] = b


# =============================================================================
# Feature helpers — read sensitivity / path identity from feature dict
# =============================================================================

def _path_sensitivity_weight(features: Mapping[str, float]) -> float:
    """
    Prefer explicit weight; fall back to one-hot levels from feature_extractor.
    """
    if "path_sens_weight" in features:
        return _clip01(float(features.get("path_sens_weight", 0.15)))

    if float(features.get("path_sens_critical", 0.0)) >= 0.5:
        return 1.0
    if float(features.get("path_sens_high", 0.0)) >= 0.5:
        return 0.75
    if float(features.get("path_sens_medium", 0.0)) >= 0.5:
        return 0.45
    return 0.15


def _path_bucket_key(features: Mapping[str, float]) -> str:
    """
    Coarse path identity without needing raw string path in features.
    Uses sensitivity band + depth + len so /login-like traffic groups together.
    """
    if float(features.get("path_sens_critical", 0.0)) >= 0.5:
        band = "crit"
    elif float(features.get("path_sens_high", 0.0)) >= 0.5:
        band = "high"
    elif float(features.get("path_sens_medium", 0.0)) >= 0.5:
        band = "med"
    else:
        band = "low"

    depth = int(float(features.get("path_depth", 0.0)))
    # quantize length
    plen = float(features.get("path_len_log", 0.0))
    plen_q = int(plen * 4)  # coarse bins
    return f"{band}:d{depth}:l{plen_q}"


def _extract_event_ts(features: Mapping[str, float], fallback: float) -> float:
    """
    Features don't carry unix ts; caller may inject `_event_ts`.
    Otherwise use wall clock (good enough for live stream).
    """
    if "_event_ts" in features:
        try:
            return float(features["_event_ts"])
        except (TypeError, ValueError):
            pass
    return fallback


# =============================================================================
# Main detector
# =============================================================================

class TrafficSurgeDetector(BaseOnlineModel):
    """
    Detects traffic surges at organization and path-band level.

    Signals combined into score ∈ [0, 1]:
      1) Org fast-vs-slow EWMA rate ratio
      2) Concept drift on inter-arrival / rate (PageHinkley + ADWIN)
      3) Path-band local rate spike
      4) Path sensitivity weight (critical/high paths amplify concern)

    Design goals:
      - Fast reaction to real bursts
      - Stable baseline (slow EWMA) to avoid permanent panic after one spike
      - Hysteresis on detected flag
      - Bounded memory (LRU paths)
      - No dependence on pandas/numpy
    """

    kind = ModelKind.SURGE
    default_name = "traffic_surge"
    algorithm_name = "ewma+pagehinkley+adwin"

    def __init__(
        self,
        org_id: str,
        *,
        name: Optional[str] = None,
        version: str = "1",
        min_samples_ready: int = DEFAULT_MIN_SAMPLES_READY,
        feature_keys: Optional[Sequence[str]] = None,
        max_tracked_paths: int = MAX_TRACKED_PATHS,
        **kwargs: Any,
    ) -> None:
        # Org-level rate state
        self._org_last_ts: float = 0.0
        self._org_fast_rate: float = 0.0      # req/sec EWMA fast
        self._org_slow_rate: float = 0.0      # req/sec EWMA slow (baseline)
        self._org_hits: int = 0
        self._last_surge_score: float = 0.0
        self._detected: bool = False

        # Drift detectors on instantaneous rate sample
        self._ph = PageHinkley(min_instances=20, delta=0.005, threshold=50.0, alpha=0.9999)
        self._adwin = ADWIN(delta=0.002)

        self._paths = _LRUPaths(capacity=max_tracked_paths)
        self._max_tracked_paths = max_tracked_paths

        super().__init__(
            org_id,
            name=name or self.default_name,
            version=version,
            min_samples_ready=min_samples_ready,
            feature_keys=feature_keys,
            **kwargs,
        )
        self.meta.extra.update(
            {
                "max_tracked_paths": max_tracked_paths,
                "weights": {
                    "org_rate": W_ORG_RATE,
                    "org_drift": W_ORG_DRIFT,
                    "path_rate": W_PATH_RATE,
                    "path_sens": W_PATH_SENS,
                },
            }
        )

    # ------------------------------------------------------------------
    # Algorithm state (for model_store)
    # ------------------------------------------------------------------

    def _create_fresh_algorithm(self, **kwargs: Any) -> Any:
        # State lives on self; algorithm slot holds a small marker dict
        return {
            "type": "surge_v1",
            "created": time.time(),
        }

    def _get_algorithm_state(self) -> Any:
        return {
            "marker": self._algorithm,
            "org_last_ts": self._org_last_ts,
            "org_fast_rate": self._org_fast_rate,
            "org_slow_rate": self._org_slow_rate,
            "org_hits": self._org_hits,
            "last_surge_score": self._last_surge_score,
            "detected": self._detected,
            "paths": self._paths.export(),
            "ph": self._ph,
            "adwin": self._adwin,
            "max_tracked_paths": self._max_tracked_paths,
        }

    def _set_algorithm_state(self, state: Any) -> None:
        if not isinstance(state, dict):
            self._algorithm = self._create_fresh_algorithm()
            return

        self._algorithm = state.get("marker") or self._create_fresh_algorithm()
        self._org_last_ts = float(state.get("org_last_ts", 0.0))
        self._org_fast_rate = float(state.get("org_fast_rate", 0.0))
        self._org_slow_rate = float(state.get("org_slow_rate", 0.0))
        self._org_hits = int(state.get("org_hits", 0))
        self._last_surge_score = float(state.get("last_surge_score", 0.0))
        self._detected = bool(state.get("detected", False))
        self._max_tracked_paths = int(state.get("max_tracked_paths", MAX_TRACKED_PATHS))
        self._paths = _LRUPaths(capacity=self._max_tracked_paths)
        self._paths.load(state.get("paths") or {})

        ph = state.get("ph")
        ad = state.get("adwin")
        self._ph = ph if ph is not None else PageHinkley(
            min_instances=20, delta=0.005, threshold=50.0, alpha=0.9999
        )
        self._adwin = ad if ad is not None else ADWIN(delta=0.002)

    # ------------------------------------------------------------------
    # Core observation (shared by score & learn)
    # ------------------------------------------------------------------

    def _observe(self, features: FeatureDict, *, train_drift: bool) -> Dict[str, Any]:
        now = time.time()
        ts = _extract_event_ts(features, now)
        sens = _path_sensitivity_weight(features)
        path_key = _path_bucket_key(features)

        # --- Org inter-arrival → instantaneous rate ---
        inst_rate = 0.0
        if self._org_last_ts > 0.0:
            dt = max(MIN_INTERVAL_SEC, ts - self._org_last_ts)
            inst_rate = 1.0 / dt
            self._org_fast_rate = (
                EWMA_ALPHA_FAST * inst_rate + (1.0 - EWMA_ALPHA_FAST) * self._org_fast_rate
            )
            self._org_slow_rate = (
                EWMA_ALPHA_SLOW * inst_rate + (1.0 - EWMA_ALPHA_SLOW) * self._org_slow_rate
            )
        else:
            # first event: seed softly
            self._org_fast_rate = 0.0
            self._org_slow_rate = 0.0

        self._org_last_ts = ts
        self._org_hits += 1

        # Rate ratio: how hot vs baseline
        baseline = max(self._org_slow_rate, 0.05)  # floor avoids huge ratios at start
        rate_ratio = self._org_fast_rate / baseline
        # map ratio → [0,1]; ratio 1 = normal, ≥4 ≈ full
        org_rate_score = _clip01((rate_ratio - 1.0) / 3.0)

        # --- Drift detectors on instantaneous rate ---
        drift_score = 0.0
        ph_change = False
        ad_change = False
        if train_drift and self._org_hits > 1:
            self._ph.update(inst_rate)
            self._adwin.update(inst_rate)
            ph_change = bool(self._ph.drift_detected)
            ad_change = bool(self._adwin.drift_detected)
            if ph_change:
                drift_score = max(drift_score, 0.85)
            if ad_change:
                drift_score = max(drift_score, 0.75)
            # soft continuous signal from rate ratio even without formal drift flag
            drift_score = max(drift_score, _clip01((rate_ratio - 1.2) / 4.0) * 0.6)

        # --- Path-band local rate ---
        bucket = self._paths.get_or_create(path_key, sens)
        path_rate_score = 0.0
        if bucket.last_ts > 0.0:
            pdt = max(MIN_INTERVAL_SEC, ts - bucket.last_ts)
            p_inst = 1.0 / pdt
            bucket.ewma_rate = PATH_EWMA_ALPHA * p_inst + (1.0 - PATH_EWMA_ALPHA) * bucket.ewma_rate
            bucket.slow_rate = (
                (PATH_EWMA_ALPHA * 0.25) * p_inst + (1.0 - PATH_EWMA_ALPHA * 0.25) * bucket.slow_rate
            )
            p_base = max(bucket.slow_rate, 0.03)
            p_ratio = bucket.ewma_rate / p_base
            path_rate_score = _clip01((p_ratio - 1.0) / 3.0)
        bucket.last_ts = ts
        bucket.hits += 1
        bucket.sens_weight = max(bucket.sens_weight, sens)

        # Sensitivity amplification: high/critical paths raise concern faster
        # sens already 0.15..1.0 from feature_extractor weights
        sens_component = _clip01(sens * (0.35 + 0.65 * max(org_rate_score, path_rate_score)))

        # --- Fuse ---
        score = (
            W_ORG_RATE * org_rate_score
            + W_ORG_DRIFT * drift_score
            + W_PATH_RATE * path_rate_score
            + W_PATH_SENS * sens_component
        )
        # Extra boost when critical path + any elevated rate
        if sens >= 0.9 and max(org_rate_score, path_rate_score) >= 0.35:
            score = _clip01(score + 0.12)
        elif sens >= 0.7 and max(org_rate_score, path_rate_score) >= 0.45:
            score = _clip01(score + 0.08)

        score = _clip01(score)

        # Hysteresis for boolean detected
        if self._detected:
            self._detected = score >= SURGE_EXIT
        else:
            self._detected = score >= SURGE_ENTER

        bucket.last_score = score
        self._last_surge_score = score

        return {
            "score": score,
            "detected": self._detected,
            "org_fast_rate": self._org_fast_rate,
            "org_slow_rate": self._org_slow_rate,
            "org_rate_ratio": rate_ratio,
            "org_rate_score": org_rate_score,
            "drift_score": drift_score,
            "ph_change": ph_change,
            "adwin_change": ad_change,
            "path_key": path_key,
            "path_rate_score": path_rate_score,
            "path_sens_weight": sens,
            "sens_component": sens_component,
            "org_hits": self._org_hits,
            "tracked_paths": len(self._paths),
            "scope": "path" if path_rate_score >= org_rate_score else "org",
        }

    # ------------------------------------------------------------------
    # BaseOnlineModel hooks
    # ------------------------------------------------------------------

    def _score_impl(self, features: FeatureDict) -> Tuple[float, Optional[float], Dict[str, Any]]:
        # Score path updates rates for detection quality; drift flags only on learn
        # to keep score_one side-effect light. We still update EWMA so live
        # scoring reflects current intensity (required for surge).
        details = self._observe(features, train_drift=False)
        return details["score"], details["score"], details

    def _learn_impl(self, features: FeatureDict) -> None:
        # Full update including drift detectors
        self._observe(features, train_drift=True)

    def score_and_learn(self, features: Mapping[str, Any]) -> Tuple[Any, Any]:
        """
        Single observe with drift training, then expose as score + learn results.
        Avoids double-counting the same event.
        """
        if self.meta.state == ModelState.DISABLED:
            from app.models.base_model import ScoreResult, LearnResult

            z = ScoreResult(
                score=0.0, confidence=0.0, ready=False,
                model_version=self.meta.version, model_id=self.meta.model_id,
                org_id=self.org_id, kind=self.kind.value, details={"disabled": True},
            )
            lr = LearnResult(
                learned=False, n_learned=self.meta.n_learned, state=self.meta.state,
                model_version=self.meta.version, model_id=self.meta.model_id, message="disabled",
            )
            return z, lr

        from app.models.base_model import ScoreResult, LearnResult

        clean = sanitize_features(features, allowed_keys=self._feature_keys)
        if self._feature_keys is None and clean:
            self._feature_keys = sorted(clean.keys())
            self.meta.feature_dim = len(self._feature_keys)

        details = self._observe(clean, train_drift=True)
        norm = float(details["score"])
        self.meta.touch_score()
        self.meta.touch_learn()
        conf = self.compute_confidence(norm, norm, details)

        sr = ScoreResult(
            score=norm,
            raw_score=norm,
            confidence=conf,
            ready=self.meta.is_ready,
            model_version=self.meta.version,
            model_id=self.meta.model_id,
            org_id=self.org_id,
            kind=self.kind.value,
            details=details,
        )
        lr = LearnResult(
            learned=True,
            n_learned=self.meta.n_learned,
            state=self.meta.state,
            model_version=self.meta.version,
            model_id=self.meta.model_id,
        )
        return sr, lr

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    @property
    def detected(self) -> bool:
        return self._detected

    def info(self) -> Dict[str, Any]:
        data = super().info()
        data.update(
            {
                "detected": self._detected,
                "last_surge_score": self._last_surge_score,
                "org_fast_rate": self._org_fast_rate,
                "org_slow_rate": self._org_slow_rate,
                "org_hits": self._org_hits,
                "tracked_paths": len(self._paths),
            }
        )
        return data


def build_traffic_surge_detector(
    org_id: str,
    *,
    feature_keys: Optional[Sequence[str]] = None,
    **kwargs: Any,
) -> TrafficSurgeDetector:
    return TrafficSurgeDetector(org_id, feature_keys=feature_keys, **kwargs)


__all__ = [
    "TrafficSurgeDetector",
    "build_traffic_surge_detector",
    "DEFAULT_MIN_SAMPLES_READY",
]