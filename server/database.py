"""
Database engine and session management.

Kept separate from models.py so that engine construction (which reads env
vars) does not execute at import time of models — important for test
isolation and Celery worker initialization.
"""

from collections.abc import Generator
from contextlib import contextmanager

from sqlmodel import Session, SQLModel, create_engine

from .config import settings

# check_same_thread is a SQLite-only flag; passing it to PostgreSQL raises an
# error.  We detect the driver from the URL and only apply it for SQLite.
_is_sqlite = settings.database_url.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args=_connect_args,
)


def create_db_and_tables() -> None:
    """
    Creates all tables defined by SQLModel metadata.

    Uses checkfirst=True (the SQLAlchemy default) so existing tables are
    skipped safely.  The try/except guards against the rare PostgreSQL race
    where two processes start simultaneously and collide on the implicit
    composite type PostgreSQL creates alongside each new table.
    """
    import logging
    from sqlalchemy.exc import IntegrityError, ProgrammingError

    logger = logging.getLogger(__name__)
    try:
        SQLModel.metadata.create_all(engine)
    except (ProgrammingError, IntegrityError) as exc:
        # Two processes racing on startup can collide on the implicit composite
        # type PostgreSQL creates alongside each new table, raising either a
        # ProgrammingError ("already exists") or an IntegrityError
        # (UniqueViolation on pg_type_typname_nsp_index).  Both are safe to
        # swallow — the table was created by the winning process.
        msg = str(exc.orig)
        if "already exists" in msg or "duplicate key" in msg:
            logger.warning("Schema already initialised (concurrent startup race) — skipping.")
        else:
            raise


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """
    Yields a SQLModel Session and guarantees cleanup on exit.

    Usage (inside any non-FastAPI context, e.g., background tasks):
        with get_session() as session:
            session.add(obj)
            session.commit()

    For FastAPI endpoints that need dependency injection, see
    get_session_dep() below.
    """
    with Session(engine) as session:
        yield session


def get_session_dep() -> Generator[Session, None, None]:
    """
    FastAPI Depends()-compatible session generator.

    Usage in a route:
        @router.get("/")
        def endpoint(session: Session = Depends(get_session_dep)):
            ...
    """
    with Session(engine) as session:
        yield session
