# app/features/path_sensitivity.py
# ============================================================
# Zero Plus — AI Service
# Path sensitivity classifier
# Exact paths + keyword/segment matching + smart heuristics
# ============================================================

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import urlparse

from app.config import Settings, get_settings


class PathSensitivityLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass(frozen=True)
class PathSensitivityResult:
    level: PathSensitivityLevel
    path: str
    matched_rule: Optional[str] = None
    match_type: Optional[str] = None          # exact | prefix | keyword | heuristic | default
    score: float = 0.0                        # 0.0 → 1.0 rough intensity
    reasons: Tuple[str, ...] = ()


# =============================================================================
# Built-in knowledge base (very large, covers most real-world sites)
# Order of evaluation later: CRITICAL > HIGH > MEDIUM > LOW
# =============================================================================

# ---------------------------------------------------------------------------
# CRITICAL — account takeover, payment, admin, auth secrets
# ---------------------------------------------------------------------------
CRITICAL_EXACT: Set[str] = {
    "/login",
    "/logout",
    "/signin",
    "/sign-in",
    "/signout",
    "/sign-out",
    "/signup",
    "/sign-up",
    "/register",
    "/registration",
    "/auth",
    "/oauth",
    "/oauth2",
    "/sso",
    "/saml",
    "/cas",
    "/wp-login.php",
    "/wp-admin",
    "/admin",
    "/administrator",
    "/admin.php",
    "/user/login",
    "/user/logout",
    "/user/register",
    "/account/login",
    "/account/logout",
    "/accounts/login",
    "/session",
    "/sessions",
    "/password",
    "/passwords",
    "/reset-password",
    "/forgot-password",
    "/forgot",
    "/recover",
    "/recovery",
    "/change-password",
    "/update-password",
    "/set-password",
    "/verify",
    "/verification",
    "/2fa",
    "/mfa",
    "/otp",
    "/totp",
    "/checkout",
    "/check-out",
    "/cart/checkout",
    "/payment",
    "/payments",
    "/pay",
    "/billing",
    "/invoice",
    "/invoices",
    "/subscribe",
    "/subscription",
    "/subscriptions",
    "/donate",
    "/donation",
    "/wallet",
    "/wallets",
    "/transfer",
    "/withdraw",
    "/withdrawal",
    "/deposit",
    "/api/auth",
    "/api/login",
    "/api/logout",
    "/api/register",
    "/api/token",
    "/api/tokens",
    "/api/session",
    "/api/sessions",
    "/api/password",
    "/api/checkout",
    "/api/payment",
    "/api/payments",
    "/api/billing",
    "/api/admin",
    "/graphql",
    "/graphiql",
    "/playground",
}

CRITICAL_PREFIXES: Tuple[str, ...] = (
    "/admin/",
    "/administrator/",
    "/wp-admin/",
    "/wp-login",
    "/auth/",
    "/oauth/",
    "/oauth2/",
    "/sso/",
    "/saml/",
    "/login/",
    "/signin/",
    "/sign-in/",
    "/signup/",
    "/sign-up/",
    "/register/",
    "/password/",
    "/reset-password/",
    "/forgot-password/",
    "/checkout/",
    "/payment/",
    "/payments/",
    "/billing/",
    "/subscribe/",
    "/subscription/",
    "/api/auth/",
    "/api/login/",
    "/api/logout/",
    "/api/register/",
    "/api/token/",
    "/api/session/",
    "/api/password/",
    "/api/checkout/",
    "/api/payment/",
    "/api/billing/",
    "/api/admin/",
    "/account/security/",
    "/user/security/",
    "/settings/security/",
    "/settings/password/",
)

CRITICAL_KEYWORDS: Tuple[str, ...] = (
    "login",
    "log-in",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "signout",
    "sign-out",
    "logout",
    "log-out",
    "register",
    "registration",
    "auth",
    "oauth",
    "sso",
    "saml",
    "password",
    "passwd",
    "pwd",
    "reset-password",
    "forgot-password",
    "changepassword",
    "change-password",
    "2fa",
    "mfa",
    "otp",
    "totp",
    "one-time",
    "checkout",
    "check-out",
    "payment",
    "payments",
    "paynow",
    "pay-now",
    "billing",
    "invoice",
    "subscribe",
    "subscription",
    "donate",
    "donation",
    "wallet",
    "withdraw",
    "withdrawal",
    "deposit",
    "transfer",
    "admin",
    "administrator",
    "wp-admin",
    "wp-login",
    "root",
    "superuser",
    "graphql",
    "graphiql",
)

# ---------------------------------------------------------------------------
# HIGH — sensitive account / personal / financial adjacent
# ---------------------------------------------------------------------------
HIGH_EXACT: Set[str] = {
    "/account",
    "/accounts",
    "/profile",
    "/profiles",
    "/user",
    "/users",
    "/member",
    "/members",
    "/my-account",
    "/myaccount",
    "/dashboard",
    "/settings",
    "/setting",
    "/preferences",
    "/security",
    "/privacy",
    "/cart",
    "/basket",
    "/bag",
    "/order",
    "/orders",
    "/my-orders",
    "/wishlist",
    "/favorites",
    "/favourites",
    "/address",
    "/addresses",
    "/shipping",
    "/shipping-address",
    "/billing-address",
    "/credit-card",
    "/creditcard",
    "/card",
    "/cards",
    "/bank",
    "/banks",
    "/iban",
    "/api/user",
    "/api/users",
    "/api/account",
    "/api/accounts",
    "/api/profile",
    "/api/cart",
    "/api/order",
    "/api/orders",
    "/api/me",
    "/api/v1/me",
    "/api/v1/user",
    "/api/v1/account",
    "/connect",
    "/callback",
    "/oauth/callback",
    "/auth/callback",
    "/magic-link",
    "/magiclink",
    "/confirm",
    "/confirmation",
    "/activate",
    "/activation",
    "/invite",
    "/invitation",
    "/token",
    "/tokens",
    "/api/key",
    "/api/keys",
    "/apikey",
    "/api-key",
}

HIGH_PREFIXES: Tuple[str, ...] = (
    "/account/",
    "/accounts/",
    "/profile/",
    "/profiles/",
    "/user/",
    "/users/",
    "/member/",
    "/members/",
    "/my-account/",
    "/dashboard/",
    "/settings/",
    "/setting/",
    "/preferences/",
    "/security/",
    "/privacy/",
    "/cart/",
    "/basket/",
    "/order/",
    "/orders/",
    "/wishlist/",
    "/address/",
    "/addresses/",
    "/shipping/",
    "/billing/",
    "/api/user/",
    "/api/users/",
    "/api/account/",
    "/api/profile/",
    "/api/cart/",
    "/api/order/",
    "/api/orders/",
    "/api/me/",
    "/api/v1/me/",
    "/api/v1/user/",
    "/api/v1/account/",
    "/connect/",
    "/callback/",
    "/oauth/callback/",
    "/auth/callback/",
    "/invite/",
    "/invitation/",
    "/token/",
    "/tokens/",
    "/api/key/",
    "/api/keys/",
)

HIGH_KEYWORDS: Tuple[str, ...] = (
    "account",
    "accounts",
    "profile",
    "profiles",
    "dashboard",
    "settings",
    "preferences",
    "security",
    "privacy",
    "cart",
    "basket",
    "checkout",          # still high if not already critical
    "order",
    "orders",
    "wishlist",
    "favorite",
    "favourite",
    "address",
    "shipping",
    "billing",
    "creditcard",
    "credit-card",
    "paymentmethod",
    "payment-method",
    "bank",
    "iban",
    "callback",
    "oauth",
    "magic-link",
    "magiclink",
    "confirm",
    "confirmation",
    "activate",
    "activation",
    "invite",
    "invitation",
    "apikey",
    "api-key",
    "access-token",
    "refresh-token",
    "session",
    "my-account",
    "myaccount",
)

# ---------------------------------------------------------------------------
# MEDIUM — APIs, forms, search, upload, user content, internal tools
# ---------------------------------------------------------------------------
MEDIUM_EXACT: Set[str] = {
    "/api",
    "/api/",
    "/rest",
    "/rest/",
    "/graphql",
    "/search",
    "/find",
    "/query",
    "/filter",
    "/upload",
    "/uploads",
    "/file",
    "/files",
    "/media",
    "/attachment",
    "/attachments",
    "/export",
    "/import",
    "/download",
    "/downloads",
    "/report",
    "/reports",
    "/analytics",
    "/stats",
    "/statistics",
    "/admin-ajax.php",
    "/xmlrpc.php",
    "/wp-json",
    "/wp-json/",
    "/feed",
    "/rss",
    "/atom",
    "/sitemap",
    "/sitemap.xml",
    "/robots.txt",
    "/.well-known",
    "/.well-known/",
    "/health",
    "/healthz",
    "/ready",
    "/readiness",
    "/live",
    "/liveness",
    "/status",
    "/metrics",
    "/debug",
    "/test",
    "/testing",
    "/dev",
    "/development",
    "/internal",
    "/private",
    "/console",
    "/panel",
    "/manage",
    "/management",
    "/cms",
    "/editor",
    "/edit",
    "/create",
    "/update",
    "/delete",
    "/remove",
    "/save",
    "/submit",
    "/form",
    "/forms",
    "/contact",
    "/contact-us",
    "/support",
    "/ticket",
    "/tickets",
    "/helpdesk",
    "/feedback",
    "/review",
    "/reviews",
    "/comment",
    "/comments",
    "/reply",
    "/message",
    "/messages",
    "/inbox",
    "/notification",
    "/notifications",
    "/alert",
    "/alerts",
}

MEDIUM_PREFIXES: Tuple[str, ...] = (
    "/api/",
    "/rest/",
    "/v1/",
    "/v2/",
    "/v3/",
    "/graphql/",
    "/search/",
    "/find/",
    "/query/",
    "/upload/",
    "/uploads/",
    "/file/",
    "/files/",
    "/media/",
    "/attachment/",
    "/export/",
    "/import/",
    "/download/",
    "/downloads/",
    "/report/",
    "/reports/",
    "/analytics/",
    "/stats/",
    "/wp-json/",
    "/.well-known/",
    "/debug/",
    "/test/",
    "/dev/",
    "/internal/",
    "/private/",
    "/console/",
    "/panel/",
    "/manage/",
    "/cms/",
    "/editor/",
    "/edit/",
    "/create/",
    "/update/",
    "/delete/",
    "/form/",
    "/forms/",
    "/contact/",
    "/support/",
    "/ticket/",
    "/tickets/",
    "/feedback/",
    "/review/",
    "/reviews/",
    "/comment/",
    "/comments/",
    "/message/",
    "/messages/",
    "/notification/",
    "/notifications/",
)

MEDIUM_KEYWORDS: Tuple[str, ...] = (
    "api",
    "rest",
    "graphql",
    "search",
    "query",
    "filter",
    "upload",
    "download",
    "export",
    "import",
    "file",
    "files",
    "media",
    "attachment",
    "report",
    "analytics",
    "stats",
    "metrics",
    "debug",
    "test",
    "internal",
    "private",
    "console",
    "panel",
    "manage",
    "management",
    "cms",
    "editor",
    "edit",
    "create",
    "update",
    "delete",
    "remove",
    "submit",
    "form",
    "contact",
    "support",
    "ticket",
    "feedback",
    "review",
    "comment",
    "message",
    "inbox",
    "notification",
    "alert",
    "webhook",
    "hook",
    "callback",       # medium if not already higher
    "ajax",
    "rpc",
    "xmlrpc",
    "jsonrpc",
)

# ---------------------------------------------------------------------------
# Strong LOW signals (static / public assets) — used only as negative hints
# ---------------------------------------------------------------------------
LOW_PREFIXES: Tuple[str, ...] = (
    "/static/",
    "/assets/",
    "/public/",
    "/dist/",
    "/build/",
    "/_next/",
    "/_nuxt/",
    "/.nuxt/",
    "/images/",
    "/img/",
    "/imgs/",
    "/css/",
    "/js/",
    "/scripts/",
    "/styles/",
    "/fonts/",
    "/font/",
    "/icons/",
    "/icon/",
    "/favicon",
    "/media/public/",
    "/cdn/",
    "/static-assets/",
)

LOW_EXTENSIONS: Tuple[str, ...] = (
    ".css",
    ".js",
    ".mjs",
    ".map",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".mp4",
    ".webm",
    ".mp3",
    ".wav",
    ".pdf",
    ".txt",
    ".xml",
    ".json",          # careful: many APIs end with .json — handled by higher rules first
    ".html",
    ".htm",
)


# =============================================================================
# Helpers
# =============================================================================

_SLASH_RE = re.compile(r"/{2,}")
_QUERY_RE = re.compile(r"\?.*$")
_FRAGMENT_RE = re.compile(r"#.*$")


def normalize_path(raw: Optional[str]) -> str:
    """
    Turn any input into a clean path:
    - accept full URLs and keep only the path
    - lowercase
    - strip query & fragment
    - collapse multiple slashes
    - ensure leading slash
    - remove trailing slash (except root)
    """
    if not raw or not isinstance(raw, str):
        return "/"

    text = raw.strip()
    if not text:
        return "/"

    # If it looks like a full URL, extract path
    if "://" in text or text.startswith("//"):
        try:
            parsed = urlparse(text if "://" in text else "http:" + text)
            text = parsed.path or "/"
        except Exception:
            text = "/"

    text = _QUERY_RE.sub("", text)
    text = _FRAGMENT_RE.sub("", text)
    text = text.strip().lower()
    text = _SLASH_RE.sub("/", text)

    if not text.startswith("/"):
        text = "/" + text

    if len(text) > 1 and text.endswith("/"):
        text = text.rstrip("/")

    return text or "/"


def _path_segments(path: str) -> List[str]:
    return [s for s in path.strip("/").split("/") if s]


def _contains_keyword(path: str, keywords: Sequence[str]) -> Optional[str]:
    """
    Smart keyword check:
    - matches full segment (preferred)
    - or keyword as substring of a segment (for names like user_login, resetPassword)
    """
    segments = _path_segments(path)
    lowered = path.lower()

    for kw in keywords:
        kw = kw.lower()
        # exact segment match
        if kw in segments:
            return kw
        # segment contains keyword (handle camelCase / snake_case / kebab)
        for seg in segments:
            if kw in seg:
                return kw
        # last resort: anywhere in path (still useful)
        if kw in lowered:
            return kw
    return None


def _starts_with_any(path: str, prefixes: Sequence[str]) -> Optional[str]:
    for p in prefixes:
        if path == p.rstrip("/") or path.startswith(p):
            return p
    return None


def _ends_with_extension(path: str, extensions: Sequence[str]) -> Optional[str]:
    for ext in extensions:
        if path.endswith(ext):
            return ext
    return None


# =============================================================================
# Main classifier
# =============================================================================

def classify_path(
    raw_path: Optional[str],
    *,
    settings: Optional[Settings] = None,
) -> PathSensitivityResult:
    """
    Classify a path into CRITICAL / HIGH / MEDIUM / LOW.

    Evaluation order (first match wins for level, but we keep the most specific rule):
    1. Extra rules from settings (.env) — highest priority override
    2. CRITICAL exact → prefix → keyword
    3. HIGH exact → prefix → keyword
    4. MEDIUM exact → prefix → keyword
    5. Strong LOW signals (static assets)
    6. Default → LOW
    """
    settings = settings or get_settings()
    path = normalize_path(raw_path)
    reasons: List[str] = []

    # ------------------------------------------------------------------
    # 0) Config overrides from .env (extra exact paths)
    # ------------------------------------------------------------------
    extra_high = {normalize_path(p) for p in settings.high_sensitivity_path_list}
    extra_medium = {normalize_path(p) for p in settings.medium_sensitivity_path_list}

    if path in extra_high:
        return PathSensitivityResult(
            level=PathSensitivityLevel.HIGH,
            path=path,
            matched_rule=path,
            match_type="exact",
            score=0.85,
            reasons=("config_high_exact",),
        )
    if path in extra_medium:
        return PathSensitivityResult(
            level=PathSensitivityLevel.MEDIUM,
            path=path,
            matched_rule=path,
            match_type="exact",
            score=0.55,
            reasons=("config_medium_exact",),
        )

    # Also allow config entries to act as prefixes if they end with /
    for p in settings.high_sensitivity_path_list:
        np = normalize_path(p)
        if np.endswith("/") is False:
            # treat as prefix candidate too
            if path.startswith(np + "/"):
                return PathSensitivityResult(
                    level=PathSensitivityLevel.HIGH,
                    path=path,
                    matched_rule=np,
                    match_type="prefix",
                    score=0.82,
                    reasons=("config_high_prefix",),
                )

    # ------------------------------------------------------------------
    # 1) CRITICAL
    # ------------------------------------------------------------------
    if path in CRITICAL_EXACT:
        return PathSensitivityResult(
            level=PathSensitivityLevel.CRITICAL,
            path=path,
            matched_rule=path,
            match_type="exact",
            score=1.0,
            reasons=("critical_exact",),
        )

    pref = _starts_with_any(path, CRITICAL_PREFIXES)
    if pref:
        return PathSensitivityResult(
            level=PathSensitivityLevel.CRITICAL,
            path=path,
            matched_rule=pref,
            match_type="prefix",
            score=0.97,
            reasons=("critical_prefix",),
        )

    kw = _contains_keyword(path, CRITICAL_KEYWORDS)
    if kw:
        return PathSensitivityResult(
            level=PathSensitivityLevel.CRITICAL,
            path=path,
            matched_rule=kw,
            match_type="keyword",
            score=0.93,
            reasons=("critical_keyword", f"keyword:{kw}"),
        )

    # ------------------------------------------------------------------
    # 2) HIGH
    # ------------------------------------------------------------------
    if path in HIGH_EXACT:
        return PathSensitivityResult(
            level=PathSensitivityLevel.HIGH,
            path=path,
            matched_rule=path,
            match_type="exact",
            score=0.85,
            reasons=("high_exact",),
        )

    pref = _starts_with_any(path, HIGH_PREFIXES)
    if pref:
        return PathSensitivityResult(
            level=PathSensitivityLevel.HIGH,
            path=path,
            matched_rule=pref,
            match_type="prefix",
            score=0.80,
            reasons=("high_prefix",),
        )

    kw = _contains_keyword(path, HIGH_KEYWORDS)
    if kw:
        return PathSensitivityResult(
            level=PathSensitivityLevel.HIGH,
            path=path,
            matched_rule=kw,
            match_type="keyword",
            score=0.76,
            reasons=("high_keyword", f"keyword:{kw}"),
        )

    # ------------------------------------------------------------------
    # 3) MEDIUM
    # ------------------------------------------------------------------
    if path in MEDIUM_EXACT:
        return PathSensitivityResult(
            level=PathSensitivityLevel.MEDIUM,
            path=path,
            matched_rule=path,
            match_type="exact",
            score=0.55,
            reasons=("medium_exact",),
        )

    pref = _starts_with_any(path, MEDIUM_PREFIXES)
    if pref:
        return PathSensitivityResult(
            level=PathSensitivityLevel.MEDIUM,
            path=path,
            matched_rule=pref,
            match_type="prefix",
            score=0.52,
            reasons=("medium_prefix",),
        )

    kw = _contains_keyword(path, MEDIUM_KEYWORDS)
    if kw:
        return PathSensitivityResult(
            level=PathSensitivityLevel.MEDIUM,
            path=path,
            matched_rule=kw,
            match_type="keyword",
            score=0.48,
            reasons=("medium_keyword", f"keyword:{kw}"),
        )

    # ------------------------------------------------------------------
    # 4) Strong LOW signals (static assets)
    # ------------------------------------------------------------------
    pref = _starts_with_any(path, LOW_PREFIXES)
    if pref:
        return PathSensitivityResult(
            level=PathSensitivityLevel.LOW,
            path=path,
            matched_rule=pref,
            match_type="prefix",
            score=0.05,
            reasons=("low_static_prefix",),
        )

    ext = _ends_with_extension(path, LOW_EXTENSIONS)
    if ext:
        # .json can be API — if path still contains "api" we already caught it above
        return PathSensitivityResult(
            level=PathSensitivityLevel.LOW,
            path=path,
            matched_rule=ext,
            match_type="heuristic",
            score=0.05,
            reasons=("low_static_extension", f"ext:{ext}"),
        )

    # ------------------------------------------------------------------
    # 5) Default
    # ------------------------------------------------------------------
    return PathSensitivityResult(
        level=PathSensitivityLevel.LOW,
        path=path,
        matched_rule=None,
        match_type="default",
        score=0.15,
        reasons=("default_low",),
    )


# =============================================================================
# Public helpers used by the rest of the service
# =============================================================================

def get_path_sensitivity(
    raw_path: Optional[str],
    *,
    settings: Optional[Settings] = None,
) -> PathSensitivityResult:
    """Main entry point."""
    return classify_path(raw_path, settings=settings)


def sensitivity_to_weight(level: PathSensitivityLevel) -> float:
    """Numeric weight for feature vectors / decision helper."""
    return {
        PathSensitivityLevel.LOW: 0.15,
        PathSensitivityLevel.MEDIUM: 0.45,
        PathSensitivityLevel.HIGH: 0.75,
        PathSensitivityLevel.CRITICAL: 1.0,
    }[level]


__all__ = [
    "PathSensitivityLevel",
    "PathSensitivityResult",
    "classify_path",
    "get_path_sensitivity",
    "sensitivity_to_weight",
    "normalize_path",
]