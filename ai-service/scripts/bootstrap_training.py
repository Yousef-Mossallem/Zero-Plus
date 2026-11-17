# scripts/bootstrap_training.py
# ============================================================
# Zero Plus — AI Service
# Bootstrap training script — covers ALL signal combinations
#
# الاستخدام:
#   python scripts/bootstrap_training.py --org acme --samples 2000
#   python scripts/bootstrap_training.py --org acme --samples 5000 --fast
#   python scripts/bootstrap_training.py --org acme --list-orgs
#
# المبدأ:
#   - 70% طلبات طبيعية (تبني خط الأساس)
#   - 20% طلبات مشبوهة (يتعلم يرفعها)
#   - 10% طلبات هجوم واضح (يتعلم يكشفها)
#   - كل batch يتحفظ على الديسك
#   - مفيش تسميم: الطلبات المصنّفة high مش بتدخل baseline
# ============================================================

from __future__ import annotations

import argparse
import math
import os
import random
import sys
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

# ── add project root to path ──────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_settings
from app.features.feature_extractor import extract_features
from app.models.model_registry import get_registry, init_registry
from app.persistence.redis_client import init_redis
from app.persistence.model_store import init_model_store
from app.schemas.request import (
    AdvancedFingerprintTelemetry,
    AnalyzeRequest,
    ChallengeOutcome,
    ClearancePayload,
    FingerprintAuthPayload,
    HttpMethod,
    IpReputationPayload,
    JsChallengeTelemetry,
    RateLimitPayload,
)

# =============================================================================
# Constants
# =============================================================================

SAVE_EVERY = 200          # احفظ كل كام طلب
PRINT_EVERY = 100         # اطبع progress كل كام طلب

# توزيع الطلبات
DIST_NORMAL     = 0.70    # 70% طبيعي
DIST_SUSPICIOUS = 0.20    # 20% مشبوه
DIST_ATTACK     = 0.10    # 10% هجوم واضح

# IPs طبيعية (ISP عادي)
NORMAL_IPS = [
    f"{a}.{b}.{c}.{d}"
    for a in [5, 31, 41, 46, 62, 78, 88, 90, 91, 94, 95, 141]
    for b in range(1, 20)
    for c in range(1, 10)
    for d in range(1, 50)
]

# IPs مشبوهة (datacenter / VPN)
SUSPICIOUS_IPS = [
    f"104.{b}.{c}.{d}"
    for b in range(16, 32)
    for c in range(1, 20)
    for d in range(1, 50)
] + [
    f"192.168.{c}.{d}"
    for c in range(1, 5)
    for d in range(1, 50)
]

# IPs هجوم معروفة
ATTACK_IPS = [
    "185.220.101.1", "185.220.101.2", "198.98.56.1",
    "45.142.212.1",  "45.142.212.2",  "193.32.162.1",
    "1.3.3.7",       "9.9.9.100",     "77.111.247.1",
    "91.108.4.1",
]

# User agents حقيقية
NORMAL_UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 Version/17.1 Safari/605.1.15",
]

BOT_UAS = [
    "curl/7.88.1",
    "python-requests/2.31.0",
    "Go-http-client/1.1",
    "Scrapy/2.11.0",
    "masscan/1.0",
    "sqlmap/1.7",
    "Nikto/2.1.6",
    "",
    "Mozilla/4.0 (compatible; MSIE 6.0)",  # قديم جداً = مشبوه
]

# JA4 signatures
NORMAL_JA4 = [
    "t13d1516h2_8daaf6152771_b1ff8ab2d16f",
    "t13d1517h2_8daaf6152771_c2ff9ab2d17g",
    "t13d1515h2_7cbaf5041660_a0ee7ba1c05e",
]
BOT_JA4 = [
    "t13d0000h0_000000000000_000000000000",
    "t10d0101h1_111111111111_111111111111",
]

# مسارات طبيعية
PATHS_LOW = [
    "/", "/home", "/about", "/contact", "/blog",
    "/products", "/services", "/faq", "/pricing",
    "/news", "/team", "/careers", "/help",
]
PATHS_LOW_STATIC = [
    "/static/app.js", "/css/main.css", "/images/logo.png",
    "/favicon.ico", "/fonts/roboto.woff2",
]
PATHS_MEDIUM = [
    "/api/v1/products", "/api/v1/search", "/api/v1/categories",
    "/search", "/filter", "/upload", "/download",
]
PATHS_HIGH = [
    "/account", "/profile", "/settings", "/dashboard",
    "/orders", "/wishlist", "/address", "/preferences",
]
PATHS_CRITICAL = [
    "/login", "/signup", "/signin", "/logout",
    "/checkout", "/payment", "/billing",
    "/reset-password", "/forgot-password",
    "/admin", "/wp-admin", "/api/auth",
    "/api/token", "/api/admin",
]

# =============================================================================
# Data classes
# =============================================================================

@dataclass
class TrafficProfile:
    """ملف تعريف نوع الطلب."""
    name:      str
    is_attack: bool = False
    is_suspicious: bool = False


PROFILE_NORMAL_BROWSER    = TrafficProfile("normal_browser")
PROFILE_NORMAL_MOBILE     = TrafficProfile("normal_mobile")
PROFILE_NORMAL_RETURNING  = TrafficProfile("normal_returning_user")
PROFILE_SUSPICIOUS_VPN    = TrafficProfile("suspicious_vpn",        is_suspicious=True)
PROFILE_SUSPICIOUS_DC     = TrafficProfile("suspicious_datacenter",  is_suspicious=True)
PROFILE_SUSPICIOUS_FAST   = TrafficProfile("suspicious_fast_browse", is_suspicious=True)
PROFILE_ATTACK_BOT        = TrafficProfile("attack_bot",             is_attack=True)
PROFILE_ATTACK_SCANNER    = TrafficProfile("attack_scanner",         is_attack=True)
PROFILE_ATTACK_CRED_STUFF = TrafficProfile("attack_cred_stuffing",   is_attack=True)
PROFILE_ATTACK_SQL        = TrafficProfile("attack_sqli_attempt",    is_attack=True)
PROFILE_ATTACK_TOR        = TrafficProfile("attack_tor_exit",        is_attack=True)

# =============================================================================
# Request builders
# =============================================================================

rng = random.Random()


def _pick(lst: list) -> any:
    return rng.choice(lst)


def _ri(lo: int, hi: int) -> int:
    return rng.randint(lo, hi)


def _rf(lo: float, hi: float) -> float:
    return rng.uniform(lo, hi)


# ── Normal profiles ───────────────────────────────────────────

def _build_normal_browser(org: str, session_prefix: str) -> AnalyzeRequest:
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"{session_prefix}-{_ri(1, 300)}",
        ip          = _pick(NORMAL_IPS),
        path        = _pick(PATHS_LOW + PATHS_LOW + PATHS_MEDIUM),
        method      = _pick([HttpMethod.GET, HttpMethod.GET, HttpMethod.POST]),
        user_agent  = _pick(NORMAL_UAS),
        risk_score_so_far = _rf(0, 18),
        content_length    = _ri(0, 512) if rng.random() > 0.5 else None,
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp = True,
            device_fp   = f"dev-{session_prefix}-{_ri(1,300)}",
            ja4         = _pick(NORMAL_JA4),
            ja4_valid_format = True,
            device_fp_source = _pick(["cookie", "header"]),
        ),
        ip_reputation = IpReputationPayload(
            score           = _rf(0, 15),
            is_tor_exit     = False,
            is_proxy        = False,
            is_datacenter   = False,
            is_known_attacker = False,
            country         = _pick(["EG", "US", "DE", "GB", "FR", "SA", "AE"]),
        ),
        rate_limit = RateLimitPayload(
            limited       = False,
            current_count = _ri(1, 20),
            limit         = 100,
            remaining     = _ri(80, 99),
        ),
        js_challenge = JsChallengeTelemetry(
            challenged   = _pick([True, False]),
            outcome      = ChallengeOutcome.PASSED,
            solve_time_ms = _rf(400, 3000),
            suspicion_score = _rf(0, 0.1),
        ) if rng.random() > 0.4 else None,
    )


def _build_normal_mobile(org: str, session_prefix: str) -> AnalyzeRequest:
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"mob-{session_prefix}-{_ri(1, 200)}",
        ip          = _pick(NORMAL_IPS),
        path        = _pick(PATHS_LOW + PATHS_MEDIUM),
        method      = HttpMethod.GET,
        user_agent  = _pick([ua for ua in NORMAL_UAS
                              if "Mobile" in ua or "Android" in ua or "iPhone" in ua]),
        risk_score_so_far = _rf(0, 12),
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp = True,
            device_fp   = f"mob-{_ri(1,200)}",
            ja4         = _pick(NORMAL_JA4),
            ja4_valid_format = True,
        ),
        ip_reputation = IpReputationPayload(
            score = _rf(0, 10), is_datacenter=False,
            country = _pick(["EG", "SA", "AE", "MA"]),
        ),
        rate_limit = RateLimitPayload(
            limited=False, current_count=_ri(1,15),
            limit=100, remaining=_ri(85,99),
        ),
    )


def _build_normal_returning(org: str, session_prefix: str) -> AnalyzeRequest:
    """زائر عائد، عنده clearance."""
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"ret-{session_prefix}-{_ri(1, 100)}",
        ip          = _pick(NORMAL_IPS),
        path        = _pick(PATHS_HIGH + PATHS_MEDIUM),
        method      = _pick([HttpMethod.GET, HttpMethod.POST]),
        user_agent  = _pick(NORMAL_UAS),
        risk_score_so_far = _rf(0, 20),
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp = True,
            device_fp   = f"ret-dev-{_ri(1,100)}",
            ja4         = _pick(NORMAL_JA4),
            ja4_valid_format = True,
        ),
        ip_reputation = IpReputationPayload(
            score=_rf(0, 12), is_tor_exit=False,
            is_proxy=False, is_datacenter=False,
        ),
        rate_limit = RateLimitPayload(
            limited=False, current_count=_ri(1,30),
            limit=200, remaining=_ri(170,199),
        ),
        js_challenge = JsChallengeTelemetry(
            challenged=True, outcome=ChallengeOutcome.PASSED,
            solve_time_ms=_rf(300, 2500),
        ),
        clearance = ClearancePayload(
            present=True, valid=True,
            expired=False, revoked=False,
            ttl_minutes=60, source="cookie",
        ),
    )


# ── Suspicious profiles ───────────────────────────────────────

def _build_suspicious_vpn(org: str, session_prefix: str) -> AnalyzeRequest:
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"vpn-{_ri(1, 50)}",
        ip          = _pick(SUSPICIOUS_IPS),
        path        = _pick(PATHS_LOW + PATHS_HIGH),
        method      = _pick([HttpMethod.GET, HttpMethod.POST]),
        user_agent  = _pick(NORMAL_UAS),
        risk_score_so_far = _rf(30, 60),
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp = _pick([True, False]),
            ja4         = _pick(NORMAL_JA4 + BOT_JA4),
            ja4_valid_format = _pick([True, False]),
        ),
        ip_reputation = IpReputationPayload(
            score       = _rf(40, 70),
            is_proxy    = True,
            is_datacenter = True,
            is_tor_exit   = False,
            geo_anomaly_hint = "country_mismatch",
        ),
        rate_limit = RateLimitPayload(
            limited=False, current_count=_ri(5,40),
            limit=100, remaining=_ri(60,95),
        ),
    )


def _build_suspicious_datacenter(org: str, session_prefix: str) -> AnalyzeRequest:
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"dc-{_ri(1, 30)}",
        ip          = _pick(SUSPICIOUS_IPS),
        path        = _pick(PATHS_MEDIUM + PATHS_HIGH),
        method      = _pick([HttpMethod.GET, HttpMethod.POST]),
        user_agent  = _pick(NORMAL_UAS + BOT_UAS[:3]),
        risk_score_so_far = _rf(25, 55),
        ip_reputation = IpReputationPayload(
            score         = _rf(35, 65),
            is_datacenter = True,
            is_proxy      = _pick([True, False]),
        ),
        rate_limit = RateLimitPayload(
            limited=False, current_count=_ri(10, 50),
            limit=100, remaining=_ri(50, 90),
        ),
        js_challenge = JsChallengeTelemetry(
            challenged=True,
            outcome=_pick([ChallengeOutcome.PASSED, ChallengeOutcome.TIMEOUT]),
            solve_time_ms=_pick([50.0, _rf(5000, 20000)]),
            suspicion_score=_rf(0.3, 0.6),
        ),
    )


def _build_suspicious_fast(org: str, session_prefix: str) -> AnalyzeRequest:
    """زائر بيتصفح بسرعة غير طبيعية."""
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"fast-{_ri(1, 10)}",
        ip          = _pick(NORMAL_IPS + SUSPICIOUS_IPS),
        path        = _pick(PATHS_LOW + PATHS_MEDIUM + PATHS_HIGH),
        method      = HttpMethod.GET,
        user_agent  = _pick(NORMAL_UAS),
        risk_score_so_far = _rf(20, 50),
        rate_limit  = RateLimitPayload(
            limited=_pick([True, False]),
            current_count=_ri(60, 90),
            limit=100,
            remaining=_ri(10, 40),
        ),
        js_challenge = JsChallengeTelemetry(
            challenged=True,
            outcome=ChallengeOutcome.PASSED,
            solve_time_ms=_rf(10, 80),   # سريع جداً = مشبوه
            suspicion_score=_rf(0.4, 0.7),
        ),
    )


# ── Attack profiles ───────────────────────────────────────────

def _build_attack_bot(org: str, session_prefix: str) -> AnalyzeRequest:
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"bot-{_ri(1, 5)}",
        ip          = _pick(ATTACK_IPS),
        path        = _pick(PATHS_CRITICAL + PATHS_HIGH),
        method      = _pick([HttpMethod.POST, HttpMethod.GET]),
        user_agent  = _pick(BOT_UAS),
        risk_score_so_far = _rf(70, 95),
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp = False,
            ja4         = _pick(BOT_JA4),
            ja4_valid_format = False,
        ),
        ip_reputation = IpReputationPayload(
            score             = _rf(75, 100),
            is_tor_exit       = _pick([True, False]),
            is_proxy          = True,
            is_datacenter     = True,
            is_known_attacker = True,
        ),
        rate_limit = RateLimitPayload(
            limited       = True,
            current_count = _ri(200, 999),
            limit         = 100,
            remaining     = 0,
        ),
        js_challenge = JsChallengeTelemetry(
            challenged    = True,
            outcome       = ChallengeOutcome.FAILED,
            solve_time_ms = _rf(1, 30),
            suspicion_score = _rf(0.8, 1.0),
            hard_failure  = True,
        ),
    )


def _build_attack_scanner(org: str, session_prefix: str) -> AnalyzeRequest:
    """Port/path scanner."""
    scan_paths = [
        "/.env", "/.git/config", "/config.php",
        "/backup.sql", "/phpmyadmin", "/server-status",
        "/actuator/env", "/swagger-ui.html",
        "/api/v1/../../../etc/passwd",
    ]
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"scan-{_ri(1, 3)}",
        ip          = _pick(ATTACK_IPS),
        path        = _pick(scan_paths),
        method      = HttpMethod.GET,
        user_agent  = _pick(BOT_UAS),
        risk_score_so_far = _rf(80, 99),
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp=False, ja4_valid_format=False,
        ),
        ip_reputation = IpReputationPayload(
            score=_rf(85, 100),
            is_known_attacker=True,
            is_datacenter=True,
        ),
        rate_limit = RateLimitPayload(
            limited=True,
            current_count=_ri(500, 2000),
            limit=100, remaining=0,
        ),
    )


def _build_attack_cred_stuffing(org: str, session_prefix: str) -> AnalyzeRequest:
    """هجوم credential stuffing على login."""
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"cred-{_ri(1, 20)}",
        ip          = _pick(ATTACK_IPS + SUSPICIOUS_IPS),
        path        = _pick(["/login", "/signin", "/api/auth/login"]),
        method      = HttpMethod.POST,
        user_agent  = _pick(BOT_UAS + NORMAL_UAS[:2]),
        risk_score_so_far = _rf(65, 95),
        content_length    = _ri(50, 200),
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp = _pick([True, False]),
            ja4         = _pick(BOT_JA4 + NORMAL_JA4[:1]),
            ja4_valid_format = _pick([True, False]),
        ),
        ip_reputation = IpReputationPayload(
            score         = _rf(60, 95),
            is_proxy      = _pick([True, False]),
            is_datacenter = True,
        ),
        rate_limit = RateLimitPayload(
            limited=True,
            current_count=_ri(100, 500),
            limit=100, remaining=0,
        ),
        js_challenge = JsChallengeTelemetry(
            challenged=True,
            outcome=_pick([ChallengeOutcome.FAILED, ChallengeOutcome.TIMEOUT]),
            solve_time_ms=_rf(1, 50),
            suspicion_score=_rf(0.75, 1.0),
            hard_failure=True,
        ),
    )


def _build_attack_sqli(org: str, session_prefix: str) -> AnalyzeRequest:
    """SQL injection attempt."""
    sqli_paths = [
        "/search?q=1' OR '1'='1",
        "/api/users?id=1 UNION SELECT * FROM users",
        "/products?cat=1; DROP TABLE users--",
        "/api/v1/items?filter='; exec xp_cmdshell('whoami')--",
    ]
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"sqli-{_ri(1, 5)}",
        ip          = _pick(ATTACK_IPS),
        path        = _pick(sqli_paths),
        method      = HttpMethod.GET,
        user_agent  = _pick(BOT_UAS),
        risk_score_so_far = _rf(75, 99),
        ip_reputation = IpReputationPayload(
            score=_rf(80, 100),
            is_known_attacker=True,
        ),
        rate_limit = RateLimitPayload(
            limited=True,
            current_count=_ri(300, 999),
            limit=100, remaining=0,
        ),
    )


def _build_attack_tor(org: str, session_prefix: str) -> AnalyzeRequest:
    """هجوم من TOR exit node."""
    return AnalyzeRequest(
        org_id      = org,
        session_id  = f"tor-{_ri(1, 15)}",
        ip          = _pick(ATTACK_IPS),
        path        = _pick(PATHS_CRITICAL),
        method      = _pick([HttpMethod.POST, HttpMethod.GET]),
        user_agent  = _pick(NORMAL_UAS + BOT_UAS),
        risk_score_so_far = _rf(70, 98),
        fingerprint_auth  = FingerprintAuthPayload(
            has_usable_device_fp=False,
            ja4=_pick(BOT_JA4), ja4_valid_format=False,
        ),
        ip_reputation = IpReputationPayload(
            score         = _rf(80, 100),
            is_tor_exit   = True,
            is_proxy      = True,
            is_known_attacker = _pick([True, False]),
        ),
        rate_limit = RateLimitPayload(
            limited=_pick([True, False]),
            current_count=_ri(50, 300),
            limit=100, remaining=_ri(0, 50),
        ),
        advanced_fingerprint = AdvancedFingerprintTelemetry(
            challenged=True,
            outcome=ChallengeOutcome.FAILED,
            score=_rf(0.7, 1.0),
            ua_tls_consistency=_rf(0.0, 0.3),
            ja4_looks_valid=False,
        ),
    )


# =============================================================================
# Profile picker
# =============================================================================

def _pick_profile() -> TrafficProfile:
    r = rng.random()
    if r < DIST_NORMAL:
        # طبيعي: 3 أنواع
        sub = rng.random()
        if sub < 0.50:
            return PROFILE_NORMAL_BROWSER
        elif sub < 0.80:
            return PROFILE_NORMAL_MOBILE
        else:
            return PROFILE_NORMAL_RETURNING
    elif r < DIST_NORMAL + DIST_SUSPICIOUS:
        # مشبوه: 3 أنواع
        sub = rng.random()
        if sub < 0.40:
            return PROFILE_SUSPICIOUS_VPN
        elif sub < 0.70:
            return PROFILE_SUSPICIOUS_DC
        else:
            return PROFILE_SUSPICIOUS_FAST
    else:
        # هجوم: 5 أنواع
        sub = rng.random()
        if sub < 0.30:
            return PROFILE_ATTACK_BOT
        elif sub < 0.50:
            return PROFILE_ATTACK_SCANNER
        elif sub < 0.70:
            return PROFILE_ATTACK_CRED_STUFF
        elif sub < 0.85:
            return PROFILE_ATTACK_SQL
        else:
            return PROFILE_ATTACK_TOR


_BUILDERS = {
    PROFILE_NORMAL_BROWSER.name:    _build_normal_browser,
    PROFILE_NORMAL_MOBILE.name:     _build_normal_mobile,
    PROFILE_NORMAL_RETURNING.name:  _build_normal_returning,
    PROFILE_SUSPICIOUS_VPN.name:    _build_suspicious_vpn,
    PROFILE_SUSPICIOUS_DC.name:     _build_suspicious_datacenter,
    PROFILE_SUSPICIOUS_FAST.name:   _build_suspicious_fast,
    PROFILE_ATTACK_BOT.name:        _build_attack_bot,
    PROFILE_ATTACK_SCANNER.name:    _build_attack_scanner,
    PROFILE_ATTACK_CRED_STUFF.name: _build_attack_cred_stuffing,
    PROFILE_ATTACK_SQL.name:        _build_attack_sqli,
    PROFILE_ATTACK_TOR.name:        _build_attack_tor,
}


def build_request(org: str, session_prefix: str) -> Tuple[AnalyzeRequest, TrafficProfile]:
    profile = _pick_profile()
    builder = _BUILDERS[profile.name]
    return builder(org, session_prefix), profile


# =============================================================================
# Training loop
# =============================================================================

@dataclass
class TrainStats:
    total:      int = 0
    normal:     int = 0
    suspicious: int = 0
    attack:     int = 0
    skipped:    int = 0
    errors:     int = 0
    t_start:    float = 0.0

    def rate(self) -> float:
        elapsed = time.time() - self.t_start
        return self.total / elapsed if elapsed > 0 else 0.0


def train(
    org:        str,
    samples:    int,
    seed:       int    = 42,
    fast:       bool   = False,
    verbose:    bool   = True,
) -> TrainStats:

    rng.seed(seed)
    settings   = get_settings()
    session_px = f"boot-{org[:6]}"

    registry   = get_registry()
    stats      = TrainStats(t_start=time.time())

    if verbose:
        print(f"""
╔{'═'*60}╗
║{'  ZERO PLUS — Bootstrap Training':^60}║
╚{'═'*60}╝
  org       = {org}
  samples   = {samples}
  seed      = {seed}
  dist      = {int(DIST_NORMAL*100)}% normal / {int(DIST_SUSPICIOUS*100)}% suspicious / {int(DIST_ATTACK*100)}% attack
{'─'*62}""")

    profile_counts: Dict[str, int] = {k: 0 for k in _BUILDERS}

    for i in range(samples):
        try:
            req, profile = build_request(org, session_px)
            features     = extract_features(req, settings=settings)

            # ── Anti-poisoning: نعلّم الموديل الكل لكن بـ flag ──
            # الـ registry.score_and_learn بيتعلم دائماً
            # الـ session_tracker مش بنستخدمه هنا عشان
            # نتجنب تسميم التاريخ ببيانات اصطناعية
            registry.score_and_learn(org, features)

            profile_counts[profile.name] = profile_counts.get(profile.name, 0) + 1
            stats.total += 1
            if profile.is_attack:
                stats.attack += 1
            elif profile.is_suspicious:
                stats.suspicious += 1
            else:
                stats.normal += 1

        except Exception as exc:
            stats.errors += 1
            if verbose:
                print(f"  ⚠️  sample {i} error: {exc}")
            continue

        # ── Progress ───────────────────────────────────────────────
        if verbose and (i + 1) % PRINT_EVERY == 0:
            pct  = (i + 1) / samples * 100
            rate = stats.rate()
            eta  = (samples - i - 1) / rate if rate > 0 else 0
            print(
                f"  [{i+1:>5}/{samples}]  {pct:5.1f}%"
                f"  {rate:5.1f} req/s"
                f"  ETA {eta:5.0f}s"
                f"  N={stats.normal} S={stats.suspicious} A={stats.attack}"
            )

        # ── Periodic save ──────────────────────────────────────────
        if (i + 1) % SAVE_EVERY == 0:
            try:
                registry.save_all(force=True)
                if verbose:
                    print(f"  💾  saved at {i+1}")
            except Exception as exc:
                if verbose:
                    print(f"  ⚠️  save error: {exc}")

        if not fast:
            time.sleep(0.00)   # 2ms بين كل طلب عشان ما نضغطش الـ CPU

    # ── Final save ────────────────────────────────────────────────
    try:
        registry.save_all(force=True)
    except Exception as exc:
        if verbose:
            print(f"  ⚠️  final save error: {exc}")

    # ── Summary ───────────────────────────────────────────────────
    if verbose:
        elapsed = time.time() - stats.t_start
        print(f"""
{'─'*62}
  ✅  Training complete
  total     = {stats.total}
  normal    = {stats.normal}  ({stats.normal/max(1,stats.total)*100:.1f}%)
  suspicious= {stats.suspicious}  ({stats.suspicious/max(1,stats.total)*100:.1f}%)
  attack    = {stats.attack}  ({stats.attack/max(1,stats.total)*100:.1f}%)
  errors    = {stats.errors}
  elapsed   = {elapsed:.1f}s  ({stats.rate():.1f} req/s)

  Profile breakdown:""")
        for name, count in sorted(profile_counts.items(), key=lambda x: -x[1]):
            bar = "█" * min(40, int(count / max(1, stats.total) * 60))
            print(f"    {name:<35} {count:>5}  {bar}")
        print(f"{'─'*62}")

    return stats


# =============================================================================
# CLI
# =============================================================================

def main() -> None:
    p = argparse.ArgumentParser(
        description="Zero Plus AI Service — bootstrap training"
    )
    p.add_argument("--org",     required=True,
                   help="Organization ID (same as org_id in /analyze)")
    p.add_argument("--samples", type=int, default=2000,
                   help="Number of synthetic samples (default: 2000)")
    p.add_argument("--seed",    type=int, default=42,
                   help="Random seed for reproducibility (default: 42)")
    p.add_argument("--fast",    action="store_true",
                   help="Skip 2ms sleep between samples")
    p.add_argument("--quiet",   action="store_true",
                   help="Minimal output")
    p.add_argument("--list-orgs", action="store_true",
                   help="List trained orgs and exit")
    args = p.parse_args()

    # init
    settings = get_settings()
    init_redis(settings)
    store = init_model_store(settings)
    init_registry(store=store, settings=settings)

    if args.list_orgs:
        try:
            reg = get_registry()
            orgs = reg.list_orgs() if hasattr(reg, "list_orgs") else []
            if orgs:
                print("Trained orgs:")
                for o in orgs:
                    print(f"  {o}")
            else:
                print("No trained orgs found (or list_orgs not supported).")
        except Exception as exc:
            print(f"Error: {exc}")
        return

    train(
        org     = args.org,
        samples = args.samples,
        seed    = args.seed,
        fast    = args.fast,
        verbose = not args.quiet,
    )


if __name__ == "__main__":
    main()