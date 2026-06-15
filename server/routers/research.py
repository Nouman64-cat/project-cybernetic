"""
Research API routes.

Route handlers are deliberately thin: validate → persist → dispatch → respond.
All pipeline logic lives in tasks.py (Celery) and orchestrator.py (AutoGen).
"""

import json
import logging

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from ..database import get_session
from ..models import (
    ResearchProject,
    ResearchReport,
    ResearchReportResponse,
    ResearchStartRequest,
    ResearchStartResponse,
    ResearchStatus,
    ResearchStatusResponse,
)
from ..tasks import run_research_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research", tags=["research"])


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get(
    "/",
    response_model=list[ResearchStatusResponse],
    summary="List all research projects",
)
async def list_research_projects() -> list[ResearchStatusResponse]:
    """Returns all projects ordered newest-first. Used by the dashboard on load."""
    with get_session() as session:
        projects = session.exec(
            select(ResearchProject).order_by(ResearchProject.created_at.desc())
        ).all()

    return [
        ResearchStatusResponse(
            project_id=p.id,
            title=p.title,
            status=p.status,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in projects
    ]


@router.post(
    "/start",
    response_model=ResearchStartResponse,
    status_code=202,
    summary="Enqueue a research task",
    description=(
        "Persists a ResearchProject, dispatches the Celery task, and returns "
        "202 Accepted immediately. Poll /api/research/status/{project_id} for completion."
    ),
)
async def start_research(request: ResearchStartRequest) -> ResearchStartResponse:
    """
    Accepts and enqueues a research job via Celery.

    Returns 202 so the client knows the report is not ready yet and must poll.
    The Celery worker (separate process/container) picks up the task from Redis
    and drives it to completion independently of this API process.
    """
    with get_session() as session:
        project = ResearchProject(
            title=request.title,
            query=request.query,
        )
        session.add(project)
        session.commit()
        session.refresh(project)
        project_id = project.id

    # .delay() serialises args to JSON and pushes to the Redis broker queue.
    # The worker container consumes and executes it asynchronously.
    run_research_task.apply_async(
        kwargs={"project_id": project_id, "query": request.query},
        queue="research",
    )

    logger.info("Research queued | project_id=%s | title=%r", project_id, request.title)

    return ResearchStartResponse(
        project_id=project_id,
        status=ResearchStatus.PENDING,
        message=(
            f"Research task accepted and queued. "
            f"Poll /api/research/status/{project_id} for updates."
        ),
    )


@router.get(
    "/status/{project_id}",
    response_model=ResearchStatusResponse,
    summary="Poll project status",
)
async def get_research_status(project_id: str) -> ResearchStatusResponse:
    """Returns the current lifecycle status of a research project."""
    with get_session() as session:
        project = session.get(ResearchProject, project_id)

    if project is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project {project_id!r} not found.",
        )

    return ResearchStatusResponse(
        project_id=project.id,
        title=project.title,
        status=project.status,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get(
    "/report/{project_id}",
    response_model=ResearchReportResponse,
    summary="Retrieve completed report",
)
async def get_research_report(project_id: str) -> ResearchReportResponse:
    """
    Returns the synthesized markdown report for a completed project.

    Returns 404 if the project does not exist, 409 if it exists but has not
    yet completed (the client should poll /status first).
    """
    with get_session() as session:
        project = session.get(ResearchProject, project_id)
        if project is None:
            raise HTTPException(
                status_code=404,
                detail=f"Project {project_id!r} not found.",
            )

        if project.status != ResearchStatus.COMPLETED:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Report not ready. "
                    f"Project status is '{project.status.value}'. "
                    "Poll /api/research/status/{project_id} until status is 'completed'."
                ),
            )

        report = session.exec(
            select(ResearchReport).where(ResearchReport.project_id == project_id)
        ).first()

    if report is None:
        # Should not happen if the background task ran correctly; log as error.
        logger.error("Completed project has no report | project_id=%s", project_id)
        raise HTTPException(
            status_code=500,
            detail="Project is marked completed but no report record was found.",
        )

    return ResearchReportResponse(
        project_id=project_id,
        report_id=report.id,
        content=report.content,
        sources=json.loads(report.sources_json),
        created_at=report.created_at,
    )
