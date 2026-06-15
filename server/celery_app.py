"""
Celery application instance.

This module is the single source of truth for Celery configuration.
It is intentionally thin — no task imports live here to avoid circular
imports (tasks.py imports celery_app, not the other way around).

The instance is named so the CLI command is:
    celery -A server.celery_app worker ...
"""

from celery import Celery

from .config import settings

celery_app = Celery(
    "synapticgrip",
    broker=settings.redis_url,
    backend=settings.redis_url,
    # Explicit include so workers discover tasks without auto-discovery
    # scanning the entire package tree on startup.
    include=["server.tasks"],
)

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Reliability
    # acks_late=True: task is acknowledged only after it completes, so a
    # worker crash re-queues the task instead of silently dropping it.
    task_acks_late=True,
    # worker_prefetch_multiplier=1: don't pull more tasks than a worker can
    # handle concurrently — prevents long research tasks from starving others.
    worker_prefetch_multiplier=1,
    # Visibility timeout must exceed the longest expected task duration.
    # Set to 2 h to cover worst-case multi-round research sessions.
    broker_transport_options={"visibility_timeout": 7200},
    # Results
    result_expires=86400,  # 24 h — clean up stale results automatically
    # Time zone
    timezone="UTC",
    enable_utc=True,
)
