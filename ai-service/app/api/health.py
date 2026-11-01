# app/api/health.py
# ============================================================
# Zero Plus — AI Service
# Health & readiness endpoints
# ============================================================

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Health"])


@router.get("/health", summary="Liveness probe")
async def health() -> Dict[str, Any]:
    """
    Simple liveness check.
    Returns 200 as long as the process is running.
    Used by Docker / Kubernetes / load balancers.
    """
    return {
        "status": "ok",
        "service": "zero-plus-ai",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ready", summary="Readiness probe")
async def ready(request: Request) -> JSONResponse:
    """
    Readiness check.
    Later we will also verify Redis connectivity and that models can be loaded.
    For now it only confirms the application has finished startup.
    """
    app = request.app
    startup_complete = getattr(app.state, "startup_complete", False)

    body = {
        "status": "ready" if startup_complete else "starting",
        "service": "zero-plus-ai",
        "startup_complete": startup_complete,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    status_code = 200 if startup_complete else 503
    return JSONResponse(content=body, status_code=status_code)


@router.get("/info", summary="Service information")
async def info(request: Request) -> Dict[str, Any]:
    """
    Basic runtime information (safe to expose internally).
    """
    settings = request.app.state.settings

    return {
        "service": settings.app_name,
        "env": settings.app_env,
        "debug": settings.app_debug,
        "version": "0.1.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }