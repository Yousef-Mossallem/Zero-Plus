# app/models/anomaly_detector.py
# ============================================================
# Zero Plus — AI Service
# Online anomaly detector (River HalfSpaceTrees)
# Fast, org-scoped, poisoning-resistant learning policy
# ============================================================

from __future__ import annotations

import logging
import math
import time
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

from river import anomaly

from app.models.base_model import (
    BaseOnlineModel,
    FeatureDict,
    ModelKind,
    ModelState,
    ScoreResult,
    LearnResult,
    sanitize_features,
)

logger = logging.getLogger("zero-plus-ai.anomaly")


# =============================================================================
# Defaults tuned for request-level traffic features (~50–80 dims, mostly 0..1)
# =============================================================================

DEFAULT_N_TREES =  steals = 30
DEFAULT_HEIGHT = 12
DEFAULT_WINDOW_SIZE = 250
DEFAULT_SEED = 42

# Learning policy (anti-poisoning)
# - always score
# - learn strongly from normal / mild traffic
# - skip or down-weight extreme outliers so attackers cannot reshape the model easily
LEARN_SKIP_ABOVE = 0.92          # do not learn if normalized score >= this
LEARN_ALWAYS_BELOW = 0.55        # always learn if score below this
MIN_SAMPLES_READY = 25


def _clip01(x: float) -> float:
    if x != x or x in (float("inf"), float("-inf")):
        return 0.0
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return float(x)


class AnomalyDetector(BaseOnlineModel):
    """
    Online unsupervised anomaly detector per organization.

    Algorithm: river.anomaly.HalfSpaceTrees
      - streaming / one-sample updates
      - strong speed / memory profile for gateway-side scoring
      - works directly on Dict[str, float] feature maps

    Score contract:
      - score_one → ScoreResult.score in [0, 1]  (higher = more anomalous)
      - learn_one applies an anti-poisoning gate (extreme outliers are not learned)

    Typical flow inside /analyze:
        score, learn = detector.score_and_learn(features)
    """

    kind = ModelKind.ANOMALY
    default_name = "anomaly_hst"
    algorithm_name = "river.anomaly.HalfSpaceTrees"

    def __init__(
        self,
        org_id: str,
        *,
        name: Optional[str] = None,
        version: str = "1",
        min_samples_ready: int = MIN_SAMPLES_READY,
        feature_keys: Optional[Sequence[str]] = None,
        # HalfSpaceTrees hyper-params
        n_trees: int = DEFAULT_N_TREES,
        height: int = DEFAULT_HEIGHT,
        window_size: int = DEFAULT_WINDOW_SIZE,
        seed: int = DEFAULT_SEED,
        # Anti-poisoning
        learn_skip_above: float = LEARN_SKIP_ABOVE,
        learn_always_below: float = LEARN_ALWAYS_BELOW,
        # Score calibration
        score_ema_alpha: float = 0.05,
        **kwargs: Any,
    ) -> None:
        self._hst_params = {
            "n_trees": int(n_trees),
            "height": int(height),
            "window_size": int(window_size),
            "seed": int(seed),
        }
        self.learn_skip_above = float(learn_skip_above)
        self.learn_always_below = float(learn_always_below)
        self.score_ema_alpha = float(score_ema_alpha)

        # Runtime calibration state (kept outside River object for export clarity)
        self._raw_ema: float = 0.0
        self._raw_ema_sq: float = 0.0
        self._raw_max: float = 1e-6
        self._raw_count: int = 0
        self._last_norm_score: float = 0.0
        self._skipped_learns: int = 0
        self._applied_learns: int = 0

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
                "hst": dict(self._hst_params),
                "learn_skip_above": self.learn_skip_above,
                "learn_always_below": self.learn_always_below,
            }
        )

    # ------------------------------------------------------------------
    # Algorithm lifecycle
    # ------------------------------------------------------------------

    def _create_fresh_algorithm(self, **kwargs: Any) -> Any:
        params = dict(self._hst_params)
        params.update({k: v for k, v in kwargs.items() if k in params})
        return anomaly.HalfSpaceTrees(
            n_trees=params["n_trees"],
            height=params["height"],
            window_size=params["window_size"],
            seed=params["seed"],
        )

    def _get_algorithm_state(self) -> Any:
        return {
            "river_model": self._algorithm,
            "raw_ema": self._raw_ema,
            "raw_ema_sq": self._raw_ema_sq,
            "raw_max": self._raw_max,
            "raw_count": self._raw_count,
            "last_norm_score": self._last_norm_score,
            "skipped_learns": self._skipped_learns,
            "applied_learns": self._applied_learns,
            "hst_params": dict(self._hst_params),
            "learn_skip_above": self.learn_skip_above,
            "learn_always_below": self.learn_always_below,
            "score_ema_alpha": self.score_ema_alpha,
        }

    def _set_algorithm_state(self, state: Any) -> None:
        if not isinstance(state, dict):
            self._algorithm = self._create_fresh_algorithm()
            return

        model = state.get("river_model")
        if model is not None:
            self._algorithm = model
        else:
            self._algorithm = self._create_fresh_algorithm()

        self._raw_ema = float(state.get("raw_ema", 0.0))
        self._raw_ema_sq = float(state.get("raw_ema_sq", 0.0))
        self._raw_max = float(state.get("raw_max", 1e-6)) or 1e-6
        self._raw_count = int(state.get("raw_count", 0))
        self._last_norm_score = float(state.get("last_norm_score", 0.0))
        self._skipped_learns = int(state.get("skipped_learns", 0))
        self._applied_learns = int(state.get("applied_learns", 0))

        if "hst_params" in state and isinstance(state["hst_params"], dict):
            self._hst_params.update(state["hst_params"])
        if "learn_skip_above" in state:
            self.learn_skip_above = float(state["learn_skip_above"])
        if "learn_always_below" in state:
            self.learn_always_below = float(state["learn_always_below"])
        if "score_ema_alpha" in state:
            self.score_ema_alpha = float(state["score_ema_alpha"])

    # ------------------------------------------------------------------
    # Score
    # ------------------------------------------------------------------

    def _score_impl(self, features: FeatureDict) -> Tuple[float, Optional[float], Dict[str, Any]]:
        """
        HalfSpaceTrees.score_one → raw anomaly score (higher ≈ more anomalous).
        We calibrate to [0, 1] using a running max + soft EMA scaling so
        different orgs / traffic scales stay comparable.
        """
        if not features:
            return 0.0, 0.0, {"empty_features": True}

        raw = float(self._algorithm.score_one(features))
        if not math.isfinite(raw):
            raw = 0.0

        # Update calibration stats (read-path safe; does not train trees)
        self._update_calibration(raw)

        norm = self._normalize_raw(raw)
        self._last_norm_score = norm

        details = {
            "raw": raw,
            "raw_max": self._raw_max,
            "raw_ema": self._raw_ema,
            "calibration_n": self._raw_count,
            "n_trees": self._hst_params.get("n_trees"),
            "window_size": self._hst_params.get("window_size"),
        }
        return norm, raw, details

    def _update_calibration(self, raw: float) -> None:
        alpha = self.score_ema_alpha
        self._raw_count += 1
        if self._raw_count == 1:
            self._raw_ema = raw
            self._raw_ema_sq = raw * raw
            self._raw_max = max(raw, 1e-6)
            return

        self._raw_ema = (1.0 - alpha) * self._raw_ema + alpha * raw
        self._raw_ema_sq = (1.0 - alpha) * self._raw_ema_sq + alpha * (raw * raw)
        # slow decay on max so a single spike does not dominate forever,
        # but real elevations still stretch the scale
        self._raw_max = max(self._raw_max * 0.9995, raw, 1e-6)

    def _normalize_raw(self, raw: float) -> float:
        """
        Map raw HST score → [0, 1].

        Strategy:
          1) scale by running max (primary)
          2) blend with a soft z-style term from EMA so early traffic is not all ~1.0
        """
        if self._raw_max <= 0:
            return 0.0

        by_max = raw / self._raw_max
        by_max = _clip01(by_max)

        # variance proxy from EMA
        var = max(0.0, self._raw_ema_sq - self._raw_ema * self._raw_ema)
        std = math.sqrt(var) if var > 0 else 0.0
        if std > 1e-9:
            z = (raw - self._raw_ema) / (3.0 * std)  # ~3σ soft
            by_z = _clip01(0.5 + 0.5 * z)
        else:
            by_z = by_max

        # Early life: trust by_max less until we have samples
        warm = min(1.0, self._raw_count / 50.0)
        blended = (1.0 - warm) * by_max + warm * (0.65 * by_max + 0.35 * by_z)
        return _clip01(blended)

    # ------------------------------------------------------------------
    # Learn (with anti-poisoning gate)
    # ------------------------------------------------------------------

    def _learn_impl(self, features: FeatureDict) -> None:
        """
        Called by BaseOnlineModel.learn_one after sanitize.

        Anti-poisoning policy:
          - If we already have a last norm score and it is extremely high,
            skip learning (attacker traffic should not redefine normality).
          - Always learn when model is still warming (need baseline),
            unless score is absurdly high after we have *some* signal.
        """
        if not features:
            return

        # Decide from last scored value when available (score_and_learn order)
        norm = self._last_norm_score
        should_learn = True
        reason = "ok"

        if self.meta.n_learned >= max(5, self.meta.min_samples_ready // 3):
            if norm >= self.learn_skip_above:
                should_learn = False
                reason = "skip_extreme_outlier"
            elif norm >= self.learn_always_below:
                # borderline: learn with feature soft-damping toward mean 0.5
                # keeps structure without fully absorbing attack patterns
                features = self._dampen_features(features, factor=0.35)
                reason = "dampened_borderline"

        if not should_learn:
            self._skipped_learns += 1
            self.meta.extra["last_learn_skip_reason"] = reason
            self.meta.extra["skipped_learns"] = self._skipped_learns
            # Raise a soft skip by doing nothing — base still counts touch_learn.
            # We re-wire via learn_one override below for accurate counters.
            self._soft_skip = True  # type: ignore[attr-defined]
            return

        self._soft_skip = False  # type: ignore[attr-defined]
        self._algorithm.learn_one(features)
        self._applied_learns += 1
        self.meta.extra["applied_learns"] = self._applied_learns
        self.meta.extra["last_learn_skip_reason"] = reason

    def learn_one(self, features: Mapping[str, Any]) -> LearnResult:
        """
        Override to avoid incrementing n_learned when we intentionally skip
        extreme outliers (anti-poisoning).
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
                from app.models.base_model import hash_feature_keys

                self.meta.feature_keys_hash = hash_feature_keys(self._feature_keys)

            self._soft_skip = False  # type: ignore[attr-defined]
            self._learn_impl(clean)

            if getattr(self, "_soft_skip", False):
                return LearnResult(
                    learned=False,
                    n_learned=self.meta.n_learned,
                    state=self.meta.state,
                    model_version=self.meta.version,
                    model_id=self.meta.model_id,
                    message="skipped_extreme_outlier",
                )

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
            logger.exception("anomaly learn_one failed for %s", self.meta.model_id)
            return LearnResult(
                learned=False,
                n_learned=self.meta.n_learned,
                state=self.meta.state,
                model_version=self.meta.version,
                model_id=self.meta.model_id,
                message=str(exc),
            )

    @staticmethod
    def _dampen_features(features: FeatureDict, factor: float = 0.35) -> FeatureDict:
        """
        Pull feature values toward a neutral 0.5 center by (1-factor).
        Reduces the impact of borderline-anomalous points on the trees.
        """
        factor = _clip01(factor)
        out: FeatureDict = {}
        for k, v in features.items():
            out[k] = v * (1.0 - factor) + 0.5 * factor
        return out

    # ------------------------------------------------------------------
    # Confidence: maturity + calibration stability
    # ------------------------------------------------------------------

    def compute_confidence(
        self,
        norm_score: float,
        raw_score: Optional[float],
        details: Optional[Dict[str, Any]],
    ) -> float:
        base = super().compute_confidence(norm_score, raw_score, details)
        # penalize if calibration still thin
        cal_n = (details or {}).get("calibration_n", self._raw_count)
        cal_factor = min(1.0, float(cal_n) / 40.0)
        return _clip01(base * (0.55 + 0.45 * cal_factor))

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    def info(self) -> Dict[str, Any]:
        data = super().info()
        data.update(
            {
                "applied_learns": self._applied_learns,
                "skipped_learns": self._skipped_learns,
                "raw_ema": self._raw_ema,
                "raw_max": self._raw_max,
                "last_norm_score": self._last_norm_score,
                "hst_params": dict(self._hst_params),
            }
        )
        return data


def build_anomaly_detector(
    org_id: str,
    *,
    feature_keys: Optional[Sequence[str]] = None,
    **kwargs: Any,
) -> AnomalyDetector:
    """Factory used by model_registry / initial_training."""
    return AnomalyDetector(org_id, feature_keys=feature_keys, **kwargs)


__all__ = [
    "AnomalyDetector",
    "build_anomaly_detector",
    "DEFAULT_N_TREES",
    "DEFAULT_HEIGHT",
    "DEFAULT_WINDOW_SIZE",
    "MIN_SAMPLES_READY",
]