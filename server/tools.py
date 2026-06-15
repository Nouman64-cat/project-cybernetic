"""
AutoGen-registered tool implementations.

Design principles enforced here:
  1. Every function is async — safe to await inside the agent event loop.
  2. All external I/O (network calls) is wrapped in tight try/except blocks.
     Failures return a structured error *string* rather than raising, because
     AutoGen propagates the tool return value back to the LLM as context.
     Raising inside a tool would crash the agent session entirely.
  3. DDGS is synchronous, so it is executed in the default ThreadPoolExecutor
     via run_in_executor to avoid blocking the asyncio event loop.
  4. Content truncation is applied before returning to prevent a single large
     page from consuming most of the model's context window.
"""

import asyncio
import logging
from typing import Any

import httpx
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS

from .config import settings

logger = logging.getLogger(__name__)

# HTML tags that add markup noise with no informational value
_NOISE_TAGS: tuple[str, ...] = (
    "script", "style", "nav", "footer", "header", "aside",
    "noscript", "iframe", "svg", "button", "form",
)


async def web_search(
    query: str,
    max_results: int = 5,
) -> list[dict[str, Any]]:
    """
    Search the web using DuckDuckGo and return structured results.

    DDGS.text() is a blocking generator, so we run it inside the default
    ThreadPoolExecutor via run_in_executor.  This keeps the asyncio event
    loop unblocked while the HTTP round-trip to DDG completes.

    Args:
        query:       The search query string.
        max_results: Upper bound on results returned (1–20).

    Returns:
        A list of dicts with keys ``title``, ``href``, ``body``.
        On failure returns a single-element list with an ``error`` key so the
        calling agent can report the failure without crashing the session.
    """

    def _blocking_search() -> list[dict[str, Any]]:
        with DDGS() as ddgs:
            return list(ddgs.text(query, max_results=max_results))

    try:
        loop = asyncio.get_event_loop()
        results: list[dict[str, Any]] = await loop.run_in_executor(
            None, _blocking_search
        )
        logger.debug("web_search: %d results for query=%r", len(results), query)
        return results

    except Exception as exc:
        logger.error("web_search failed | query=%r | error=%s", query, exc)
        return [{"error": f"Search failed: {exc}", "query": query, "href": "", "body": ""}]


async def extract_page_content(url: str) -> str:
    """
    Fetch a URL and return clean, truncated plain text.

    Processing pipeline:
      1. httpx async GET with a 15-second timeout and a bot-friendly UA header.
      2. BeautifulSoup strips script/style/nav/footer noise tags.
      3. Remaining text is joined, blank lines collapsed, then truncated to
         ``settings.content_truncation_chars`` characters.

    Args:
        url: Fully-qualified URL to fetch.

    Returns:
        Clean text string (truncated).  Returns a bracketed ``[ERROR]`` string
        on any failure so the LLM can note the failure and move on rather than
        the agent session crashing.
    """
    # --- HTTP fetch ---
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "SynapseGrip-Research-Bot/1.0 "
                    "(+https://github.com/your-org/synapse-grip)"
                )
            },
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

    except httpx.TimeoutException:
        return f"[ERROR] Request to {url!r} timed out."
    except httpx.HTTPStatusError as exc:
        return f"[ERROR] HTTP {exc.response.status_code} when fetching {url!r}."
    except httpx.RequestError as exc:
        return f"[ERROR] Network error fetching {url!r}: {exc}"

    # --- HTML parsing ---
    try:
        soup = BeautifulSoup(response.text, "lxml")

        # Remove noise nodes before get_text() to avoid residual whitespace blobs
        for tag in soup(_NOISE_TAGS):
            tag.decompose()

        raw_text = soup.get_text(separator="\n", strip=True)

        # Collapse runs of blank lines that inflate the character count
        lines = [line for line in raw_text.splitlines() if line.strip()]
        clean_text = "\n".join(lines)

        truncated = clean_text[: settings.content_truncation_chars]
        logger.debug(
            "extract_page_content: %d chars (truncated from %d) | url=%r",
            len(truncated), len(clean_text), url,
        )
        return truncated

    except Exception as exc:
        logger.error("extract_page_content: parse error | url=%r | error=%s", url, exc)
        return f"[ERROR] Failed to parse content from {url!r}: {exc}"
