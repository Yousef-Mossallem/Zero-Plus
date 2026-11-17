# app/models/model_registry.py
# ============================================================
# Zero Plus — AI Service
# Model Registry — per-org model manager (anomaly + surge)
# Create · load · score · learn · save · shutdown
#
# التعديلات عن النسخة الأصلية:
#   1) _spawn_org بيشغّل bootstrap تلقائي لأي org جديد
#   2) Bootstrap بيتشغّل في background thread (مش blocking)
#   3) bootstrap_pending flag للطلبات اللي جت قبل ما البوتستراب يخلص
#   4) إصلاح typo: exp → exc في evict_org و score_and_learn
#   5) list_orgs() دالة جديدة لقائمة كل الـ orgs المدرّبة
#   6) score_and_learn بيرجع ScoreResult صح لو حصل error
# ============================================================

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Set, Tuple

from app.config import Settings, get_settings
from app.models.anomaly_detector import AnomalyDetector, build_anomaly_detector
from app.models.base_model import FeatureDict, ModelKind, ModelState, ScoreResult, LearnResult
from app.models.traffic_surge_detector import TrafficSurgeDetector, build_traffic_surge_detector
from app.persistence.model_store import ModelStore, get_model_store

logger = logging.getLogger("zero-plus-ai.registry")


# =============================================================================
# Per-org bundle
# =============================================================================

@dataclass
class OrgModels:
    """All online models owned by one organization."""

    org_id:         str
    anomaly:        AnomalyDetector
    surge:          TrafficSurgeDetector
    created_at:     float = field(default_factory=time.time)
    last_access_at: float = field(default_factory=time.time)
    last_save_at:   float = 0.0
    hits:           int   = 0
    from_disk:      bool  = False
    bootstrap_done: bool  = False   # True بعد ما الـ bootstrap يخلص

    def touch(self) -> None:
        self.last_access_at = time.time()
        self.hits += 1

    def info(self) -> Dict[str, Any]:
        return {
            "org_id":         self.org_id,
            "hits":           self.hits,
            "created_at":     self.created_at,
            "last_access_at": self.last_access_at,
            "last_save_at":   self.last_save_at,
            "from_disk":      self.from_disk,
            "bootstrap_done": self.bootstrap_done,
            "anomaly":        self.anomaly.info(),
            "surge":          self.surge.info(),
        }


@dataclass
class OrgScoreBundle:
    """Combined scoring result for one request."""

    org_id:         str
    anomaly:        ScoreResult
    surge:          ScoreResult
    anomaly_learn:  Optional[LearnResult] = None
    surge_learn:    Optional[LearnResult] = None
    processing_ms:  float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "org_id":        self.org_id,
            "anomaly":       self.anomaly.to_dict(),
            "surge":         self.surge.to_dict(),
            "anomaly_learn": self.anomaly_learn.to_dict() if self.anomaly_learn else None,
            "surge_learn":   self.surge_learn.to_dict()   if self.surge_learn   else None,
            "processing_ms": self.processing_ms,
        }


# =============================================================================
# Registry
# =============================================================================

class ModelRegistry:
    """
    Central manager for Zero Plus online models.

    Responsibilities:
      • One anomaly + one surge model per org_id
      • Lazy create on first access
      • Load from disk when available (ModelStore)
      • Auto bootstrap new orgs in a background thread
      • score / learn / score_and_learn for an org
      • Periodic + forced save
      • Evict idle orgs from memory while keeping disk copy
      • Clean shutdown: flush all dirty models

    Thread-safe: global lock + per-org locks for model ops.
    """

    def __init__(
        self,
        *,
        store:               Optional[ModelStore] = None,
        settings:            Optional[Settings]   = None,
        max_orgs_in_memory:  int   = 256,
        idle_evict_sec:      float = 3600.0,
        auto_save:           bool  = True,
        auto_bootstrap:      bool  = True,
    ) -> None:
        self.settings            = settings or get_settings()
        self.store               = store or get_model_store(self.settings)
        self.max_orgs_in_memory  = max(8, int(max_orgs_in_memory))
        self.idle_evict_sec      = float(idle_evict_sec)
        self.auto_save           = bool(auto_save)
        self.auto_bootstrap      = bool(auto_bootstrap)

        self._orgs:       Dict[str, OrgModels]       = {}
        self._org_locks:  Dict[str, threading.RLock] = {}
        self._global      = threading.RLock()
        self._closed      = False

        # background bootstrap tracking
        self._bootstrapping: Set[str] = set()   # orgs currently being bootstrapped

        self._stats = {
            "created":     0,
            "loaded":      0,
            "saves":       0,
            "evictions":   0,
            "score_calls": 0,
            "errors":      0,
            "bootstrapped":0,
        }

        logger.info(
            "ModelRegistry ready (store=%s max_orgs=%s auto_bootstrap=%s)",
            self.store.root,
            self.max_orgs_in_memory,
            self.auto_bootstrap,
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @property
    def closed(self) -> bool:
        return self._closed

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("ModelRegistry is closed")

    def _org_lock(self, org_id: str) -> threading.RLock:
        with self._global:
            lock = self._org_locks.get(org_id)
            if lock is None:
                lock = threading.RLock()
                self._org_locks[org_id] = lock
            return lock

    # ------------------------------------------------------------------
    # get_or_create
    # ------------------------------------------------------------------

    def get_or_create(self, org_id: str, *, force_new: bool = False) -> OrgModels:
        """Return the OrgModels bundle for org_id, creating/loading if needed."""
        self._ensure_open()
        oid = (org_id or "unknown").strip() or "unknown"

        with self._global:
            if not force_new and oid in self._orgs:
                bundle = self._orgs[oid]
                bundle.touch()
                return bundle

        with self._org_lock(oid):
            with self._global:
                if not force_new and oid in self._orgs:
                    bundle = self._orgs[oid]
                    bundle.touch()
                    return bundle

            bundle = self._spawn_org(oid)
            with self._global:
                self._orgs[oid] = bundle
                self._maybe_evict_unlocked()
            bundle.touch()
            return bundle

    # ------------------------------------------------------------------
    # _spawn_org  — قلب التعديل
    # ------------------------------------------------------------------

    def _spawn_org(self, org_id: str) -> OrgModels:
        """
        1) بيبني موديلات جديدة.
        2) لو في ملف على الديسك → بيحمّله.
        3) لو مفيش → org جديد → بيشغّل bootstrap في background.
        """
        anomaly   = build_anomaly_detector(org_id)
        surge     = build_traffic_surge_detector(org_id)
        from_disk = False

        # ── حاول تحمّل من الديسك ──────────────────────────────────
        if self.store.exists(org_id, ModelKind.ANOMALY):
            if self.store.load_into(anomaly):
                from_disk = True
                self._stats["loaded"] += 1
                logger.info(
                    "Loaded anomaly from disk org=%s n=%s",
                    org_id, anomaly.n_learned,
                )
            else:
                logger.warning(
                    "Anomaly blob exists but load failed org=%s — using fresh",
                    org_id,
                )

        if self.store.exists(org_id, ModelKind.SURGE):
            if self.store.load_into(surge):
                from_disk = True
                self._stats["loaded"] += 1
                logger.info(
                    "Loaded surge from disk org=%s n=%s",
                    org_id, surge.n_learned,
                )
            else:
                logger.warning(
                    "Surge blob exists but load failed org=%s — using fresh",
                    org_id,
                )

        bundle = OrgModels(
            org_id        = org_id,
            anomaly       = anomaly,
            surge         = surge,
            from_disk     = from_disk,
            bootstrap_done= from_disk,  # لو من الديسك = سبق اتدرّب
        )

        if not from_disk:
            self._stats["created"] += 1
            logger.info("Created fresh models org=%s", org_id)

            # ── bootstrap في background thread ────────────────────
            if self.auto_bootstrap:
                self._launch_bootstrap(org_id, bundle)
            else:
                bundle.bootstrap_done = True   # مفيش bootstrap، اعتبره خلص

        return bundle

    # ------------------------------------------------------------------
    # Bootstrap (background)
    # ------------------------------------------------------------------

    def _launch_bootstrap(self, org_id: str, bundle: OrgModels) -> None:
        """
        بيشغّل bootstrap_org_models في thread منفصل.
        الطلبات الحقيقية بتكمل أثناء التدريب.
        لما يخلص بيحفظ على الديسك.
        """
        with self._global:
            if org_id in self._bootstrapping:
                return          # في حد تاني بيعمله
            self._bootstrapping.add(org_id)

        def _run() -> None:
            try:
                from app.training.initial_training import bootstrap_org_models
                result = bootstrap_org_models(
                    bundle.anomaly,
                    bundle.surge,
                    org_id        = org_id,
                    size          = self.settings.default_org_size,
                    settings      = self.settings,
                    skip_if_ready = False,
                )
                bundle.bootstrap_done = True
                self._stats["bootstrapped"] += 1
                logger.info(
                    "Bootstrap done org=%s samples=%s anomaly_n=%s ms=%.0f",
                    org_id,
                    result.samples_fed,
                    bundle.anomaly.n_learned,
                    result.duration_ms,
                )

                # حفظ على الديسك بعد البوتستراب
                try:
                    self.store.save(bundle.anomaly, force=True)
                    self.store.save(bundle.surge,   force=True)
                    bundle.last_save_at = time.time()
                    self._stats["saves"] += 2
                except Exception as exc:
                    logger.warning(
                        "Bootstrap save failed org=%s: %s", org_id, exc
                    )

            except Exception as exc:
                bundle.bootstrap_done = True   # خلّي الطلبات تكمل حتى لو فشل
                logger.warning(
                    "Bootstrap failed org=%s (non-fatal): %s", org_id, exc
                )
            finally:
                with self._global:
                    self._bootstrapping.discard(org_id)

        t = threading.Thread(
            target  = _run,
            name    = f"bootstrap-{org_id[:8]}",
            daemon  = True,
        )
        t.start()
        logger.info(
            "Bootstrap started in background org=%s size=%s",
            org_id,
            self.settings.default_org_size,
        )

    # ------------------------------------------------------------------
    # Scoring API
    # ------------------------------------------------------------------

    def score_and_learn(
        self,
        org_id:   str,
        features: Mapping[str, Any],
        *,
        learn: bool           = True,
        save:  Optional[bool] = None,
    ) -> OrgScoreBundle:
        """
        Run anomaly + surge for one request.

        learn=True  → online update both models
        save=None   → follow auto_save + store.should_save policy
        save=True   → force save after
        save=False  → never save on this call
        """
        self._ensure_open()
        t0  = time.perf_counter()
        oid = (org_id or "unknown").strip() or "unknown"
        feats: FeatureDict = dict(features) if not isinstance(features, dict) else features  # type: ignore[assignment]

        with self._org_lock(oid):
            bundle  = self.get_or_create(oid)
            anomaly = bundle.anomaly
            surge   = bundle.surge

            a_learn: Optional[LearnResult] = None
            s_learn: Optional[LearnResult] = None

            try:
                if learn:
                    a_score, a_learn = anomaly.score_and_learn(feats)
                    s_score, s_learn = surge.score_and_learn(feats)
                else:
                    a_score = anomaly.score_one(feats)
                    s_score = surge.score_one(feats)

            except Exception as exc:
                self._stats["errors"] += 1
                logger.exception("score_and_learn failed org=%s: %s", oid, exc)
                a_score = ScoreResult(
                    score=0.0, confidence=0.0, ready=False,
                    org_id=oid, kind=ModelKind.ANOMALY.value,
                    details={"error": str(exc)},
                )
                s_score = ScoreResult(
                    score=0.0, confidence=0.0, ready=False,
                    org_id=oid, kind=ModelKind.SURGE.value,
                    details={"error": str(exc)},
                )

            do_save = self.auto_save if save is None else bool(save)
            if do_save:
                self._save_bundle_if_needed(bundle, force=save is True)

            self._stats["score_calls"] += 1
            elapsed = (time.perf_counter() - t0) * 1000.0

            return OrgScoreBundle(
                org_id        = oid,
                anomaly       = a_score,
                surge         = s_score,
                anomaly_learn = a_learn,
                surge_learn   = s_learn,
                processing_ms = round(elapsed, 3),
            )

    def score_only(self, org_id: str, features: Mapping[str, Any]) -> OrgScoreBundle:
        return self.score_and_learn(org_id, features, learn=False, save=False)

    # ------------------------------------------------------------------
    # Save / flush
    # ------------------------------------------------------------------

    def _save_bundle_if_needed(
        self, bundle: OrgModels, *, force: bool = False
    ) -> None:
        saved_any = False
        for model in (bundle.anomaly, bundle.surge):
            try:
                if force or self.store.should_save(model, force=force):
                    if self.store.save(model, force=True):
                        saved_any = True
                        self._stats["saves"] += 1
            except Exception as exc:
                self._stats["errors"] += 1
                logger.exception(
                    "save failed org=%s model=%s: %s",
                    bundle.org_id, model.kind, exc,
                )
        if saved_any:
            bundle.last_save_at = time.time()

    def save_org(self, org_id: str, *, force: bool = True) -> bool:
        self._ensure_open()
        oid = (org_id or "unknown").strip() or "unknown"
        with self._org_lock(oid):
            with self._global:
                bundle = self._orgs.get(oid)
            if bundle is None:
                return False
            self._save_bundle_if_needed(bundle, force=force)
            return True

    def save_all(self, *, force: bool = True) -> int:
        """Flush all in-memory orgs. Returns number of orgs attempted."""
        with self._global:
            org_ids = list(self._orgs.keys())
        n = 0
        for oid in org_ids:
            try:
                if self.save_org(oid, force=force):
                    n += 1
            except Exception as exc:
                logger.exception("save_all org=%s: %s", oid, exc)
        return n

    # ------------------------------------------------------------------
    # Eviction
    # ------------------------------------------------------------------

    def _maybe_evict_unlocked(self) -> None:
        """Caller must hold _global."""
        if len(self._orgs) <= self.max_orgs_in_memory:
            now  = time.time()
            idle = [
                oid for oid, b in self._orgs.items()
                if (now - b.last_access_at) >= self.idle_evict_sec
            ]
            for oid in idle[:8]:
                self._evict_one_unlocked(oid)
            return

        ordered  = sorted(self._orgs.items(), key=lambda kv: kv[1].last_access_at)
        overflow = len(self._orgs) - self.max_orgs_in_memory
        for oid, _ in ordered[: max(1, overflow)]:
            self._evict_one_unlocked(oid)

    def _evict_one_unlocked(self, org_id: str) -> None:
        bundle = self._orgs.get(org_id)
        if bundle is None:
            return
        try:
            self.store.save(bundle.anomaly, force=True)
            self.store.save(bundle.surge,   force=True)
            self._stats["saves"] += 2
        except Exception as exc:
            logger.warning("evict save failed org=%s: %s", org_id, exc)
        self._orgs.pop(org_id, None)
        self._stats["evictions"] += 1
        logger.info("Evicted org models from memory org=%s", org_id)

    def evict_org(self, org_id: str, *, save: bool = True) -> bool:
        oid = (org_id or "unknown").strip() or "unknown"
        with self._org_lock(oid):
            with self._global:
                if oid not in self._orgs:
                    return False
                if save:
                    b = self._orgs[oid]
                    try:
                        self.store.save(b.anomaly, force=True)
                        self.store.save(b.surge,   force=True)
                    except Exception as exc:
                        logger.warning("evict_org save: %s", exc)   # إصلاح: كان exp
                self._orgs.pop(oid, None)
                self._stats["evictions"] += 1
                return True

    # ------------------------------------------------------------------
    # Introspection / admin
    # ------------------------------------------------------------------

    def list_loaded_orgs(self) -> List[str]:
        """الـ orgs اللي في الذاكرة دلوقتي."""
        with self._global:
            return list(self._orgs.keys())

    def list_orgs(self) -> List[str]:
        """
        كل الـ orgs المدرّبة: في الذاكرة + على الديسك.
        بيستخدمها scripts/bootstrap_training.py --list-orgs
        """
        in_memory = set(self.list_loaded_orgs())
        on_disk   = set(self.store.list_orgs()) if hasattr(self.store, "list_orgs") else set()
        return sorted(in_memory | on_disk)

    def is_bootstrapping(self, org_id: str) -> bool:
        """True لو الـ org لسه في مرحلة التدريب الأولي."""
        with self._global:
            return org_id in self._bootstrapping

    def get_info(self, org_id: str) -> Optional[Dict[str, Any]]:
        oid = (org_id or "unknown").strip() or "unknown"
        with self._global:
            b = self._orgs.get(oid)
            if b is None:
                return None
            return b.info()

    def stats(self) -> Dict[str, Any]:
        with self._global:
            return {
                **self._stats,
                "loaded_orgs":    len(self._orgs),
                "bootstrapping":  list(self._bootstrapping),
                "closed":         self._closed,
                "store":          str(self.store.root),
            }

    def reset_org(self, org_id: str, *, delete_disk: bool = False) -> bool:
        """Drop in-memory models; optionally wipe disk."""
        oid = (org_id or "unknown").strip() or "unknown"
        with self._org_lock(oid):
            with self._global:
                self._orgs.pop(oid, None)
            if delete_disk:
                self.store.delete(oid)
            return True

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Save all and stop accepting work."""
        if self._closed:
            return
        logger.info(
            "ModelRegistry shutting down — flushing %s orgs", len(self._orgs)
        )
        try:
            self.save_all(force=True)
        finally:
            with self._global:
                self._orgs.clear()
                self._closed = True
        logger.info("ModelRegistry closed stats=%s", self._stats)


# =============================================================================
# Process singleton
# =============================================================================

_registry:      Optional[ModelRegistry] = None
_registry_lock: threading.Lock          = threading.Lock()


def get_registry() -> ModelRegistry:
    global _registry
    with _registry_lock:
        if _registry is None:
            _registry = ModelRegistry()
        return _registry


def init_registry(
    *,
    store:    Optional[ModelStore]   = None,
    settings: Optional[Settings]     = None,
    **kwargs: Any,
) -> ModelRegistry:
    global _registry
    with _registry_lock:
        if _registry is not None and not _registry.closed:
            try:
                _registry.close()
            except Exception:
                pass
        _registry = ModelRegistry(store=store, settings=settings, **kwargs)
        return _registry


def close_registry() -> None:
    global _registry
    with _registry_lock:
        if _registry is not None:
            _registry.close()
            _registry = None


__all__ = [
    "OrgModels",
    "OrgScoreBundle",
    "ModelRegistry",
    "get_registry",
    "init_registry",
    "close_registry",
]