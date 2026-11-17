# app/features/session_tracker.py
# ============================================================
# Zero Plus — AI Service
# Session tracker — behaviour memory + drift across requests
# Redis-backed, fail-open, fast, multi-signal identity
# ============================================================

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import threading
import time
import zlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.config import Settings, get_settings
from app.persistence.redis_client import RedisClient, get_redis
from app.schemas.request import AnalyzeRequest

logger = logging.getLogger("zero-plus-ai.session")


# =============================================================================
# Constants
# =============================================================================

SCHEMA_VERSION = 2            # bump when the stored layout changes -> history restarts
META_SUFFIX = ":meta"
ROTATION_PREFIX = "zp:sessrot"
MAX_FEATURE_DIMS = 256        # safety cap on vector width

DEFAULT_MIN_HISTORY = 3       # entries needed before drift is fully trusted
DEFAULT_HIGH_STREAK_LIMIT = 5 # consecutive high-drift requests before we adopt them as baseline
DEFAULT_ROTATION_THRESHOLD = 12
ROTATION_WINDOW = 64

# Fusion weights (sum = 1.0)
W_COS_LAST = 0.30
W_COS_MEAN = 0.20
W_L1_LAST = 0.20
W_L1_MEAN = 0.10
W_MAX_JUMP = 0.15
W_VOLATILITY = 0.05


# =============================================================================
# Result types
# =============================================================================

@dataclass
class SessionDriftResult:
    """Output of a drift computation for the current request."""

    score: float                          # 0.0 = same as before / no history → 1.0 = very different
    is_high: bool = False
    is_medium: bool = False
    history_size: int = 0
    compared_against: Optional[str] = None   # kept for backward compatibility (same as identity_key)
    identity_key: Optional[str] = None
    identity_kind: Optional[str] = None      # sid | dfp | ja4ip | ip | org
    confidence: float = 0.0                  # 0..1, grows with history size
    low_confidence: bool = False             # True when identity is weak / shared
    identity_rotation: bool = False          # many different identities from one IP
    details: Dict[str, float] = field(default_factory=dict)
    reasons: Tuple[str, ...] = ()


@dataclass
class SessionUpdateResult:
    """What happened after we stored the current vector."""

    identity_key: str
    history_size_after: int
    stored: bool
    drift: SessionDriftResult


# =============================================================================
# Identity resolution
# =============================================================================

def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _get_salt() -> str:
    try:
        return str(getattr(get_settings(), "session_hash_salt", "") or "")
    except Exception:
        return ""


def _short_hash(text: str, n: int = 20, salt: Optional[str] = None) -> str:
    """Keyed hash (HMAC) when a salt exists, plain SHA-256 otherwise."""
    if salt is None:
        salt = _get_salt()
    data = text.encode("utf-8")
    if salt:
        digest = hmac.new(salt.encode("utf-8"), data, hashlib.sha256).hexdigest()
    else:
        digest = hashlib.sha256(data).hexdigest()
    return digest[:n]


def resolve_identity(req: AnalyzeRequest, salt: Optional[str] = None) -> Tuple[str, str]:
    """
    Returns (identity_key, kind).

    Priority (strong → weak):
      1) org + session_id          kind=sid
      2) org + device_fp           kind=dfp
      3) org + ja4 + ip            kind=ja4ip
      4) org + ip                  kind=ip
      5) org only (shared bucket)  kind=org   -> drift is NOT computed for this one
    """
    org = _clean(req.org_id) or "unknown"

    session_id = _clean(req.session_id)
    if session_id:
        return f"zp:sess:{org}:sid:{_short_hash(session_id, salt=salt)}", "sid"

    device_fp = _clean(req.device_fp)
    if not device_fp and req.fingerprint_auth is not None:
        device_fp = _clean(req.fingerprint_auth.device_fp)
    if device_fp:
        return f"zp:sess:{org}:dfp:{_short_hash(device_fp, salt=salt)}", "dfp"

    ja4 = _clean(req.ja4)
    if not ja4 and req.fingerprint_auth is not None:
        ja4 = _clean(req.fingerprint_auth.ja4)
    ip = _clean(req.ip)
    if ja4 and ip:
        return f"zp:sess:{org}:ja4ip:{_short_hash(ja4 + '|' + ip, salt=salt)}", "ja4ip"

    if ip:
        return f"zp:sess:{org}:ip:{_short_hash(ip, salt=salt)}", "ip"

    return f"zp:sess:{org}:org:default", "org"


def build_identity_key(req: AnalyzeRequest) -> str:
    """Backward-compatible wrapper: returns only the key."""
    return resolve_identity(req)[0]


# =============================================================================
# Vector math (pure Python)
# =============================================================================

def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _norm(a: Sequence[float]) -> float:
    return math.sqrt(sum(x * x for x in a))


def mean_vector(vectors: List[List[float]]) -> List[float]:
    if not vectors:
        return []
    dim = len(vectors[0])
    acc = [0.0] * dim
    for v in vectors:
        for i, x in enumerate(v):
            acc[i] += x
    n = float(len(vectors))
    return [x / n for x in acc]


def cos_dist(a: Sequence[float], b: Sequence[float]) -> float:
    """
    Cosine distance on a true 0..1 scale (1 - similarity, clamped).
    Features are non-negative, so similarity is in [0, 1] and distance in [0, 1].
    Zero-vector handling:
      both zero  -> 0.0 (nothing happened in both)
      one zero   -> 1.0 (silence vs activity is a real change)
    """
    na, nb = _norm(a), _norm(b)
    if na == 0.0 and nb == 0.0:
        return 0.0
    if na == 0.0 or nb == 0.0:
        return 1.0
    sim = _dot(a, b) / (na * nb)
    sim = max(-1.0, min(1.0, sim))
    return max(0.0, min(1.0, 1.0 - sim))


def l1_active(a: Sequence[float], b: Sequence[float]) -> float:
    """
    Mean absolute difference over ACTIVE dimensions only (where either side != 0),
    each difference capped at 1.0. One feature jumping fully among 3 active
    features gives 0.33, not 1/30.
    """
    total = 0.0
    active = 0
    for x, y in zip(a, b):
        if x != 0.0 or y != 0.0:
            active += 1
            total += min(1.0, abs(x - y))
    return total / active if active else 0.0


def max_jump(a: Sequence[float], b: Sequence[float]) -> float:
    """Largest single-feature change (capped at 1.0)."""
    best = 0.0
    for x, y in zip(a, b):
        d = min(1.0, abs(x - y))
        if d > best:
            best = d
    return best


def _fit(vec: Sequence[float], dim: int) -> List[float]:
    v = [float(x) for x in vec]
    if len(v) < dim:
        return v + [0.0] * (dim - len(v))
    if len(v) > dim:
        return v[:dim]
    return v


# =============================================================================
# Feature ordering
# =============================================================================

def features_to_vector(
    features: Dict[str, float],
    ordered_keys: Sequence[str],
) -> List[float]:
    return [float(features.get(k, 0.0)) for k in ordered_keys]


def resolve_feature_keys(
    features: Dict[str, float],
    preferred: Optional[Sequence[str]] = None,
) -> List[str]:
    if preferred:
        return list(preferred)
    return sorted(features.keys())


# =============================================================================
# Drift scoring
# =============================================================================

def compute_drift_score(
    current: List[float],
    history_vectors: List[List[float]],
    *,
    high_threshold: float,
    medium_threshold: float,
    min_history: int = DEFAULT_MIN_HISTORY,
) -> SessionDriftResult:
    """
    Multi-signal drift (all signals on a 0..1 scale):
      - cosine vs last request      (direction change, short-term)
      - cosine vs history mean      (direction change vs baseline)
      - L1 over active dims vs last (magnitude change)
      - L1 over active dims vs mean
      - max single-feature jump     (one feature exploding)
      - volatility                  (how jumpy the history already is)

    The result is scaled by confidence = min(1, history / min_history),
    so a visitor with 1 prior request cannot produce a full-strength score.
    """
    if not history_vectors or not current:
        return SessionDriftResult(
            score=0.0,
            history_size=len(history_vectors),
            confidence=0.0,
            details={"vs_last_cos": 0.0, "vs_mean_cos": 0.0, "volatility": 0.0},
            reasons=("no_history",),
        )

    dim = len(current)
    hist = [_fit(v, dim) for v in history_vectors]
    last = hist[-1]
    mean = mean_vector(hist)

    vs_last_cos = cos_dist(current, last)
    vs_mean_cos = cos_dist(current, mean)
    vs_last_l1 = l1_active(current, last)
    vs_mean_l1 = l1_active(current, mean)
    jump = max_jump(current, last)

    volatility = 0.0
    if len(hist) >= 2:
        gaps = [cos_dist(hist[i], hist[i + 1]) for i in range(len(hist) - 1)]
        volatility = sum(gaps) / len(gaps)

    raw = (
        W_COS_LAST * vs_last_cos
        + W_COS_MEAN * vs_mean_cos
        + W_L1_LAST * vs_last_l1
        + W_L1_MEAN * vs_mean_l1
        + W_MAX_JUMP * jump
        + W_VOLATILITY * volatility
    )
    raw = max(0.0, min(1.0, raw))

    confidence = min(1.0, len(hist) / float(max(1, min_history)))
    score = max(0.0, min(1.0, raw * confidence))

    reasons: List[str] = []
    if score >= high_threshold:
        reasons.append("high_drift")
    elif score >= medium_threshold:
        reasons.append("medium_drift")
    else:
        reasons.append("stable")

    if confidence < 1.0:
        reasons.append("warming_up")
    if vs_last_cos >= high_threshold:
        reasons.append("jump_from_last")
    if vs_mean_cos >= high_threshold:
        reasons.append("away_from_baseline")
    if jump >= 0.8:
        reasons.append("single_feature_spike")

    return SessionDriftResult(
        score=score,
        is_high=score >= high_threshold,
        is_medium=medium_threshold <= score < high_threshold,
        history_size=len(hist),
        confidence=round(confidence, 4),
        details={
            "vs_last_cos": round(vs_last_cos, 6),
            "vs_mean_cos": round(vs_mean_cos, 6),
            "vs_last_l1": round(vs_last_l1, 6),
            "vs_mean_l1": round(vs_mean_l1, 6),
            "max_jump": round(jump, 6),
            "volatility": round(volatility, 6),
            "raw_score": round(raw, 6),
        },
        reasons=tuple(reasons),
    )


# =============================================================================
# Storage format in Redis
# =============================================================================
#
# History key: identity_key
#   Type: List of JSON strings (oldest → newest)
#   Item: {"t": unix_ts, "v": [...], "sv": SCHEMA_VERSION}
#
# Meta key: identity_key + ":meta"   (SINGLE source of truth for feature order)
#   JSON: {schema, feature_keys, updated_at, history_size, ttl_sec, high_streak}
#
# Feature keys are append-only: new features are added at the END, so old
# vectors (shorter) are still valid when padded with zeros.
#
# Rotation key: zp:sessrot:{org}:{hash(ip)}
#   List of identity keys recently seen from this IP (distinct, capped).
#

def _serialize_entry(ts: float, vector: List[float]) -> str:
    payload: Dict[str, Any] = {"t": ts, "v": vector, "sv": SCHEMA_VERSION}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _deserialize_entry(raw: Any) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        if not isinstance(data.get("v"), list):
            return None
        if data.get("sv") != SCHEMA_VERSION:
            return None
        return data
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


# =============================================================================
# Per-identity locks (protect read-compute-write within ONE process)
# =============================================================================

_LOCKS: Tuple[threading.Lock, ...] = tuple(threading.Lock() for _ in range(64))


def _lock_for(identity: str) -> threading.Lock:
    return _LOCKS[zlib.crc32(identity.encode("utf-8")) % len(_LOCKS)]


# =============================================================================
# Main tracker
# =============================================================================

class SessionTracker:
    """
    Tracks per-visitor feature history and computes behavioural drift.

    Typical use inside /analyze:
        tracker = get_session_tracker()
        result = tracker.observe(req, features, trusted=not already_flagged_malicious)
        drift_score = result.drift.score

    Optional settings (all have safe defaults, nothing required in .env):
        session_hash_salt            secret salt for identity hashing
        session_min_history          entries before drift is fully trusted (3)
        session_store_high_drift     store high-drift requests too (False)
        session_high_streak_limit    high-drift streak before adopting as baseline (5)
        session_rotation_check       detect many identities per IP (True)
        session_rotation_threshold   distinct identities per IP to flag (12)
    """

    def __init__(
        self,
        redis_client: Optional[RedisClient] = None,
        settings: Optional[Settings] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.redis = redis_client or get_redis()
        s = self.settings
        self.history_size = int(s.session_history_size)
        self.ttl_sec = int(s.session_ttl_sec)
        self.high_th = float(s.session_drift_high_threshold)
        self.medium_th = float(s.session_drift_medium_threshold)

        self.salt = str(getattr(s, "session_hash_salt", "") or "")
        self.min_history = int(getattr(s, "session_min_history", DEFAULT_MIN_HISTORY))
        self.store_high = bool(getattr(s, "session_store_high_drift", False))
        self.high_streak_limit = int(
            getattr(s, "session_high_streak_limit", DEFAULT_HIGH_STREAK_LIMIT)
        )
        self.rotation_check = bool(getattr(s, "session_rotation_check", True))
        self.rotation_threshold = int(
            getattr(s, "session_rotation_threshold", DEFAULT_ROTATION_THRESHOLD)
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def observe(
        self,
        req: AnalyzeRequest,
        features: Dict[str, float],
        *,
        store: bool = True,
        trusted: bool = True,
    ) -> SessionUpdateResult:
        """
        Full cycle:
          1) resolve identity (shared "org" bucket is skipped)
          2) load meta + history, validate schema
          3) compute drift
          4) decide whether this request may enter the baseline
          5) append + refresh meta/TTL

        trusted=False means "the caller already judged this request malicious":
        it is scored but never written to the baseline.
        Never raises: on Redis/other failure returns a neutral result (fail-open).
        """
        identity, kind = resolve_identity(req, self.salt)

        if kind == "org":
            drift = SessionDriftResult(
                score=0.0,
                identity_key=identity,
                compared_against=identity,
                identity_kind=kind,
                low_confidence=True,
                reasons=("shared_bucket_no_drift",),
            )
            return SessionUpdateResult(identity, 0, False, drift)

        try:
            with _lock_for(identity):
                return self._observe_locked(
                    req, features, identity, kind, store=store, trusted=trusted
                )
        except Exception:
            logger.warning("Session tracker failed for %s", identity, exc_info=True)
            drift = SessionDriftResult(
                score=0.0,
                identity_key=identity,
                compared_against=identity,
                identity_kind=kind,
                low_confidence=True,
                reasons=("tracker_unavailable",),
            )
            return SessionUpdateResult(identity, 0, False, drift)

    def peek_drift(
        self,
        req: AnalyzeRequest,
        features: Dict[str, float],
    ) -> SessionDriftResult:
        """Compute drift without writing (dry-run / debug)."""
        return self.observe(req, features, store=False).drift

    def get_history_size(self, req: AnalyzeRequest) -> int:
        identity = build_identity_key(req)
        try:
            return int(self.redis.list_llen(identity))
        except Exception:
            logger.warning("get_history_size failed for %s", identity, exc_info=True)
            return 0

    def clear_session(self, req: AnalyzeRequest) -> bool:
        """Drop history for this identity (e.g. after revoke / explicit reset)."""
        return self.clear_by_key(build_identity_key(req))

    def clear_by_key(self, identity_key: str) -> bool:
        try:
            n = self.redis.delete(identity_key, identity_key + META_SUFFIX)
            return n > 0
        except Exception:
            logger.warning("clear failed for %s", identity_key, exc_info=True)
            return False

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _observe_locked(
        self,
        req: AnalyzeRequest,
        features: Dict[str, float],
        identity: str,
        kind: str,
        *,
        store: bool,
        trusted: bool,
    ) -> SessionUpdateResult:
        meta = self._load_meta(identity)
        entries = self._load_history(identity)

        feature_keys, entries, schema_reset = self._resolve_schema(features, entries, meta)
        if schema_reset:
            meta = None  # old meta is not trustworthy either

        history_vectors = self._entries_to_vectors(entries, feature_keys)
        current_vector = features_to_vector(features, feature_keys)

        drift = compute_drift_score(
            current_vector,
            history_vectors,
            high_threshold=self.high_th,
            medium_threshold=self.medium_th,
            min_history=self.min_history,
        )
        drift.identity_key = identity
        drift.compared_against = identity
        drift.identity_kind = kind
        drift.low_confidence = kind in ("ip",)  # IP-only identity is weak (NAT / shared IPs)

        reasons: List[str] = list(drift.reasons)
        if schema_reset:
            reasons.append("schema_reset")
        if kind == "ip":
            reasons.append("weak_identity_ip_only")

        # ---- identity rotation (many identities from one IP) ----
        if self.rotation_check:
            distinct = self._track_rotation(req, identity, kind, store=store and trusted)
            if distinct:
                drift.details["ip_distinct_identities"] = float(distinct)
            if distinct >= self.rotation_threshold:
                drift.identity_rotation = True
                reasons.append("identity_rotation")

        # ---- decide whether this request may become part of the baseline ----
        write_allowed = store and trusted
        push = write_allowed
        prev_streak = 0
        if isinstance(meta, dict):
            try:
                prev_streak = int(meta.get("high_streak", 0))
            except (TypeError, ValueError):
                prev_streak = 0
        streak = 0

        if write_allowed and drift.is_high and not self.store_high:
            streak = prev_streak + 1
            if streak >= self.high_streak_limit:
                reasons.append("baseline_adopted_after_streak")
                streak = 0
            else:
                push = False
                reasons.append("not_stored_high_drift")
        elif store and not trusted:
            reasons.append("not_stored_untrusted")

        drift.reasons = tuple(reasons)

        stored = False
        size_after = len(history_vectors)

        if schema_reset and write_allowed:
            self.redis.delete(identity, identity + META_SUFFIX)

        if push:
            stored = self._append(identity=identity, vector=current_vector)
            if stored:
                size_after = min(len(history_vectors) + 1, self.history_size)

        if write_allowed:
            self._write_meta(identity, feature_keys, streak)

        return SessionUpdateResult(
            identity_key=identity,
            history_size_after=size_after,
            stored=stored,
            drift=drift,
        )

    # ---------- loading ----------

    def _load_meta(self, identity: str) -> Optional[Dict[str, Any]]:
        meta = self.redis.get_json(identity + META_SUFFIX)
        return meta if isinstance(meta, dict) else None

    def _load_history(self, identity: str) -> List[Dict[str, Any]]:
        raw_items = self.redis.list_lrange(identity, 0, -1) or []
        entries: List[Dict[str, Any]] = []
        for raw in raw_items:
            item = _deserialize_entry(raw)
            if item is not None:
                entries.append(item)
        return entries

    # ---------- schema ----------

    def _resolve_schema(
        self,
        features: Dict[str, float],
        entries: List[Dict[str, Any]],
        meta: Optional[Dict[str, Any]],
    ) -> Tuple[List[str], List[Dict[str, Any]], bool]:
        """
        Meta is the only source of truth for feature order.
        - valid meta  -> keep its order, append unseen features at the END
        - no/invalid meta + existing history -> history can't be interpreted safely -> restart it
        - too many dims -> restart
        Returns (keys, entries_to_use, reset_happened).
        """
        stored_keys: Optional[List[str]] = None
        if meta and meta.get("schema") == SCHEMA_VERSION:
            k = meta.get("feature_keys")
            if isinstance(k, list) and k and all(isinstance(x, str) for x in k):
                stored_keys = list(k)

        if stored_keys is None:
            reset = bool(entries)
            return resolve_feature_keys(features), ([] if reset else entries), reset

        existing = set(stored_keys)
        keys = stored_keys + [k for k in sorted(features.keys()) if k not in existing]

        if len(keys) > MAX_FEATURE_DIMS:
            return resolve_feature_keys(features), [], True

        return keys, entries, False

    def _entries_to_vectors(
        self,
        entries: List[Dict[str, Any]],
        feature_keys: List[str],
    ) -> List[List[float]]:
        dim = len(feature_keys)
        vectors: List[List[float]] = []
        for entry in entries:
            v = entry.get("v")
            if not isinstance(v, list):
                continue
            try:
                vectors.append(_fit(v, dim))
            except (TypeError, ValueError):
                continue
        return vectors

    # ---------- writing ----------

    def _append(self, *, identity: str, vector: List[float]) -> bool:
        payload = _serialize_entry(time.time(), vector)
        ok = self.redis.list_push_cap(
            identity,
            payload,
            max_len=self.history_size,
            ttl_sec=self.ttl_sec,
        )
        if not ok:
            logger.warning("Failed to append session history for %s", identity)
            return False
        return True

    def _write_meta(self, identity: str, feature_keys: List[str], high_streak: int) -> None:
        meta = {
            "schema": SCHEMA_VERSION,
            "feature_keys": feature_keys,
            "updated_at": time.time(),
            "history_size": self.history_size,
            "ttl_sec": self.ttl_sec,
            "high_streak": int(high_streak),
        }
        self.redis.set_json(identity + META_SUFFIX, meta, ttl_sec=self.ttl_sec)

    # ---------- identity rotation ----------

    def _track_rotation(
        self,
        req: AnalyzeRequest,
        identity: str,
        kind: str,
        *,
        store: bool,
    ) -> int:
        """
        Count distinct client-controlled identities (sid / dfp) seen from the same IP.
        A bot that rotates session_id on every request shows up here.
        NOTE: offices / mobile carriers (NAT) can also have many real users per IP,
        so this is a FLAG, not a score input.
        """
        if kind not in ("sid", "dfp"):
            return 0
        ip = _clean(req.ip)
        if not ip:
            return 0

        org = _clean(req.org_id) or "unknown"
        key = f"{ROTATION_PREFIX}:{org}:{_short_hash(ip, salt=self.salt)}"
        try:
            raw = self.redis.list_lrange(key, 0, -1) or []
            seen = set()
            for item in raw:
                if isinstance(item, bytes):
                    item = item.decode("utf-8", "ignore")
                seen.add(str(item))
            is_new = identity not in seen
            seen.add(identity)
            if store and is_new:
                self.redis.list_push_cap(
                    key,
                    identity,
                    max_len=ROTATION_WINDOW,
                    ttl_sec=self.ttl_sec,
                )
            return len(seen)
        except Exception:
            logger.debug("rotation tracking failed for %s", key, exc_info=True)
            return 0


# =============================================================================
# Module-level convenience
# =============================================================================

_tracker: Optional[SessionTracker] = None
_tracker_lock = threading.Lock()


def get_session_tracker() -> SessionTracker:
    global _tracker
    if _tracker is None:
        with _tracker_lock:
            if _tracker is None:
                _tracker = SessionTracker()
    return _tracker


def observe_session(
    req: AnalyzeRequest,
    features: Dict[str, float],
    *,
    store: bool = True,
    trusted: bool = True,
) -> SessionUpdateResult:
    """Shortcut used by /analyze."""
    return get_session_tracker().observe(req, features, store=store, trusted=trusted)


__all__ = [
    "SessionDriftResult",
    "SessionUpdateResult",
    "SessionTracker",
    "build_identity_key",
    "resolve_identity",
    "compute_drift_score",
    "get_session_tracker",
    "observe_session",
]