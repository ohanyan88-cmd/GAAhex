# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# GAAhex backend — production image (multi-stage)
# Base: python:3.12-slim
# Runs as non-root user `gaahex` (uid 10001) on port 8099
# ---------------------------------------------------------------------------

# ============================================================================
# Stage 1: builder — install Python deps into an isolated prefix
# ============================================================================
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build deps needed for asyncpg / cryptography / bcrypt wheels (some target
# platforms still need a compiler even though wheels usually cover Linux x86_64)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Install runtime requirements into /install (NOT requirements-dev.txt)
COPY requirements.txt ./
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt

# ============================================================================
# Stage 2: runtime — slim image with only what's needed to serve
# ============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/usr/local/bin:${PATH}"

# Runtime libs:
#  - libpq5: asyncpg/psycopg need libpq at runtime
#  - curl:   used by HEALTHCHECK below
#  - tini:   PID 1 init so signals reach uvicorn cleanly
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
        tini \
 && rm -rf /var/lib/apt/lists/*

# Non-root user (uid 10001) — runs the app
RUN groupadd --system --gid 10001 gaahex \
 && useradd --system --uid 10001 --gid gaahex --home-dir /app --shell /usr/sbin/nologin gaahex

# Bring installed Python packages over from the builder stage
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy only what the app needs to run
COPY --chown=gaahex:gaahex app/         /app/app/
COPY --chown=gaahex:gaahex alembic/     /app/alembic/
COPY --chown=gaahex:gaahex alembic.ini  /app/alembic.ini

USER gaahex

EXPOSE 8099

# Health check — hits the public /api/health endpoint via loopback
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8099/api/health || exit 1

# tini reaps zombies and forwards SIGTERM cleanly to uvicorn
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8099"]
