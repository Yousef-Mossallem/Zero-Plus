# app/main.py
# ============================================================
# Zero Plus — AI Service
# FastAPI application entrypoint
#
# مسؤوليات هذا الملف فقط:
#   1) يبني تطبيق FastAPI
#   2) startup:  Redis → ModelStore → Registry → ClearanceMonitor → Routers
#   3) shutdown: save_all → close_registry → close_redis
#   4) يربط الـ routers  (/health  +  /analyze)
#   5) يخلي الإعدادات متاحة عبر app.state
#
# لا يحسب anomaly ولا recommendation — ده شغل analyze.py والملفات تحتها.
# ============================================================

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings

logger = logging.getLogger("zero-plus-ai")


# =============================================================================
# Logging
# =============================================================================

def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )


# =============================================================================
# Lifespan  (startup / shutdown)
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    app.state.startup_complete = False

    logger.info("━━━ Zero Plus AI Service ━━━ starting (env=%s)", settings.app_env)

    # ------------------------------------------------------------------
    # 1) Redis
    # ------------------------------------------------------------------
    try:
        from app.persistence.redis_client import init_redis
        redis_client = init_redis(settings)
        if redis_client.available:
            logger.info("Redis connected ✓")
        else:
            logger.warning(
                "Redis unavailable — service stays up (fail-open). "
                "Cache and session history will not work until Redis recovers."
            )
        app.state.redis = redis_client
    except Exception as exc:
        logger.error("Redis init error (non-fatal): %s", exc)
        app.state.redis = None

    # ------------------------------------------------------------------
    # 2) Model store (directory / path)
    # ------------------------------------------------------------------
    try:
        from app.persistence.model_store import init_model_store
        store = init_model_store(settings)
        app.state.model_store = store
        logger.info("ModelStore ready path=%s", store.root)
    except Exception as exc:
        logger.error("ModelStore init error (non-fatal): %s", exc)
        app.state.model_store = None

    # ------------------------------------------------------------------
    # 3) Model registry  (anomaly + surge per org, lazy-loaded)
    # ------------------------------------------------------------------
    try:
        from app.models.model_registry import init_registry
        store_arg = getattr(app.state, "model_store", None)
        registry = init_registry(store=store_arg, settings=settings)
        app.state.registry = registry
        logger.info("ModelRegistry ready ✓")
    except Exception as exc:
        logger.error("ModelRegistry init error (non-fatal): %s", exc)
        app.state.registry = None

    # ------------------------------------------------------------------
    # 4) Clearance monitor singleton  (wire revoke callback if available)
    # ------------------------------------------------------------------
    try:
        from app.services.clearance_monitor import get_clearance_monitor
        monitor = get_clearance_monitor()
        app.state.clearance_monitor = monitor
        logger.info(
            "ClearanceMonitor ready mode=%s ✓",
            monitor.mode.value,
        )
    except Exception as exc:
        logger.error("ClearanceMonitor init error (non-fatal): %s", exc)
        app.state.clearance_monitor = None

    # ------------------------------------------------------------------
    # 5) Session tracker singleton (pre-warm, not strictly necessary)
    # ------------------------------------------------------------------
    try:
        from app.features.session_tracker import get_session_tracker
        get_session_tracker()
        logger.info("SessionTracker ready ✓")
    except Exception as exc:
        logger.error("SessionTracker init error (non-fatal): %s", exc)

    # ------------------------------------------------------------------
    # Ready
    # ------------------------------------------------------------------
    app.state.startup_complete = True
    logger.info(
        "━━━ Zero Plus AI Service ━━━ ready  %s:%s",
        settings.app_host,
        settings.app_port,
    )

    # ==================== YIELD — application runs ====================
    yield
    # ==================================================================

    # ------------------------------------------------------------------
    # Shutdown — الترتيب مهم: حفظ الموديلات أولاً قبل إغلاق أي اتصال
    # ------------------------------------------------------------------
    logger.info("━━━ Zero Plus AI Service ━━━ shutting down …")
    app.state.startup_complete = False

    # حفظ كل الموديلات المتعلّمة
    try:
        from app.models.model_registry import close_registry
        reg = getattr(app.state, "registry", None)
        if reg is not None and not reg.closed:
            saved = reg.save_all(force=True)
            logger.info("ModelRegistry: flushed %s orgs", saved)
        close_registry()
        logger.info("ModelRegistry closed ✓")
    except Exception as exc:
        logger.error("ModelRegistry shutdown error: %s", exc)

    # إغلاق Redis
    try:
        from app.persistence.redis_client import close_redis
        close_redis()
        logger.info("Redis closed ✓")
    except Exception as exc:
        logger.error("Redis shutdown error: %s", exc)

    logger.info("━━━ Zero Plus AI Service ━━━ stopped")


# =============================================================================
# Application factory
# =============================================================================

def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)

    app = FastAPI(
        title="Zero Plus AI Service",
        description=(
            "Online-learning AI service for the Zero Plus traffic gateway.\n\n"
            "Returns anomaly scores, session-drift, surge detection, and "
            "actionable recommendations: "
            "ALLOW / MONITOR / RATE_LIMIT / JS_CHALLENGE / "
            "ADVANCED_FINGERPRINT / STRICT / REVOKE_CLEARANCE / BLOCK."
        ),
        version="1.0.0",
        lifespan=lifespan,
        # Swagger/ReDoc only in non-production
        docs_url="/docs"  if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
    )

    # Settings متاحة لكل الملفات عبر request.app.state.settings
    app.state.settings         = settings
    app.state.startup_complete = False
    app.state.redis            = None
    app.state.registry         = None
    app.state.model_store      = None
    app.state.clearance_monitor = None

    # ------------------------------------------------------------------
    # CORS  (الـ Gateway هو الـ caller الحقيقي)
    # ------------------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins     = settings.cors_origins_list,
        allow_credentials = True,
        allow_methods     = ["POST", "GET", "OPTIONS"],
        allow_headers     = ["*"],
    )

    # ------------------------------------------------------------------
    # Routers
    # ------------------------------------------------------------------
    from app.api.health import router as health_router
    app.include_router(health_router)

    # analyze router  (بيتحمّل بعد lifespan، لكن الـ import هنا)
    try:
        from app.api.analyze import router as analyze_router
        app.include_router(analyze_router, prefix="", tags=["analyze"])
        logger.debug("analyze router registered ✓")
    except ImportError as exc:
        # لو الملف لسه ما اتكتبش → الخدمة بتشتغل بدون /analyze
        logger.warning("analyze router not found (skipped): %s", exc)

    # ------------------------------------------------------------------
    # Global exception handler  (رد موحد لأي خطأ غير متوقع)
    # ------------------------------------------------------------------
    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled error  %s %s", request.method, request.url.path
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status": "error",
                "detail": "Internal server error",
                "path": str(request.url.path),
            },
        )

    return app


# =============================================================================
# Entrypoint for  `uvicorn app.main:app`
# =============================================================================

app = create_app()