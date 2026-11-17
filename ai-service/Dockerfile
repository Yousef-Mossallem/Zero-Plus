# ============================================================
# Zero Plus — AI Service
# Multi-stage Dockerfile for production
# ============================================================

# ── Stage 1: builder ────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# system deps for River + numpy + cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: runtime ────────────────────────────────────────
FROM python:3.11-slim AS runtime

# non-root user
RUN groupadd -r zpai && useradd -r -g zpai -d /app -s /sbin/nologin zpai

WORKDIR /app

# copy installed packages from builder
COPY --from=builder /install /usr/local

# copy application code
COPY --chown=zpai:zpai app/ ./app/

# models are persisted to a volume, not baked in
RUN mkdir -p /app/models_store && chown zpai:zpai /app/models_store

USER zpai

# health-check every 30s — calls /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c \
    "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')" \
    || exit 1

EXPOSE 8001

# uvicorn with 2 workers (stateless — models loaded per process from disk)
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8001", \
     "--workers", "2", \
     "--loop", "uvloop", \
     "--log-level", "info", \
     "--no-access-log"]