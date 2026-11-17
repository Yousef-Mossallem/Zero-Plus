# app/training/initial_training.py
# ============================================================
# Zero Plus — AI Service
# Initial training / warm-start for new organization models
#
# يشتغل في حالتين:
#   1) أوتوماتيك: لما org جديد يتضاف → bootstrap_via_registry()
#   2) يدوي من CLI: عشان تدرّب قبل الإطلاق
#      python -m app.training.initial_training \
#             --org acme --size large --samples 10000
#
# المبدأ:
#   - Curriculum order: طبيعي → mild → sensitive_ok → مشبوه → هجوم
#   - مفيش تسميم: session_tracker مش بيتستخدم هنا
#   - كل SAVE_EVERY عينة بيتحفظ على الديسك
#   - لو الموديل عنده بيانات (n_learned >= threshold) → بيتخطى
# ============================================================

from __future__ import annotations

import argparse
import hashlib
import logging
import math
import random
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from app.config import Settings, get_settings
from app.features.feature_extractor import extract_features
from app.models.anomaly_detector import AnomalyDetector
from app.models.base_model import FeatureDict
from app.models.model_registry import ModelRegistry, OrgModels
from app.models.traffic_surge_detector import TrafficSurgeDetector
from app.schemas.request import (
    AdvancedFingerprintTelemetry,
    AnalysisPhase,
    AnalyzeRequest,
    ChallengeOutcome,
    ClearancePayload,
    FingerprintAuthPayload,
    HttpMethod,
    IpReputationPayload,
    JsChallengeTelemetry,
    RateLimitPayload,
)

logger = logging.getLogger("zero-plus-ai.training")

SAVE_EVERY = 500   # احفظ كل كام عينة في الـ CLI mode


# =============================================================================
# Org sizes  (بيتحددوا لما org جديد يتضاف)
# =============================================================================

class OrgSize(str, Enum):
    SMALL  = "small"
    MEDIUM = "medium"
    LARGE  = "large"


@dataclass(frozen=True)
class BootstrapProfile:
    size:            OrgSize
    n_normal:        int
    n_mild:          int
    n_suspicious:    int
    n_sensitive_ok:  int
    n_sensitive_bad: int
    normal_gap_sec:  Tuple[float, float]
    burst_gap_sec:   Tuple[float, float]
    seed_salt:       int = 17


# الأرقام اتضاعفت عن النسخة القديمة عشان الموديل يكون أقوى
PROFILES: Dict[OrgSize, BootstrapProfile] = {
    OrgSize.SMALL: BootstrapProfile(
        size             = OrgSize.SMALL,
        n_normal         = 400,
        n_mild           = 100,
        n_suspicious     = 60,
        n_sensitive_ok   = 80,
        n_sensitive_bad  = 40,
        normal_gap_sec   = (0.08, 0.35),
        burst_gap_sec    = (0.002, 0.02),
        seed_salt        = 11,
    ),
    OrgSize.MEDIUM: BootstrapProfile(
        size             = OrgSize.MEDIUM,
        n_normal         = 1000,
        n_mild           = 250,
        n_suspicious     = 150,
        n_sensitive_ok   = 200,
        n_sensitive_bad  = 100,
        normal_gap_sec   = (0.05, 0.25),
        burst_gap_sec    = (0.001, 0.015),
        seed_salt        = 23,
    ),
    OrgSize.LARGE: BootstrapProfile(
        size             = OrgSize.LARGE,
        n_normal         = 3000,
        n_mild           = 750,
        n_suspicious     = 450,
        n_sensitive_ok   = 600,
        n_sensitive_bad  = 300,
        normal_gap_sec   = (0.03, 0.18),
        burst_gap_sec    = (0.0008, 0.01),
        seed_salt        = 41,
    ),
}

# small  = 680   عينة
# medium = 1700  عينة
# large  = 5100  عينة
# CLI --samples  = أي كمية (10,000+)


def resolve_org_size(
    value: Optional[str],
    settings: Optional[Settings] = None,
) -> OrgSize:
    raw = (value or "").strip().lower()
    if not raw and settings is not None:
        raw = (settings.default_org_size or "medium").strip().lower()
    if not raw:
        raw = "medium"
    try:
        return OrgSize(raw)
    except ValueError:
        return OrgSize.MEDIUM


# =============================================================================
# Result
# =============================================================================

@dataclass
class BootstrapResult:
    org_id:          str
    size:            OrgSize
    samples_fed:     int
    anomaly_learned: int
    surge_learned:   int
    duration_ms:     float
    skipped:         bool           = False
    reason:          Optional[str]  = None
    profile:         Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "org_id":          self.org_id,
            "size":            self.size.value,
            "samples_fed":     self.samples_fed,
            "anomaly_learned": self.anomaly_learned,
            "surge_learned":   self.surge_learned,
            "duration_ms":     self.duration_ms,
            "skipped":         self.skipped,
            "reason":          self.reason,
            "profile":         self.profile,
        }


# =============================================================================
# Paths & User-Agents
# =============================================================================

_NORMAL_PATHS = (
    "/", "/home", "/products", "/products/list", "/blog", "/blog/post",
    "/about", "/help", "/faq", "/search", "/category/shoes", "/item/view",
    "/static/app.css", "/assets/app.js", "/images/logo.png",
    "/pricing", "/features", "/contact", "/news", "/team",
)

_SENSITIVE_PATHS = (
    "/login", "/signin", "/checkout", "/payment", "/api/auth",
    "/account", "/account/security", "/admin", "/api/checkout",
    "/reset-password", "/signup", "/api/token", "/billing",
)

_API_PATHS = (
    "/api/v1/items", "/api/v1/search", "/api/cart",
    "/api/me", "/graphql", "/api/v2/data", "/api/orders",
)

_UA_HUMAN = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 Safari/605.1.15",
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
)

_UA_BOT = (
    "python-requests/2.31.0",
    "curl/8.0.1",
    "HeadlessChrome/120.0.0.0",
    "Go-http-client/1.1",
    "masscan/1.0",
    "sqlmap/1.7",
    "",
)

_NORMAL_JA4 = (
    "t13d1516h2_8daaf6152771_b1ff8ab2d16f",
    "t13d1517h2_9ebaf7263882_c2ff9ab2d17g",
    "t13d1515h2_7cbaf5041660_a0ee7ba1c05e",
)

_ATTACK_IPS = (
    "185.220.101.1", "45.142.212.1", "193.32.162.1",
    "1.3.3.7", "9.9.9.100", "91.108.4.1", "77.111.247.1",
)

_NORMAL_IPS_PREFIXES = (
    "88", "78", "41", "31", "5", "90", "94", "62",
)


# =============================================================================
# Request builders
# =============================================================================

def _stable_rng(org_id: str, salt: int) -> random.Random:
    h = hashlib.sha256(f"{org_id}:{salt}".encode("utf-8")).hexdigest()
    return random.Random(int(h[:16], 16))


def _pick(rng: random.Random, seq: Sequence) -> Any:
    return seq[rng.randrange(len(seq))]


def _normal_ip(rng: random.Random) -> str:
    p = _pick(rng, _NORMAL_IPS_PREFIXES)
    return f"{p}.{rng.randint(1,254)}.{rng.randint(1,254)}.{rng.randint(1,254)}"


def _ja4(rng: random.Random, valid: bool = True) -> Optional[str]:
    if not valid and rng.random() < 0.6:
        return None
    if valid:
        return _pick(rng, _NORMAL_JA4)
    return f"t10d0{rng.randint(100,999)}h0_{rng.randint(10**11, 10**12-1):x}"[:40]


def build_synthetic_request(
    org_id: str,
    *,
    path:  str,
    rng:   random.Random,
    kind:  str = "normal",
) -> AnalyzeRequest:
    """
    kind: normal | mild | suspicious | sensitive_ok | sensitive_bad
          attack_bot | attack_scanner | attack_cred | attack_tor
    """

    # ── defaults (normal) ────────────────────────────────────
    method   = HttpMethod.GET
    risk     = rng.uniform(0, 18)
    ua       = _pick(rng, _UA_HUMAN)
    ja4      = _ja4(rng, valid=True)
    dev_fp   = f"fp_{rng.randint(10**8, 10**9-1)}"
    ip       = _normal_ip(rng)

    iprep = IpReputationPayload(
        score=rng.uniform(0, 20),
        is_tor_exit=False, is_proxy=False,
        is_datacenter=False, is_known_attacker=False,
        country=_pick(rng, ["EG","US","DE","GB","SA","AE","FR"]),
    )
    rate = RateLimitPayload(
        limited=False,
        current_count=rng.randint(1, 20),
        limit=100, remaining=rng.randint(80, 99),
        window_sec=60,
    )
    fp_auth = FingerprintAuthPayload(
        has_usable_device_fp=True,
        device_fp=dev_fp,
        device_fp_source="cookie",
        ja4=ja4,
        ja4_valid_format=True,
        edge_server_token_ok=True,
    )
    clearance = ClearancePayload(
        present=True, valid=True,
        expired=False, revoked=False,
        ttl_minutes=60, source="cookie",
    )
    js  = None
    adv = None

    # ── mild ─────────────────────────────────────────────────
    if kind == "mild":
        risk  = rng.uniform(20, 45)
        rate  = RateLimitPayload(
            limited=False,
            current_count=rng.randint(30, 70),
            limit=100, remaining=rng.randint(10, 40),
            window_sec=60,
        )
        if rng.random() < 0.4:
            iprep = IpReputationPayload(
                score=rng.uniform(30, 55),
                is_datacenter=True,
                country=_pick(rng, ["US","NL","DE"]),
            )

    # ── sensitive_ok (زائر شرعي على /login) ──────────────────
    elif kind == "sensitive_ok":
        method = _pick(rng, [HttpMethod.GET, HttpMethod.POST])
        risk   = rng.uniform(5, 30)
        js = JsChallengeTelemetry(
            challenged=True,
            outcome=ChallengeOutcome.PASSED,
            solve_time_ms=rng.uniform(300, 3000),
            suspicion_score=rng.uniform(0.0, 0.15),
            hard_failure=False,
        )

    # ── suspicious ───────────────────────────────────────────
    elif kind == "suspicious":
        risk  = rng.uniform(40, 70)
        iprep = IpReputationPayload(
            score=rng.uniform(45, 75),
            is_proxy=True,
            is_datacenter=rng.random() > 0.4,
            geo_anomaly_hint="country_mismatch",
        )
        rate = RateLimitPayload(
            limited=False,
            current_count=rng.randint(50, 80),
            limit=100, remaining=rng.randint(20, 50),
            window_sec=60,
        )
        js = JsChallengeTelemetry(
            challenged=True,
            outcome=_pick(rng, [ChallengeOutcome.PASSED, ChallengeOutcome.TIMEOUT]),
            solve_time_ms=_pick(rng, [rng.uniform(10, 60), rng.uniform(8000, 25000)]),
            suspicion_score=rng.uniform(0.4, 0.7),
        )

    # ── sensitive_bad (هجوم على /login /checkout) ─────────────
    elif kind == "sensitive_bad":
        method = HttpMethod.POST
        risk   = rng.uniform(70, 98)
        ua     = _pick(rng, _UA_BOT)
        ip     = _pick(rng, _ATTACK_IPS)
        path   = path if path in _SENSITIVE_PATHS else _pick(rng, _SENSITIVE_PATHS)
        ja4    = _ja4(rng, valid=False)
        clearance = ClearancePayload(
            present=False, valid=False,
            expired=False, revoked=False,
        )
        iprep = IpReputationPayload(
            score=rng.uniform(70, 99),
            is_tor_exit=True, is_proxy=True,
            is_datacenter=True, is_known_attacker=True,
            country="XX",
        )
        rate = RateLimitPayload(
            limited=True, current_count=rng.randint(200, 500),
            limit=100, remaining=0, window_sec=60,
        )
        js = JsChallengeTelemetry(
            challenged=True, outcome=ChallengeOutcome.FAILED,
            solve_time_ms=rng.uniform(1, 25),
            suspicion_score=rng.uniform(0.85, 1.0),
            hard_failure=True,
        )
        fp_auth = FingerprintAuthPayload(
            has_usable_device_fp=False,
            ja4_valid_format=False,
            edge_server_token_ok=False,
            device_fp_source="none",
        )

    # ── attack_bot ───────────────────────────────────────────
    elif kind == "attack_bot":
        method = _pick(rng, [HttpMethod.GET, HttpMethod.POST])
        risk   = rng.uniform(75, 98)
        ua     = _pick(rng, _UA_BOT)
        ip     = _pick(rng, _ATTACK_IPS)
        ja4    = _ja4(rng, valid=False)
        iprep  = IpReputationPayload(
            score=rng.uniform(80, 100),
            is_tor_exit=rng.random() > 0.5,
            is_proxy=True, is_datacenter=True,
            is_known_attacker=True,
        )
        rate = RateLimitPayload(
            limited=True, current_count=rng.randint(300, 999),
            limit=100, remaining=0, window_sec=60,
        )
        js = JsChallengeTelemetry(
            challenged=True, outcome=ChallengeOutcome.FAILED,
            solve_time_ms=rng.uniform(1, 20),
            suspicion_score=rng.uniform(0.9, 1.0),
            hard_failure=True,
        )
        fp_auth = FingerprintAuthPayload(
            has_usable_device_fp=False,
            ja4_valid_format=False,
            edge_server_token_ok=False,
        )
        clearance = ClearancePayload(present=False, valid=False,
                                     expired=False, revoked=False)

    # ── attack_scanner ───────────────────────────────────────
    elif kind == "attack_scanner":
        scan_paths = [
            "/.env", "/.git/config", "/config.php", "/backup.sql",
            "/phpmyadmin", "/server-status", "/actuator/env",
            "/api/v1/../../../etc/passwd", "/wp-login.php",
        ]
        path   = _pick(rng, scan_paths)
        method = HttpMethod.GET
        risk   = rng.uniform(80, 99)
        ua     = _pick(rng, _UA_BOT)
        ip     = _pick(rng, _ATTACK_IPS)
        iprep  = IpReputationPayload(
            score=rng.uniform(85, 100),
            is_known_attacker=True,
            is_datacenter=True,
        )
        rate = RateLimitPayload(
            limited=True, current_count=rng.randint(500, 2000),
            limit=100, remaining=0, window_sec=60,
        )

    # ── attack_cred (credential stuffing) ────────────────────
    elif kind == "attack_cred":
        path   = _pick(rng, ["/login", "/signin", "/api/auth/login"])
        method = HttpMethod.POST
        risk   = rng.uniform(65, 95)
        ua     = _pick(rng, _UA_BOT + _UA_HUMAN[:1])
        ip     = _pick(rng, _ATTACK_IPS)
        iprep  = IpReputationPayload(
            score=rng.uniform(60, 95),
            is_proxy=True, is_datacenter=True,
        )
        rate = RateLimitPayload(
            limited=True, current_count=rng.randint(100, 500),
            limit=100, remaining=0, window_sec=60,
        )
        js = JsChallengeTelemetry(
            challenged=True,
            outcome=_pick(rng, [ChallengeOutcome.FAILED, ChallengeOutcome.TIMEOUT]),
            solve_time_ms=rng.uniform(1, 50),
            suspicion_score=rng.uniform(0.75, 1.0),
            hard_failure=True,
        )

    # ── attack_tor ───────────────────────────────────────────
    elif kind == "attack_tor":
        method = _pick(rng, [HttpMethod.POST, HttpMethod.GET])
        risk   = rng.uniform(70, 98)
        ua     = _pick(rng, _UA_HUMAN + _UA_BOT)
        ip     = _pick(rng, _ATTACK_IPS)
        ja4    = _ja4(rng, valid=False)
        iprep  = IpReputationPayload(
            score=rng.uniform(80, 100),
            is_tor_exit=True, is_proxy=True,
            is_known_attacker=rng.random() > 0.4,
        )
        rate = RateLimitPayload(
            limited=rng.random() > 0.5,
            current_count=rng.randint(50, 300),
            limit=100, remaining=rng.randint(0, 50),
            window_sec=60,
        )
        adv = AdvancedFingerprintTelemetry(
            challenged=True,
            outcome=ChallengeOutcome.FAILED,
            score=rng.uniform(0.7, 1.0),
            ua_tls_consistency=rng.uniform(0.0, 0.3),
            ja4_looks_valid=False,
        )

    # mix API paths for normal/mild
    if kind in ("normal", "mild") and rng.random() < 0.15:
        path = _pick(rng, _API_PATHS)

    return AnalyzeRequest(
        phase              = AnalysisPhase.PRE_DECISION,
        org_id             = org_id,
        request_id         = f"boot_{rng.randint(1, 10**9)}",
        session_id         = f"sess_boot_{rng.randint(1, 10**6)}",
        ip                 = ip,
        path               = path,
        method             = method,
        user_agent         = ua,
        ja4                = ja4,
        device_fp          = dev_fp if kind in ("normal","mild","sensitive_ok") else None,
        risk_score_so_far  = risk,
        content_length     = rng.randint(0, 4000) if method == HttpMethod.POST else 0,
        fingerprint_auth   = fp_auth,
        ip_reputation      = iprep,
        rate_limit         = rate,
        js_challenge       = js,
        advanced_fingerprint = adv,
        clearance          = clearance,
    )


# =============================================================================
# Curriculum iterator
# =============================================================================

_CURRICULUM_NORMAL   = ["normal", "mild", "sensitive_ok"]
_CURRICULUM_ATTACK   = ["suspicious", "sensitive_bad",
                         "attack_bot", "attack_scanner",
                         "attack_cred", "attack_tor"]


def iter_bootstrap_features(
    org_id:   str,
    profile:  BootstrapProfile,
    *,
    settings: Optional[Settings] = None,
    extra:    int = 0,           # عينات إضافية فوق الـ profile
) -> Iterable[Tuple[str, FeatureDict]]:
    """
    Curriculum order (مهم — بيبني الـ baseline الصح):
      1) normal      → يتعلم الطبيعي
      2) mild        → يتعلم منطقة الشك الخفيف
      3) sensitive_ok→ /login الشرعي مش دايماً شاذ
      4) suspicious  → يتعلم منطقة الشك القوي
      5) sensitive_bad + attack types → يتعلم الحدود
    """
    rng = _stable_rng(org_id, profile.seed_salt)
    t   = time.time() - 7200.0   # ابتداء من ساعتين فاتوا (virtual)

    def gap(lo_hi: Tuple[float, float]) -> float:
        return rng.uniform(lo_hi[0], lo_hi[1])

    def emit(kind: str, path: str, burst: bool = False) -> Tuple[str, FeatureDict]:
        nonlocal t
        t   += gap(profile.burst_gap_sec if burst else profile.normal_gap_sec)
        req  = build_synthetic_request(org_id, path=path, rng=rng, kind=kind)
        feats = extract_features(req, settings=settings)
        feats["_event_ts"] = t
        return kind, feats

    # 1) Normal baseline
    for _ in range(profile.n_normal):
        yield emit("normal", _pick(rng, _NORMAL_PATHS))

    # 2) Mild noise
    for _ in range(profile.n_mild):
        yield emit("mild", _pick(rng, _NORMAL_PATHS + _API_PATHS))

    # 3) Legitimate sensitive traffic
    for _ in range(profile.n_sensitive_ok):
        yield emit("sensitive_ok", _pick(rng, _SENSITIVE_PATHS))

    # 4) Suspicious general
    for _ in range(profile.n_suspicious):
        yield emit("suspicious", _pick(rng, _NORMAL_PATHS + _API_PATHS))

    # 5) Attack types (sensitive_bad + burst + scanner + cred + tor + bot)
    attack_pool = [
        ("sensitive_bad", _SENSITIVE_PATHS),
        ("attack_bot",    _SENSITIVE_PATHS + _NORMAL_PATHS),
        ("attack_scanner", _NORMAL_PATHS),
        ("attack_cred",   _SENSITIVE_PATHS),
        ("attack_tor",    _SENSITIVE_PATHS),
    ]
    per_type = max(1, profile.n_sensitive_bad // len(attack_pool))

    for kind, paths in attack_pool:
        for i in range(per_type):
            burst = (i % 4 == 0) and kind in ("attack_bot", "attack_cred")
            yield emit(kind, _pick(rng, paths), burst=burst)
            if burst:
                for _ in range(rng.randint(5, 12)):
                    yield emit(kind, _pick(rng, paths), burst=True)

    # 6) عينات إضافية (لما CLI --samples أكبر من الـ profile)
    if extra > 0:
        # 70% normal, 20% suspicious, 10% attack
        normal_extra = int(extra * 0.70)
        susp_extra   = int(extra * 0.20)
        atk_extra    = extra - normal_extra - susp_extra

        for _ in range(normal_extra):
            kind = _pick(rng, ["normal", "mild", "sensitive_ok"])
            path = _pick(rng, _NORMAL_PATHS + _SENSITIVE_PATHS)
            yield emit(kind, path)

        for _ in range(susp_extra):
            yield emit("suspicious", _pick(rng, _NORMAL_PATHS + _API_PATHS))

        for _ in range(atk_extra):
            kind = _pick(rng, [a[0] for a in attack_pool])
            yield emit(kind, _pick(rng, _SENSITIVE_PATHS))


# =============================================================================
# Core bootstrap (بيتستخدم من الكود — بدون disk I/O)
# =============================================================================

def bootstrap_org_models(
    anomaly:             AnomalyDetector,
    surge:               TrafficSurgeDetector,
    *,
    org_id:              str,
    size:                Optional[str] = None,
    settings:            Optional[Settings] = None,
    skip_if_ready:       bool = True,
    min_learned_to_skip: int  = 50,
    extra_samples:       int  = 0,
) -> BootstrapResult:
    """
    يغذي الموديلات بعينات اصطناعية.
    مش بيحفظ على الديسك — المُستدعي يقرر متى يحفظ.
    """
    settings = settings or get_settings()
    org_size = resolve_org_size(size, settings)
    profile  = PROFILES[org_size]
    t0       = time.perf_counter()

    if skip_if_ready and anomaly.n_learned >= min_learned_to_skip:
        return BootstrapResult(
            org_id          = org_id,
            size            = org_size,
            samples_fed     = 0,
            anomaly_learned = anomaly.n_learned,
            surge_learned   = surge.n_learned,
            duration_ms     = 0.0,
            skipped         = True,
            reason          = f"already_warm n_learned={anomaly.n_learned}",
            profile         = _profile_dict(profile),
        )

    fed = 0
    for _kind, feats in iter_bootstrap_features(
        org_id, profile, settings=settings, extra=extra_samples
    ):
        anomaly.score_and_learn(feats)
        surge.score_and_learn(feats)
        fed += 1

    elapsed = (time.perf_counter() - t0) * 1000.0
    logger.info(
        "Bootstrap org=%s size=%s samples=%s anomaly_n=%s surge_n=%s ms=%.1f",
        org_id, org_size.value, fed,
        anomaly.n_learned, surge.n_learned, elapsed,
    )
    return BootstrapResult(
        org_id          = org_id,
        size            = org_size,
        samples_fed     = fed,
        anomaly_learned = anomaly.n_learned,
        surge_learned   = surge.n_learned,
        duration_ms     = round(elapsed, 2),
        profile         = _profile_dict(profile),
    )


def bootstrap_org_bundle(
    bundle:        OrgModels,
    *,
    size:          Optional[str] = None,
    settings:      Optional[Settings] = None,
    skip_if_ready: bool = True,
    extra_samples: int  = 0,
) -> BootstrapResult:
    return bootstrap_org_models(
        bundle.anomaly,
        bundle.surge,
        org_id        = bundle.org_id,
        size          = size,
        settings      = settings,
        skip_if_ready = skip_if_ready,
        extra_samples = extra_samples,
    )


def bootstrap_via_registry(
    registry: ModelRegistry,
    org_id:   str,
    *,
    size:          Optional[str] = None,
    settings:      Optional[Settings] = None,
    save:          bool = True,
    force:         bool = False,
    extra_samples: int  = 0,
) -> BootstrapResult:
    """
    الدالة الرئيسية — بيتستدعيها الـ registry لما org جديد يتضاف.
    force=True بيعيد التدريب حتى لو الموديل عنده بيانات.
    """
    settings = settings or get_settings()
    bundle   = registry.get_or_create(org_id)
    result   = bootstrap_org_bundle(
        bundle,
        size          = size,
        settings      = settings,
        skip_if_ready = not force,
        extra_samples = extra_samples,
    )
    if save and not result.skipped:
        registry.save_org(org_id, force=True)
    return result


# =============================================================================
# CLI — لما تشغّله يدوي
# =============================================================================

def _cli_train(org_id: str, samples: int, size: str, fast: bool) -> None:
    from app.persistence.redis_client import init_redis
    from app.persistence.model_store import init_model_store
    from app.models.model_registry import init_registry, get_registry

    settings = get_settings()
    init_redis(settings)
    store    = init_model_store(settings)
    init_registry(store=store, settings=settings)
    registry = get_registry()

    org_size = resolve_org_size(size, settings)
    profile  = PROFILES[org_size]
    base     = _profile_dict(profile)["total"]
    extra    = max(0, samples - base)

    print(f"""
╔{'═'*58}╗
║{'  ZERO PLUS — Bootstrap Training (CLI)':^58}║
╚{'═'*58}╝
  org      = {org_id}
  size     = {org_size.value}
  samples  = {samples}  (profile={base} + extra={extra})
  fast     = {fast}
{'─'*60}""")

    t0 = time.perf_counter()

    bundle = registry.get_or_create(org_id)
    fed = 0
    saved_at = 0

    rng_ext = _stable_rng(org_id, 99)

    for kind, feats in iter_bootstrap_features(
        org_id, profile, settings=settings, extra=extra
    ):
        bundle.anomaly.score_and_learn(feats)
        bundle.surge.score_and_learn(feats)
        fed += 1

        if fed % 100 == 0:
            elapsed = time.perf_counter() - t0
            rate    = fed / elapsed
            eta     = (samples - fed) / rate if rate > 0 else 0
            pct     = fed / samples * 100
            print(f"  [{fed:>6}/{samples}]  {pct:5.1f}%"
                  f"  {rate:5.0f} req/s"
                  f"  ETA {eta:5.0f}s")

        if fed - saved_at >= SAVE_EVERY:
            registry.save_org(org_id, force=True)
            saved_at = fed
            print(f"  💾  saved at {fed}")

        if not fast:
            time.sleep(0.001)

    # final save
    registry.save_org(org_id, force=True)

    elapsed = time.perf_counter() - t0
    print(f"""
{'─'*60}
  ✅  Done
  fed      = {fed}
  anomaly  = {bundle.anomaly.n_learned} learned
  surge    = {bundle.surge.n_learned} learned
  elapsed  = {elapsed:.1f}s  ({fed/elapsed:.0f} req/s)
{'─'*60}
""")


def _profile_dict(p: BootstrapProfile) -> Dict[str, Any]:
    total = (p.n_normal + p.n_mild + p.n_suspicious
             + p.n_sensitive_ok + p.n_sensitive_bad)
    return {
        "size":           p.size.value,
        "n_normal":       p.n_normal,
        "n_mild":         p.n_mild,
        "n_suspicious":   p.n_suspicious,
        "n_sensitive_ok": p.n_sensitive_ok,
        "n_sensitive_bad":p.n_sensitive_bad,
        "total":          total,
    }


# =============================================================================
# Entrypoint
# =============================================================================

if __name__ == "__main__":
    p = argparse.ArgumentParser(
        description="Zero Plus — bootstrap a new org model"
    )
    p.add_argument("--org",     required=True,
                   help="org_id (same as in /analyze)")
    p.add_argument("--samples", type=int, default=5000,
                   help="Total samples to feed (default: 5000)")
    p.add_argument("--size",    default="large",
                   choices=["small", "medium", "large"],
                   help="Org size profile (default: large)")
    p.add_argument("--fast",    action="store_true",
                   help="Skip 1ms sleep (faster, more CPU)")
    args = p.parse_args()
    _cli_train(args.org, args.samples, args.size, args.fast)


__all__ = [
    "OrgSize",
    "BootstrapProfile",
    "BootstrapResult",
    "PROFILES",
    "resolve_org_size",
    "build_synthetic_request",
    "iter_bootstrap_features",
    "bootstrap_org_models",
    "bootstrap_org_bundle",
    "bootstrap_via_registry",
]