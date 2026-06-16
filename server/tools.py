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
from urllib.parse import quote_plus

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
    max_results: int = 8,
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
            results = list(ddgs.text(query, region="us-en", max_results=max_results + 4))

        # Drop non-English pages by filtering out known CJK/non-English domains
        # and results whose titles contain CJK Unicode characters.
        _skip_domains = (
            "zhihu.com", "csdn.net", "cnblogs.com", "baidu.com",
            "163.com", "juejin.cn", "jianshu.com", "bilibili.com",
            "zhuanlan.zhihu.com", "weixin.qq.com", "qq.com",
            "naver.com", "blog.naver.com", "tistory.com",
            "qiita.com", "zenn.dev", "hatena.ne.jp",
        )

        def _is_english(r: dict) -> bool:
            href = r.get("href", "")
            title = r.get("title", "") or r.get("body", "")
            if any(d in href for d in _skip_domains):
                return False
            # Detect CJK block characters in the title
            if any("一" <= ch <= "鿿" or
                   "぀" <= ch <= "ヿ" or
                   "가" <= ch <= "힯" for ch in title):
                return False
            return True

        filtered = [r for r in results if _is_english(r)]
        return filtered[:max_results]

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


async def search_academic_papers(
    query: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """
    Search the Semantic Scholar Graph API for academic papers.

    Semantic Scholar is free and requires no API key for basic usage.
    Returns structured metadata: title, authors, year, journal/venue, DOI,
    arXiv ID, Semantic Scholar URL, and an open-access PDF URL where available.

    Args:
        query:  The search query (topic, keywords, or author+title).
        limit:  Max results to return (1-10, hard-capped at 10 by the API).

    Returns:
        List of paper dicts. Each has: title, authors (list), year, journal,
        venue, doi, arxiv_id, url, open_access_url, abstract (first 300 chars).
        Returns a single error-dict on failure so the agent can continue.
    """
    endpoint = "https://api.semanticscholar.org/graph/v1/paper/search"
    params = {
        "query": query,
        "limit": min(max(1, limit), 10),
        "fields": "title,authors,year,journal,venue,externalIds,url,openAccessPdf,abstract",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=6.0, read=20.0, write=5.0, pool=5.0),
            headers={"User-Agent": "Cybernetic-Research-Bot/1.0"},
        ) as client:
            resp = await client.get(endpoint, params=params)
            resp.raise_for_status()
            data = resp.json()

        papers: list[dict[str, Any]] = []
        for p in data.get("data", []):
            ext = p.get("externalIds") or {}
            jrn = p.get("journal") or {}
            oa  = p.get("openAccessPdf") or {}
            papers.append({
                "title":            p.get("title", ""),
                "authors":          [a.get("name", "") for a in (p.get("authors") or [])],
                "year":             p.get("year"),
                "journal":          jrn.get("name", ""),
                "journal_volume":   jrn.get("volume", ""),
                "journal_pages":    jrn.get("pages", ""),
                "venue":            p.get("venue", ""),
                "doi":              ext.get("DOI", ""),
                "arxiv_id":         ext.get("ArXiv", ""),
                "url":              p.get("url", ""),
                "open_access_url":  oa.get("url", ""),
                "abstract":         (p.get("abstract") or "")[:300],
            })

        logger.debug("search_academic_papers: %d results for query=%r", len(papers), query)
        return papers

    except Exception as exc:
        logger.error("search_academic_papers failed | query=%r | error=%s", query, exc)
        return [{"error": f"Academic search failed: {exc}", "query": query}]


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
                    "Cybernetic-Research-Bot/1.0 "
                    "(+https://github.com/your-org/cybernetic)"
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
