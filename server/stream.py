"""
Real-time research event streaming via Redis List.

The Celery worker publishes pipeline events as the AutoGen agents run.
The FastAPI SSE endpoint polls the list and forwards events to browsers.

Using a Redis List (not pub/sub) means late-connecting clients automatically
receive the full history — no missed events if the browser tab opens after
the job starts.
"""

import json
import logging
from datetime import datetime, timezone

import redis.asyncio as aioredis

from .config import settings

logger = logging.getLogger(__name__)

_KEY_PREFIX = "research_stream:"
_TTL_SECONDS = 86_400  # 24 h — matches Celery result TTL


class StreamPublisher:
    """
    Async context manager that appends JSON events to a Redis List.

    Usage (inside an async function in the Celery worker):
        async with StreamPublisher(project_id) as pub:
            await pub.emit("search", 'Searching: "query"', "ResearcherAgent")
    """

    def __init__(self, project_id: str) -> None:
        self.project_id = project_id
        self._key = f"{_KEY_PREFIX}{project_id}"
        self._client: aioredis.Redis | None = None

    async def connect(self) -> None:
        self._client = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=5,
        )

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None

    async def emit(
        self,
        event_type: str,
        content: str,
        agent: str = "system",
    ) -> None:
        if self._client is None:
            return
        payload = json.dumps({
            "type": event_type,
            "agent": agent,
            "content": content,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        try:
            pipe = self._client.pipeline()
            pipe.rpush(self._key, payload)
            pipe.expire(self._key, _TTL_SECONDS)
            await pipe.execute()
        except Exception as exc:
            logger.warning("StreamPublisher.emit failed: %s", exc)

    async def __aenter__(self) -> "StreamPublisher":
        await self.connect()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()
