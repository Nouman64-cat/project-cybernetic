"""
Celery tasks for the research pipeline.

The execution logic that previously lived in routers/research.py as a FastAPI
BackgroundTask now lives here.  The swap at the call site is exactly one line:

    Before:  background_tasks.add_task(_run_research_task, project_id, query)
    After:   run_research_task.delay(project_id=project_id, query=query)

Async bridging
--------------
Celery workers use a synchronous execution model by default.  Our orchestration
layer (orchestrator.py) is fully async.  We bridge the two with asyncio.run(),
which creates a fresh event loop per task invocation.  This is safe when the
Celery pool is threaded (default) or prefork — each invocation is isolated.
For high-throughput workloads, replace with celery-pool-asyncio or gevent.
"""

import asyncio
import json
import logging
from datetime import datetime

from .celery_app import celery_app
from .database import get_session
from .models import ResearchProject, ResearchReport, ResearchStatus
from .orchestrator import run_research_orchestration
from .stream import StreamPublisher

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="server.tasks.run_research_task",
    max_retries=2,
    default_retry_delay=60,  # seconds between retries
    # acks_late is set globally in celery_app.py; listed here for clarity
)
def run_research_task(self, project_id: str, query: str) -> dict:
    """
    Celery entry point: runs the full research pipeline for one project.

    Delegates all async work to _async_execute() via asyncio.run().
    On failure, marks the project FAILED before retrying so the client
    does not observe a stuck IN_PROGRESS state during the retry delay.

    Returns a minimal result dict that Celery stores in Redis for
    optional result inspection (e.g., via Flower or celery.result.get()).
    """
    logger.info("Task started | project_id=%s | attempt=%d", project_id, self.request.retries + 1)
    try:
        asyncio.run(_async_execute(project_id, query))
        return {"status": "completed", "project_id": project_id}

    except Exception as exc:
        logger.error(
            "Task failed | project_id=%s | attempt=%d | error=%s",
            project_id, self.request.retries + 1, exc,
            exc_info=True,
        )
        _mark_failed(project_id)
        # self.retry() raises Celery's Retry exception — execution stops here
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Async implementation — separated so unit tests can await it directly
# ---------------------------------------------------------------------------


async def _async_execute(project_id: str, query: str) -> None:
    """Full pipeline: IN_PROGRESS → orchestrate → COMPLETED."""

    # --- Mark IN_PROGRESS ---
    with get_session() as session:
        project = session.get(ResearchProject, project_id)
        if project is None:
            logger.error("Task: project not found | project_id=%s", project_id)
            return
        project.status = ResearchStatus.IN_PROGRESS
        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()

    # --- Run multi-agent orchestration with real-time streaming ---
    async with StreamPublisher(project_id) as publisher:
        report_content = await run_research_orchestration(
            query=query,
            project_id=project_id,
            publisher=publisher,
        )

    # --- Persist report and mark COMPLETED ---
    with get_session() as session:
        report = ResearchReport(
            project_id=project_id,
            content=report_content,
            sources_json=json.dumps([]),
        )
        session.add(report)

        project = session.get(ResearchProject, project_id)
        if project:
            project.status = ResearchStatus.COMPLETED
            project.updated_at = datetime.utcnow()
            session.add(project)

        session.commit()

    logger.info("Task complete | project_id=%s | chars=%d", project_id, len(report_content))


def _mark_failed(project_id: str) -> None:
    """Synchronous status update used by the task error handler."""
    try:
        with get_session() as session:
            project = session.get(ResearchProject, project_id)
            if project:
                project.status = ResearchStatus.FAILED
                project.updated_at = datetime.utcnow()
                session.add(project)
                session.commit()
    except Exception as exc:
        logger.error("Could not mark project as FAILED | project_id=%s | %s", project_id, exc)
