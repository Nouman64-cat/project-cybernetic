"""
Cybernetic — FastAPI application entry point.

Responsibilities of this module (and ONLY this module):
  - Compose the FastAPI app instance.
  - Register global middleware (CORS, future: auth, rate-limiting).
  - Declare startup/shutdown side-effects via the lifespan context manager.
  - Mount routers.

No business logic, no database queries, no orchestration code lives here.
"""

import logging
import logging.config
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import create_db_and_tables
from .routers.research import router as research_router

# ---------------------------------------------------------------------------
# Logging — configure before the app object is created so lifespan events
# are captured in structured format from the very first line.
# ---------------------------------------------------------------------------

logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "format": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
            }
        },
        "root": {"level": "INFO", "handlers": ["console"]},
        # Reduce noise from chatty third-party libraries
        "loggers": {
            "httpx": {"level": "WARNING"},
            "httpcore": {"level": "WARNING"},
            "autogen_core": {"level": "WARNING"},
            "autogen_agentchat": {"level": "WARNING"},
        },
    }
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — replaces deprecated @app.on_event("startup") pattern
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Handles application startup and shutdown events.

    Startup:
      - Initialise database tables.  In production, replace with Alembic
        migration invocation.

    Shutdown:
      - No explicit teardown needed for SQLite/single-process deployments.
        Add connection pool draining here when migrating to PostgreSQL.
    """
    logger.info("Cybernetic API starting up...")
    create_db_and_tables()
    logger.info("Database ready.")
    yield
    logger.info("Cybernetic API shutting down.")


# ---------------------------------------------------------------------------
# App instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Cybernetic Research API",
    description=(
        "Deep research platform powered by a two-agent AutoGen pipeline "
        "(ResearcherAgent + SynthesizerAgent). Accepts natural-language research "
        "queries, runs async web research, and returns synthesized markdown reports."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(research_router)

# ---------------------------------------------------------------------------
# Health check — kept in main.py deliberately; it has no domain logic and
# documents that the server root is alive.
# ---------------------------------------------------------------------------


@app.get("/health", tags=["meta"], summary="Liveness probe")
async def health_check() -> dict[str, str]:
    """Returns 200 OK when the service is running.  Used by load balancers and CI."""
    return {"status": "ok", "service": "Cybernetic API", "version": "0.1.0"}
