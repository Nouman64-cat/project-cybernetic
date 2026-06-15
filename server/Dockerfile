# ─── Build stage ──────────────────────────────────────────────────────────────
# Using slim (Debian-based) rather than alpine because psycopg2-binary and
# lxml ship pre-built wheels for Debian that install without a compiler.
FROM python:3.12-slim AS builder

WORKDIR /build

# Install pip dependencies into an isolated prefix so the final image
# only copies what it needs (avoids carrying build-time apt caches).
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Non-root user for least-privilege execution
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

# Copy pre-built packages from builder
COPY --from=builder /install /usr/local

# Copy the full project (server/ package + root entry point)
COPY --chown=appuser:appgroup . .

USER appuser

# Expose the API port (matches run_server.py default and docker-compose mapping)
EXPOSE 7005

# Default command: run the API server.
# The Celery worker service overrides this via docker-compose `command:`.
# Single worker: DB schema init in lifespan runs exactly once per process.
# Horizontal scale comes from Celery workers, not from uvicorn workers.
# Add --workers N only after migrating schema management to Alembic.
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "7005"]
