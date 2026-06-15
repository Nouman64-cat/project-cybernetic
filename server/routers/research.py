"""
Research API routes.

Route handlers are deliberately thin: validate → persist → dispatch → respond.
All pipeline logic lives in tasks.py (Celery) and orchestrator.py (AutoGen).
"""

import asyncio
import json
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ..config import settings
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


@router.get(
    "/stream/{project_id}",
    summary="SSE stream of live agent events",
    description=(
        "Server-Sent Events endpoint. Connects and forwards pipeline events "
        "(tool calls, agent messages, critic reviews) as they happen. "
        "Emits a 'complete' event when the pipeline finishes, then closes."
    ),
)
async def stream_research_events(project_id: str, request: Request) -> StreamingResponse:
    """
    Polls the Redis List written by the Celery worker and forwards each event
    as an SSE message.  Late-connecting clients receive the full history first,
    then live updates.  The connection closes on 'complete'/'error' events or
    after a 10-minute safety timeout.
    """
    redis_key = f"research_stream:{project_id}"

    async def generate():
        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        cursor = 0
        deadline = asyncio.get_event_loop().time() + 600  # 10-minute hard cap
        last_ping = asyncio.get_event_loop().time()

        try:
            while asyncio.get_event_loop().time() < deadline:
                if await request.is_disconnected():
                    break

                # Fetch any events added since last check
                events = await client.lrange(redis_key, cursor, -1)
                for raw in events:
                    yield f"data: {raw}\n\n"
                    cursor += 1
                    try:
                        if json.loads(raw).get("type") in ("complete", "error"):
                            return
                    except Exception:
                        pass

                # Heartbeat comment every 20 s to keep proxies from closing idle conn
                now = asyncio.get_event_loop().time()
                if now - last_ping >= 20:
                    yield ": ping\n\n"
                    last_ping = now

                await asyncio.sleep(0.35)
        finally:
            await client.aclose()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
            "Connection": "keep-alive",
        },
    )
