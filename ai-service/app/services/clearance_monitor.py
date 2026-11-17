# app/services/clearance_monitor.py
# ============================================================
# Zero Plus — AI Service
# Clearance monitor
#
# بيفهم بالظبط شكل التوكن اللي بيعمله clearance.ts في الـ Gateway:
#   base64url(JSON payload) . base64url(HMAC-SHA256)
#   payload = { v, o, ip, d, iat, exp, n }
#
# المراقبة بتشمل:
#   1. التحقق من التوقيع (بدون سر → structural check بس)
#   2. سلامة الـ payload (منطق وقت، تعارضات)
#   3. الربط بالزائر (ip / device / ja4 عند أول ظهور)
#   4. تدوير الهوية (نفس التوكن مع هويات مختلفة)
#   5. اتخاذ قرار KEEP / REVALIDATE / ADVANCED_FINGERPRINT / REVOKE
#      بناءً على النقط والـ streak
#
# Fail-open دايماً: أي exception → KEEP
# SHADOW بالـ default: ما بيغيرش الرد الحقيقي
# ============================================================

from __future__ import annotations

import base64
import dataclasses
import hashlib
import hmac as hmac_lib
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol, Tuple

from app.persistence.redis_client import RedisClient, get_redis
from app.schemas.request import AnalyzeRequest, FutureAction
from app.schemas.response import Recommendation

logger = logging.getLogger("zero-plus-ai.clearance")

# =============================================================================
# Constants
# =============================================================================

KEY_PREFIX = "zp:clr"
CLEARANCE_VERSION = 1
COOKIE_NAME = "zp_clearance"

DEFAULTS: Dict[str, Any] = {
    "suspicious_points":          3,
    "advanced_streak":            2,
    "revoke_streak":              3,
    "revoke_points":              5,
    "streak_ttl_sec":           900,
    "binding_ttl_sec":    7 * 24 * 3600,
    "ttl_tolerance_sec":        120,
    "future_skew_sec":          300,
    "rotation_threshold":         4,
    "max_bound_identities":      16,
    "hard_risk":                0.80,
    "medium_risk":              0.50,
    "min_ttl_minutes":            1,
    "max_ttl_minutes":     60 * 24 * 7,
}

_SEVERITY: Dict[Recommendation, int] = {
    Recommendation.ALLOW:                  0,
    Recommendation.MONITOR:                1,
    Recommendation.RATE_LIMIT:             2,
    Recommendation.JAVASCRIPT_CHALLENGE:   3,
    Recommendation.ADVANCED_FINGERPRINT:   4,
    Recommendation.STRICT:                 5,
    Recommendation.REVOKE_CLEARANCE:       6,
    Recommendation.BLOCK:                  7,
}


# =============================================================================
# Enums
# =============================================================================

class Action(str, Enum):
    KEEP                 = "keep"
    REVALIDATE           = "revalidate_clearance"
    ADVANCED_FINGERPRINT = "advanced_fingerprint_check"
    REVOKE               = "revoke_clearance"


class Mode(str, Enum):
    SHADOW  = "shadow"   # حساب + log فقط، الرد ما بيتغيرش
    ENFORCE = "enforce"  # بيستدعي revoke_fn / advanced_check_fn


# =============================================================================
# Data classes
# =============================================================================

@dataclass(frozen=True)
class ParsedToken:
    """ناتج parse التوكن من الـ Gateway."""
    raw:      str
    version:  int
    org_id:   str
    ip:       str
    device:   Optional[str]
    iat:      float
    exp:      float
    nonce:    str
    sig_ok:   bool    # True لو السر موجود وصح / None لو ما عنديش السر
    sig_checked: bool # True لو عملنا verify فعلي


@dataclass(frozen=True)
class ClearanceSnapshot:
    """ملخص التصريح في الطلب الحالي."""
    present:      bool
    active:       bool
    token_id:     str         # hash(nonce) → مفتاح فريد للتوكن
    clearance_id: str         # hash(org+iat) → ثابت لنفس التوكن حتى لو تجدد
    org_id:       str
    identity_key: str
    expires_at:   Optional[float]
    issued_at:    Optional[float]
    ip_hash:      Optional[str]
    device_hash:  Optional[str]
    ja4_hash:     Optional[str]
    parsed:       Optional[ParsedToken]


@dataclass(frozen=True)
class MonitorSignals:
    drift_score:          float = 0.0
    drift_high:           bool  = False
    drift_medium:         bool  = False
    identity_rotation:    bool  = False   # session tracker: كتير من IP واحد
    low_confidence:       bool  = False
    single_feature_spike: bool  = False
    risk_score:           float = 0.0
    path_level:           str   = "low"
    integrity_flags:      Tuple[str, ...] = ()
    binding_flags:        Tuple[str, ...] = ()
    clearance_rotation:   bool  = False   # نفس التوكن بهويات كتير


@dataclass
class ClearanceDecision:
    action:       Action
    forced:       bool
    points:       int
    streak:       int
    reasons:      Tuple[str, ...]
    clearance_id: str  = ""
    token_id:     str  = ""
    mode:         Mode = Mode.SHADOW
    executed:     bool = False
    would_execute: bool = False
    details:      Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return dataclasses.asdict(self)


# =============================================================================
# Helpers
# =============================================================================

def _clean(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _clamp01(v: Any) -> float:
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.0


def _to_ts(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.timestamp()
    if isinstance(v, (int, float)):
        return float(v)
    return None


def _salt() -> str:
    try:
        from app.config import get_settings
        return str(getattr(get_settings(), "session_hash_salt", "") or "")
    except Exception:
        return ""


def _clearance_secret() -> Optional[str]:
    """
    السر بتاع الـ Gateway عشان نتحقق من التوقيع.
    لو مش موجود نعمل structural check بس (مش نرفض).
    """
    try:
        from app.config import get_settings
        s = str(getattr(get_settings(), "clearance_secret", "") or "")
        return s if len(s) >= 16 else None
    except Exception:
        return None


def _keyed(text: str, salt: str, n: int = 24) -> str:
    data = text.encode("utf-8")
    if salt:
        return hmac_lib.new(
            salt.encode("utf-8"), data, hashlib.sha256
        ).hexdigest()[:n]
    return hashlib.sha256(data).hexdigest()[:n]


# =============================================================================
# Token parser
# يفهم شكل التوكن: base64url(payload).base64url(sig)
# =============================================================================

def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((-len(s)) % 4)
    return base64.urlsafe_b64decode(s + pad)


def parse_clearance_token(raw: str) -> Optional[ParsedToken]:
    """
    يفك التوكن اللي بناه issueClearanceToken في clearance.ts
    مش بيرفع exception — بيرجع None لو التوكن مشوّه.
    """
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()
    parts = raw.split(".")
    if len(parts) != 2:
        return None
    body_b64, sig_b64 = parts[0], parts[1]
    try:
        payload_bytes = _b64url_decode(body_b64)
        p = json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        return None

    if not isinstance(p, dict):
        return None

    # التحقق من التوقيع
    secret = _clearance_secret()
    sig_ok = False
    sig_checked = False
    if secret:
        sig_checked = True
        try:
            expected_mac = hmac_lib.new(
                secret.encode("utf-8"),
                body_b64.encode("utf-8"),
                hashlib.sha256,
            ).digest()
            expected_b64 = (
                base64.urlsafe_b64encode(expected_mac)
                .rstrip(b"=")
                .decode("ascii")
            )
            # timing-safe compare
            sig_ok = hmac_lib.compare_digest(expected_b64, sig_b64)
        except Exception:
            sig_ok = False

    version = p.get("v", 0)
    org = _clean(p.get("o"))
    if org is None:
        return None

    return ParsedToken(
        raw=raw,
        version=int(version),
        org_id=org,
        ip=str(p.get("ip") or ""),
        device=_clean(p.get("d")),
        iat=float(p.get("iat") or 0),
        exp=float(p.get("exp") or 0),
        nonce=str(p.get("n") or ""),
        sig_ok=sig_ok,
        sig_checked=sig_checked,
    )


# =============================================================================
# Token extraction from AnalyzeRequest
# الـ Gateway بيبعت الكوكي الخام أو قيم منه في الـ clearance payload
# =============================================================================

def _extract_raw_token(req: AnalyzeRequest) -> Optional[str]:
    """
    يحاول يجيب التوكن الخام بكل الطرق الممكنة.
    الـ Gateway ممكن يبعته في:
      - req.clearance.source (لو الـ payload فيه raw token) — مش standard
      - req.extra["clearance_token"]
      - req.fingerprint_auth.signals["clearance_token"]
    """
    if req.extra and isinstance(req.extra, dict):
        t = _clean(req.extra.get("clearance_token"))
        if t:
            return t
    fa = req.fingerprint_auth
    if fa and fa.signals and isinstance(fa.signals, dict):
        t = _clean(fa.signals.get("clearance_token"))
        if t:
            return t
    return None


def _extract_clearance_values(req: AnalyzeRequest) -> Dict[str, Any]:
    """
    يجمع كل القيم المتاحة من req.clearance سواء كانت parsed أو من payload.
    """
    p = req.clearance
    if p is None:
        return {}
    return {
        "present":    getattr(p, "present", None),
        "valid":      getattr(p, "valid", None),
        "expired":    getattr(p, "expired", None),
        "revoked":    getattr(p, "revoked", None),
        "issued_at":  _to_ts(getattr(p, "issued_at", None)),
        "expires_at": _to_ts(getattr(p, "expires_at", None)),
        "ttl_minutes": getattr(p, "ttl_minutes", None),
        "source":     getattr(p, "source", None),
    }


# =============================================================================
# Integrity checks (pure, no I/O)
# =============================================================================

def check_token_integrity(
    parsed: Optional[ParsedToken],
    vals: Dict[str, Any],
    now: float,
    *,
    cfg: Dict[str, Any],
    org_id: str,
) -> Tuple[str, ...]:
    """
    يشوف كل التناقضات الممكنة في التوكن والـ payload.
    """
    flags: List[str] = []
    tol  = int(cfg["ttl_tolerance_sec"])
    skew = int(cfg["future_skew_sec"])
    mn   = int(cfg["min_ttl_minutes"])
    mx   = int(cfg["max_ttl_minutes"])

    # ---- سلامة الـ parsed token ----
    if parsed is not None:
        if parsed.version != CLEARANCE_VERSION:
            flags.append("wrong_version")
        if parsed.sig_checked and not parsed.sig_ok:
            flags.append("bad_signature")
        if parsed.exp <= now:
            flags.append("token_expired")
        if parsed.iat > now + skew:
            flags.append("iat_in_future")
        if parsed.exp <= parsed.iat:
            flags.append("exp_before_iat")
        if parsed.org_id and parsed.org_id != org_id:
            flags.append("org_mismatch")
        if not parsed.nonce:
            flags.append("missing_nonce")
        # مدة التوكن
        duration_min = (parsed.exp - parsed.iat) / 60.0
        if duration_min < mn:
            flags.append("ttl_too_short")
        if duration_min > mx:
            flags.append("ttl_too_long")

    # ---- تناقضات الـ payload من الـ Gateway ----
    valid   = vals.get("valid")
    revoked = vals.get("revoked")
    expired = vals.get("expired")
    issued  = vals.get("issued_at")
    expires = vals.get("expires_at")
    ttl_m   = vals.get("ttl_minutes")
    source  = vals.get("source")

    if valid and revoked:
        flags.append("valid_and_revoked")
    if valid and expired:
        flags.append("valid_but_expired")
    if valid and expires is not None and expires <= now:
        flags.append("valid_past_expiry")
    if expires is None and parsed is None:
        flags.append("missing_expiry")
    if issued is not None and issued > now + skew:
        flags.append("issued_in_future")
    if issued is not None and expires is not None:
        if expires <= issued:
            flags.append("expires_before_issue")
        elif ttl_m is not None:
            actual_min = (expires - issued) / 60.0
            if abs(actual_min - ttl_m) > tol / 60.0:
                flags.append("ttl_mismatch")
    if ttl_m is not None and ttl_m <= 0:
        flags.append("non_positive_ttl")
    if source not in (None, "cookie", "header", "none"):
        flags.append("unknown_source")

    # ---- تناقض بين الـ parsed والـ payload ----
    if parsed is not None and expires is not None:
        if abs(parsed.exp - expires) > tol:
            flags.append("exp_mismatch_parsed_vs_payload")
    if parsed is not None and issued is not None:
        if abs(parsed.iat - issued) > tol:
            flags.append("iat_mismatch_parsed_vs_payload")

    return tuple(flags)


# =============================================================================
# ClearanceSnapshot builder
# =============================================================================

def build_snapshot(
    req: AnalyzeRequest,
    identity_key: str,
    now: float,
    *,
    salt: str,
) -> ClearanceSnapshot:
    p     = req.clearance
    vals  = _extract_clearance_values(req)
    raw   = _extract_raw_token(req)
    parsed = parse_clearance_token(raw) if raw else None

    present = bool(vals.get("present", False) if p is not None else False)
    if not present:
        return ClearanceSnapshot(
            present=False, active=False,
            token_id="", clearance_id="",
            org_id=_clean(req.org_id) or "unknown",
            identity_key=identity_key,
            expires_at=None, issued_at=None,
            ip_hash=None, device_hash=None, ja4_hash=None,
            parsed=None,
        )

    org     = _clean(req.org_id) or "unknown"
    issued  = vals.get("issued_at") or (parsed.iat if parsed else None)
    expires = vals.get("expires_at") or (parsed.exp if parsed else None)
    nonce   = parsed.nonce if parsed else ""

    # token_id: مفتاح هذا التوكن بالذات (يتغير لو اتجدد)
    token_id = _keyed(nonce, salt) if nonce else _keyed(
        f"{org}|{issued}|{expires}", salt
    )
    # clearance_id: ثابت لنفس الجلسة حتى لو التوكن اتجدد
    clearance_id = _keyed(
        f"{org}|{issued:.0f}" if issued else f"{org}|{identity_key}",
        salt,
    )

    valid   = bool(vals.get("valid", True))
    revoked = bool(vals.get("revoked", False))
    expired = bool(vals.get("expired", False))
    in_time = (expires is None) or (expires > now)
    sig_ok  = (parsed is None) or (not parsed.sig_checked) or parsed.sig_ok
    active  = present and valid and not revoked and not expired and in_time and sig_ok

    # جمع الـ fingerprints
    fa  = req.fingerprint_auth
    ip  = _clean(req.ip)
    dev = _clean(req.device_fp) or (
        _clean(fa.device_fp) if fa is not None else None
    )
    ja4 = _clean(req.ja4) or (
        _clean(fa.ja4) if fa is not None else None
    )
    # الـ ip من الـ token أهم لأنه وقت الإصدار
    token_ip = _clean(parsed.ip) if parsed else None
    ip_to_bind = token_ip or ip

    return ClearanceSnapshot(
        present=present,
        active=active,
        token_id=token_id,
        clearance_id=clearance_id,
        org_id=org,
        identity_key=identity_key,
        expires_at=expires,
        issued_at=issued,
        ip_hash=_keyed(ip_to_bind, salt) if ip_to_bind else None,
        device_hash=_keyed(dev, salt) if dev else None,
        ja4_hash=_keyed(ja4, salt) if ja4 else None,
        parsed=parsed,
    )


# =============================================================================
# Storage backends
# =============================================================================

class KVBackend(Protocol):
    def get_json(self, key: str) -> Optional[Any]: ...
    def set_json(self, key: str, value: Any, ttl_sec: int) -> bool: ...
    def incr(self, key: str, ttl_sec: int) -> Optional[int]: ...
    def delete(self, *keys: str) -> int: ...


class MemoryBackend:
    def __init__(self, now_fn=time.time) -> None:
        self._d: Dict[str, Tuple[Any, float]] = {}
        self._lock = threading.Lock()
        self._now = now_fn

    def _get(self, key: str) -> Any:
        item = self._d.get(key)
        if not item:
            return None
        val, exp = item
        if exp <= self._now():
            self._d.pop(key, None)
            return None
        return val

    def get_json(self, key: str) -> Optional[Any]:
        with self._lock:
            return self._get(key)

    def set_json(self, key: str, value: Any, ttl_sec: int) -> bool:
        with self._lock:
            self._d[key] = (value, self._now() + ttl_sec)
            return True

    def incr(self, key: str, ttl_sec: int) -> Optional[int]:
        with self._lock:
            cur = self._get(key)
            n = (cur if isinstance(cur, int) else 0) + 1
            self._d[key] = (n, self._now() + ttl_sec)
            return n

    def delete(self, *keys: str) -> int:
        with self._lock:
            return sum(1 for k in keys if self._d.pop(k, None) is not None)


class RedisBackend:
    def __init__(self, client: RedisClient) -> None:
        self.r = client

    def get_json(self, key: str) -> Optional[Any]:
        try:
            return self.r.get_json(key)
        except Exception:
            return None

    def set_json(self, key: str, value: Any, ttl_sec: int) -> bool:
        try:
            return bool(self.r.set_json(key, value, ttl_sec=ttl_sec))
        except Exception:
            return False

    def incr(self, key: str, ttl_sec: int) -> Optional[int]:
        try:
            n = self.r.incr(key)
            if n is not None:
                self.r.expire(key, ttl_sec)
            return n
        except Exception:
            return None

    def delete(self, *keys: str) -> int:
        try:
            return int(self.r.delete(*keys))
        except Exception:
            return 0


# =============================================================================
# Score + hard-revoke (pure logic)
# =============================================================================

def score_points(s: MonitorSignals, cfg: Dict[str, Any]) -> int:
    p = 0
    if s.drift_high:            p += 2
    elif s.drift_medium:        p += 1
    if s.single_feature_spike:  p += 1
    if s.identity_rotation:     p += 1
    if s.clearance_rotation:    p += 2
    if s.risk_score >= cfg["hard_risk"]:    p += 2
    elif s.risk_score >= cfg["medium_risk"]: p += 1
    if s.path_level == "critical":          p += 1
    if s.integrity_flags:                   p += 2
    if "ja4_changed"    in s.binding_flags: p += 2
    if "device_changed" in s.binding_flags: p += 2
    if "ip_changed"     in s.binding_flags: p += 1
    if "bad_signature"  in s.integrity_flags: p += 3  # أقوى إشارة
    if s.low_confidence:        p -= 1
    return max(0, p)


def is_hard_revoke(s: MonitorSignals, cfg: Dict[str, Any]) -> bool:
    # Case 1: توقيع خاطئ — نلغي فوراً بغض النظر عن أي حاجة
    if "bad_signature" in s.integrity_flags:
        return True
    # Case 2: مسار حساس + drift عالي + risk عالي + هوية قوية
    if (s.path_level == "critical"
            and s.drift_high
            and s.risk_score >= cfg["hard_risk"]
            and not s.low_confidence):
        return True
    # Case 3: مسار حساس + بصمة اتغيرت + risk عالي
    if (s.path_level == "critical"
            and ("ja4_changed" in s.binding_flags
                 or "device_changed" in s.binding_flags)
            and s.risk_score >= cfg["hard_risk"]):
        return True
    return False


# =============================================================================
# Signals adapter
# =============================================================================

def signals_from_drift(
    drift: Any,
    *,
    risk_score: float = 0.0,
    path_level: Any  = "low",
    integrity_flags: Tuple[str, ...] = (),
) -> MonitorSignals:
    reasons = tuple(getattr(drift, "reasons", ()) or ())
    level   = getattr(path_level, "value", path_level)
    return MonitorSignals(
        drift_score          = _clamp01(getattr(drift, "score", 0.0)),
        drift_high           = bool(getattr(drift, "is_high",   False)),
        drift_medium         = bool(getattr(drift, "is_medium", False)),
        identity_rotation    = bool(getattr(drift, "identity_rotation", False)),
        low_confidence       = bool(getattr(drift, "low_confidence",    False)),
        single_feature_spike = "single_feature_spike" in reasons,
        risk_score           = _clamp01(risk_score),
        path_level           = str(level or "low").lower(),
        integrity_flags      = tuple(integrity_flags),
    )


def combine_risk(anomaly_score: Any, risk_score_so_far: Any) -> float:
    a = _clamp01(anomaly_score)
    try:
        r = _clamp01(float(risk_score_so_far or 0.0) / 100.0)
    except (TypeError, ValueError):
        r = 0.0
    return max(a, r)


# =============================================================================
# Monitor
# =============================================================================

class ClearanceMonitor:

    def __init__(
        self,
        *,
        mode:              Mode = Mode.SHADOW,
        backend:           Optional[KVBackend] = None,
        revoke_fn          = None,       # (clearance_id, reason) -> bool
        advanced_check_fn  = None,       # (clearance_id) -> Any
        now_fn             = time.time,
        salt:              Optional[str] = None,
        **overrides: Any,
    ) -> None:
        cfg = dict(DEFAULTS)
        for k, v in overrides.items():
            if k not in cfg:
                raise TypeError(f"unknown clearance monitor option: {k!r}")
            cfg[k] = v
        self.mode             = mode
        self.cfg              = cfg
        self.salt             = _salt() if salt is None else salt
        self.revoke_fn        = revoke_fn
        self.advanced_check_fn = advanced_check_fn
        self._now             = now_fn
        self.backend: KVBackend = backend or MemoryBackend(now_fn)
        self._fallback        = MemoryBackend(now_fn)
        self._lock            = threading.Lock()

    # ------------------------------------------------------------------
    # Public entry
    # ------------------------------------------------------------------

    def evaluate(
        self,
        snap: ClearanceSnapshot,
        signals: MonitorSignals,
    ) -> ClearanceDecision:
        try:
            return self._evaluate(snap, signals)
        except Exception:
            logger.warning(
                "clearance monitor error cid=%s", snap.clearance_id, exc_info=True
            )
            return ClearanceDecision(
                action=Action.KEEP, forced=False, points=0, streak=0,
                reasons=("monitor_error_fail_open",),
                clearance_id=snap.clearance_id,
                token_id=snap.token_id,
                mode=self.mode,
            )

    # ------------------------------------------------------------------
    # Core
    # ------------------------------------------------------------------

    def _evaluate(
        self,
        snap: ClearanceSnapshot,
        signals: MonitorSignals,
    ) -> ClearanceDecision:
        now = self._now()

        if not snap.present:
            return self._make(snap, signals, Action.KEEP, False, 0, 0,
                              ("no_clearance",), execute=False)

        if not snap.active or (snap.expires_at and snap.expires_at <= now):
            return self._make(snap, signals, Action.KEEP, False, 0, 0,
                              ("clearance_inactive",), execute=False)

        with self._lock:
            return self._plan(snap, signals)

    def _plan(
        self,
        snap: ClearanceSnapshot,
        s: MonitorSignals,
    ) -> ClearanceDecision:
        cfg      = self.cfg
        k_streak = self._key(snap.clearance_id, "streak")
        k_rev    = self._key(snap.clearance_id, "revoked")
        k_tid    = self._key(snap.token_id,     "nonce_seen")

        # 1) سبق إلغاؤه
        if self._get(k_rev):
            return self._make(snap, s, Action.REVOKE, False, 0, 0,
                              ("already_revoked",), execute=False)

        # 2) كشف إعادة استخدام الـ nonce (نفس التوكن بيتستخدم من غير تجديد)
        nonce_flags = self._check_nonce(snap, k_tid)

        # 3) binding: ip / device / ja4
        bflags, rotation = self._update_binding(snap)

        # 4) ادمج الإشارات
        sig = dataclasses.replace(
            s,
            binding_flags=bflags,
            clearance_rotation=rotation,
            integrity_flags=s.integrity_flags + tuple(nonce_flags),
        )

        points = score_points(sig, cfg)

        # 5) hard revoke
        if is_hard_revoke(sig, cfg):
            self._delete(k_streak)
            return self._make(snap, sig, Action.REVOKE, True, points, 0,
                              ("hard_critical_anomaly",), execute=True)

        # 6) طبيعي → reset streak
        if points < cfg["suspicious_points"]:
            self._delete(k_streak)
            return self._make(snap, sig, Action.KEEP, False, points, 0,
                              ("stable",), execute=False)

        # 7) مشبوه → extend streak
        streak  = self._incr(k_streak, cfg["streak_ttl_sec"]) or 1
        reasons = [f"points:{points}", f"streak:{streak}"]

        if points >= cfg["revoke_points"] and streak >= cfg["revoke_streak"]:
            self._delete(k_streak)
            reasons.append("revoke_by_streak")
            return self._make(snap, sig, Action.REVOKE, False, points, streak,
                              tuple(reasons), execute=True)

        if streak >= cfg["advanced_streak"]:
            reasons.append("advanced_by_streak")
            return self._make(snap, sig, Action.ADVANCED_FINGERPRINT, False,
                              points, streak, tuple(reasons), execute=True)

        reasons.append("revalidate")
        return self._make(snap, sig, Action.REVALIDATE, False, points, streak,
                          tuple(reasons), execute=True)

    # ------------------------------------------------------------------
    # Nonce tracking: هل نفس التوكن بيتستخدم من IP مختلف؟
    # ------------------------------------------------------------------

    def _check_nonce(
        self, snap: ClearanceSnapshot, key: str
    ) -> List[str]:
        flags: List[str] = []
        if not snap.token_id:
            return flags
        rec = self._get(key)
        if not isinstance(rec, dict):
            self._set(key, {
                "ip":  snap.ip_hash,
                "dev": snap.device_hash,
                "ids": [snap.identity_key],
            }, int(self.cfg["binding_ttl_sec"]))
            return flags

        seen_ids: List[str] = rec.get("ids", [])
        changed  = False
        if snap.identity_key not in seen_ids:
            seen_ids = (seen_ids + [snap.identity_key])[-self.cfg["max_bound_identities"]:]
            rec["ids"] = seen_ids
            changed = True
        if changed:
            self._set(key, rec, int(self.cfg["binding_ttl_sec"]))

        if len(seen_ids) >= self.cfg["rotation_threshold"]:
            flags.append("nonce_identity_rotation")
        return flags

    # ------------------------------------------------------------------
    # Binding: ip / device / ja4 عند أول ظهور للـ clearance_id
    # ------------------------------------------------------------------

    def _update_binding(
        self, snap: ClearanceSnapshot
    ) -> Tuple[Tuple[str, ...], bool]:
        key = self._key(snap.clearance_id, "bind")
        rec = self._get(key)
        if not isinstance(rec, dict):
            self._set(key, {
                "ja4": snap.ja4_hash,
                "ip":  snap.ip_hash,
                "dev": snap.device_hash,
                "ids": [snap.identity_key],
            }, int(self.cfg["binding_ttl_sec"]))
            return (), False

        flags: List[str] = []
        changed = False

        # fill missing fields (never overwrite existing)
        for attr, stored in (
            ("ja4_hash", "ja4"), ("ip_hash", "ip"), ("device_hash", "dev")
        ):
            cur = getattr(snap, attr)
            if cur and not rec.get(stored):
                rec[stored] = cur
                changed = True

        if snap.ja4_hash    and rec.get("ja4") and snap.ja4_hash    != rec["ja4"]:
            flags.append("ja4_changed")
        if snap.device_hash and rec.get("dev") and snap.device_hash != rec["dev"]:
            flags.append("device_changed")
        if snap.ip_hash     and rec.get("ip")  and snap.ip_hash     != rec["ip"]:
            flags.append("ip_changed")

        ids: List[str] = [x for x in rec.get("ids", []) if isinstance(x, str)]
        if snap.identity_key not in ids:
            ids = (ids + [snap.identity_key])[-self.cfg["max_bound_identities"]:]
            rec["ids"] = ids
            changed = True
        if changed:
            self._set(key, rec, int(self.cfg["binding_ttl_sec"]))

        rotation = len(ids) >= self.cfg["rotation_threshold"]
        return tuple(flags), rotation

    # ------------------------------------------------------------------
    # Finish + side effects
    # ------------------------------------------------------------------

    def _make(
        self,
        snap:    ClearanceSnapshot,
        s:       MonitorSignals,
        action:  Action,
        forced:  bool,
        points:  int,
        streak:  int,
        reasons: Tuple[str, ...],
        *,
        execute: bool,
    ) -> ClearanceDecision:
        would    = action != Action.KEEP and execute
        executed = False
        details: Dict[str, Any] = {
            "org_id":             snap.org_id,
            "drift_score":        round(s.drift_score, 4),
            "risk_score":         round(s.risk_score,  4),
            "path_level":         s.path_level,
            "integrity_flags":    list(s.integrity_flags),
            "binding_flags":      list(s.binding_flags),
            "clearance_rotation": s.clearance_rotation,
            "identity_key":       snap.identity_key,
            "token_parsed":       snap.parsed is not None,
            "sig_checked":        snap.parsed.sig_checked if snap.parsed else False,
            "sig_ok":             snap.parsed.sig_ok     if snap.parsed else None,
            "mode":               self.mode.value,
            "shadow_preview":     _to_rec(action).value if would else None,
        }

        if would and self.mode == Mode.ENFORCE:
            if action == Action.REVOKE:
                if self.revoke_fn is not None:
                    try:
                        executed = bool(
                            self.revoke_fn(snap.clearance_id, ";".join(reasons))
                        )
                    except Exception:
                        logger.error(
                            "revoke_fn failed cid=%s", snap.clearance_id, exc_info=True
                        )
                        details["revoke_error"] = True
                    if executed:
                        self._set(
                            self._key(snap.clearance_id, "revoked"),
                            {"at": self._now(), "reasons": list(reasons)},
                            int(self.cfg["binding_ttl_sec"]),
                        )
                else:
                    logger.error(
                        "ENFORCE mode but revoke_fn not configured cid=%s",
                        snap.clearance_id,
                    )
                    details["revoke_not_configured"] = True

            elif action == Action.ADVANCED_FINGERPRINT:
                if self.advanced_check_fn is not None:
                    try:
                        details["advanced_result"] = self.advanced_check_fn(
                            snap.clearance_id
                        )
                        executed = True
                    except Exception:
                        logger.error(
                            "advanced_check_fn failed cid=%s",
                            snap.clearance_id, exc_info=True,
                        )
                        details["advanced_error"] = True

        if action != Action.KEEP or s.binding_flags or s.integrity_flags:
            logger.info(
                "clearance cid=%s tid=%s mode=%s action=%s "
                "forced=%s points=%s streak=%s executed=%s reasons=%s "
                "integrity=%s binding=%s",
                snap.clearance_id, snap.token_id, self.mode.value,
                action.value, forced, points, streak, executed,
                ",".join(reasons),
                ",".join(s.integrity_flags),
                ",".join(s.binding_flags),
            )

        return ClearanceDecision(
            action       = action,
            forced       = forced,
            points       = points,
            streak       = streak,
            reasons      = reasons,
            clearance_id = snap.clearance_id,
            token_id     = snap.token_id,
            mode         = self.mode,
            executed     = executed,
            would_execute = would,
            details      = details,
        )

    # ------------------------------------------------------------------
    # Storage helpers (Redis first, memory fallback للعدادات بس)
    # ------------------------------------------------------------------

    @staticmethod
    def _key(prefix: str, name: str) -> str:
        return f"{KEY_PREFIX}:{prefix}:{name}"

    def _get(self, key: str) -> Optional[Any]:
        return self.backend.get_json(key)

    def _set(self, key: str, value: Any, ttl: int) -> None:
        self.backend.set_json(key, value, ttl)

    def _incr(self, key: str, ttl: int) -> Optional[int]:
        n = self.backend.incr(key, ttl)
        if n is None:
            n = self._fallback.incr(key, ttl)
        return n

    def _delete(self, key: str) -> None:
        self.backend.delete(key)
        self._fallback.delete(key)


# =============================================================================
# Public helpers (للـ /analyze و decision_helper)
# =============================================================================

def _to_rec(action: Action) -> Recommendation:
    return {
        Action.KEEP:                 Recommendation.ALLOW,
        Action.REVALIDATE:           Recommendation.STRICT,
        Action.ADVANCED_FINGERPRINT: Recommendation.ADVANCED_FINGERPRINT,
        Action.REVOKE:               Recommendation.REVOKE_CLEARANCE,
    }[action]


def clearance_recommendation(d: Optional[ClearanceDecision]) -> Optional[Recommendation]:
    """ENFORCE mode بس — SHADOW يرجع None."""
    if d is None or d.mode != Mode.ENFORCE or d.action == Action.KEEP:
        return None
    return _to_rec(d.action)


def clearance_future(d: Optional[ClearanceDecision]) -> Optional[FutureAction]:
    """ENFORCE mode بس."""
    if d is None or d.mode != Mode.ENFORCE:
        return None
    return {
        Action.KEEP:                 None,
        Action.REVALIDATE:           FutureAction.REVALIDATE_CLEARANCE,
        Action.ADVANCED_FINGERPRINT: FutureAction.ADVANCED_FINGERPRINT_CHECK,
        Action.REVOKE:               FutureAction.ADVANCED_FINGERPRINT_CHECK,
    }[d.action]


def merge_recommendation(
    base: Recommendation,
    extra: Optional[Recommendation],
) -> Recommendation:
    if extra is None:
        return base
    return extra if _SEVERITY.get(extra, 0) > _SEVERITY.get(base, 0) else base


# =============================================================================
# Main entry point (للـ /analyze)
# =============================================================================

def evaluate_request_clearance(
    req:          AnalyzeRequest,
    *,
    identity_key:  str,
    drift:         Any,
    anomaly_score: float = 0.0,
    path_level:    Any   = "low",
    monitor:       Optional[ClearanceMonitor] = None,
    now:           Optional[float] = None,
) -> Optional[ClearanceDecision]:
    """
    None لو مفيش clearance في الطلب.
    Never raises.
    """
    p = req.clearance
    if p is None or getattr(p, "present", None) is False:
        return None

    mon = monitor or get_clearance_monitor()
    ts  = time.time() if now is None else now

    try:
        snap = build_snapshot(req, identity_key, ts, salt=mon.salt)
        vals = _extract_clearance_values(req)
        integrity = check_token_integrity(
            snap.parsed, vals, ts,
            cfg=mon.cfg, org_id=snap.org_id,
        )
        risk = combine_risk(anomaly_score, req.risk_score_so_far)
        sig  = signals_from_drift(
            drift,
            risk_score=risk,
            path_level=path_level,
            integrity_flags=integrity,
        )
    except Exception:
        logger.warning("clearance input build failed (fail-open)", exc_info=True)
        return ClearanceDecision(
            action=Action.KEEP, forced=False, points=0, streak=0,
            reasons=("input_error_fail_open",),
            mode=mon.mode,
        )

    return mon.evaluate(snap, sig)


# =============================================================================
# Singleton
# =============================================================================

_monitor: Optional[ClearanceMonitor] = None
_monitor_lock = threading.Lock()


def _cfg_val(name: str, default: Any) -> Any:
    try:
        from app.config import get_settings
        return getattr(get_settings(), name, default)
    except Exception:
        return default


def get_clearance_monitor(
    *,
    revoke_fn         = None,
    advanced_check_fn = None,
) -> ClearanceMonitor:
    global _monitor
    with _monitor_lock:
        if _monitor is None:
            raw  = str(_cfg_val("clearance_monitor_mode", "shadow")).lower()
            mode = Mode.ENFORCE if raw == "enforce" else Mode.SHADOW
            ovr  = {k: _cfg_val(f"clearance_{k}", v) for k, v in DEFAULTS.items()}
            _monitor = ClearanceMonitor(
                mode=mode,
                backend=RedisBackend(get_redis()),
                **ovr,
            )
            logger.info("clearance monitor started mode=%s", mode.value)
        if revoke_fn is not None:
            _monitor.revoke_fn = revoke_fn
        if advanced_check_fn is not None:
            _monitor.advanced_check_fn = advanced_check_fn
    return _monitor


__all__ = [
    "Action", "Mode",
    "ParsedToken", "ClearanceSnapshot", "MonitorSignals", "ClearanceDecision",
    "ClearanceMonitor", "MemoryBackend", "RedisBackend",
    "parse_clearance_token", "build_snapshot",
    "check_token_integrity", "score_points", "is_hard_revoke",
    "signals_from_drift", "combine_risk",
    "evaluate_request_clearance",
    "clearance_recommendation", "clearance_future", "merge_recommendation",
    "get_clearance_monitor",
]