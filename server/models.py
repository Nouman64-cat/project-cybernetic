"""
SQLModel schemas for Cybernetic.

Design rules enforced here:
  - Table models (table=True) carry only persistence concerns: PKs, FKs,
    timestamps, indexes.
  - API payload schemas (no table=True) are pure Pydantic validation models
    with no SA columns.  They never bleed database internals to the wire.
  - Column(Text) is used explicitly for large string fields so SQLite/PG
    don't silently truncate via VARCHAR.
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Text
from sqlmodel import Field, SQLModel


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ResearchStatus(str, Enum):
    """Lifecycle states for a ResearchProject.

    Kept as a str enum so the value is stored as a human-readable string in
    the database rather than an opaque integer — makes raw SQL queries sane.
    """

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


# ---------------------------------------------------------------------------
# Persisted table models
# ---------------------------------------------------------------------------


class ResearchProject(SQLModel, table=True):
    """
    One research job requested by a user.

    A project is created immediately when the request arrives (status=PENDING)
    so the client has a stable ID to poll before the background task starts.
    """

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
    )
    title: str = Field(index=True)
    query: str = Field(sa_column=Column(Text, nullable=False))
    # native_enum=False stores the value as VARCHAR instead of a PostgreSQL
    # native ENUM type.  Native ENUM causes a duplicate-type error on every
    # restart after the first because CREATE TYPE has no IF NOT EXISTS guard
    # in SQLAlchemy's DDL path.  VARCHAR works identically on SQLite and PG.
    status: ResearchStatus = Field(
        sa_column=Column(
            SAEnum(ResearchStatus, native_enum=False),
            default=ResearchStatus.PENDING,
            nullable=False,
            index=True,
        )
    )
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    # Nullable so we can distinguish "never touched" from "updated at epoch 0"
    updated_at: Optional[datetime] = Field(default=None, nullable=True)


class ResearchReport(SQLModel, table=True):
    """
    The synthesized markdown report produced by the agent pipeline.

    Stored separately from ResearchProject so the report blob (potentially
    tens of kilobytes) is never pulled along during project-list queries.
    """

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
    )
    project_id: str = Field(
        foreign_key="researchproject.id",
        index=True,
        nullable=False,
    )
    # Full markdown report from the SynthesizerAgent
    content: str = Field(sa_column=Column(Text, nullable=False))
    # JSON-serialized list[dict] of {title, url, snippet} objects collected
    # during the research session.  Stored as JSON text for schema simplicity;
    # move to a proper junction table if querying sources becomes a use case.
    sources_json: str = Field(default="[]", sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


# ---------------------------------------------------------------------------
# API payload schemas (no table=True — never persisted)
# ---------------------------------------------------------------------------


class ResearchStartRequest(SQLModel):
    """Inbound payload for POST /api/research/start."""

    title: str = Field(min_length=1, max_length=200)
    query: str = Field(min_length=5, max_length=2_000)
    max_results: int = Field(default=5, ge=1, le=20)


class ResearchStartResponse(SQLModel):
    """Immediate acknowledgement returned after a project is queued."""

    project_id: str
    status: ResearchStatus
    message: str


class ResearchStatusResponse(SQLModel):
    """Polling response for GET /api/research/status/{project_id}."""

    project_id: str
    title: str
    status: ResearchStatus
    created_at: datetime
    updated_at: Optional[datetime]


class ResearchReportResponse(SQLModel):
    """Full report payload returned once a project completes."""

    project_id: str
    report_id: str
    content: str  # Markdown
    sources: list[dict]  # Deserialized from sources_json
    created_at: datetime
