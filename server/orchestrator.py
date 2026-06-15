"""
Multi-agent research orchestration — three-agent, two-phase pipeline.

PHASE 1 — RESEARCH
  ResearcherAgent runs solo inside its own RoundRobinGroupChat, calling
  web_search and extract_page_content until it has covered every angle of
  the topic and emits FINDINGS_READY.  Running it alone prevents the
  Synthesizer from interrupting before the evidence base is complete.

PHASE 2 — SYNTHESIS + CRITIQUE LOOP
  SynthesizerAgent receives the researcher's compiled findings and writes
  the full report.  CriticAgent reviews it against strict quality criteria
  (real URLs, specific data, all sections present, claims grounded in
  findings).  If the Critic finds issues it returns REVISION_NEEDED with a
  numbered list of specific fixes.  The Synthesizer revises and resubmits.
  This continues until the Critic is satisfied and emits RESEARCH_COMPLETE,
  or until the message cap is reached (safety net).

WHY TWO SEPARATE TEAMS?
  A single 3-agent RoundRobin (Researcher → Synthesizer → Critic → …) would
  call the Researcher on every third turn even during the critique loop,
  wasting tokens on searches that add no value.  Splitting into two teams
  gives each phase its own termination contract and agent roster.

STATELESS FACTORY
  run_research_orchestration() creates fresh clients, tools, agents, and
  teams on every call — no shared mutable state across concurrent invocations.
"""

import json
import logging
import re
from typing import TYPE_CHECKING, Any, Optional

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.base import TaskResult
from autogen_agentchat.conditions import MaxMessageTermination, TextMentionTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_core import CancellationToken
from autogen_core.tools import FunctionTool
from autogen_ext.models.openai import OpenAIChatCompletionClient

from .config import settings
from .tools import extract_page_content, web_search

if TYPE_CHECKING:
    from .stream import StreamPublisher

logger = logging.getLogger(__name__)

# Sentinel tokens — explicit contracts between agents and termination conditions.
_FINDINGS_SIGNAL = "FINDINGS_READY"
_APPROVED_SIGNAL = "RESEARCH_COMPLETE"
_REVISION_SIGNAL = "REVISION_NEEDED"


# ---------------------------------------------------------------------------
# Private builder helpers
# ---------------------------------------------------------------------------


def _build_model_client() -> OpenAIChatCompletionClient:
    return OpenAIChatCompletionClient(
        model=settings.openai_model,
        api_key=settings.openai_api_key,
    )


def _build_tools() -> list[FunctionTool]:
    return [
        FunctionTool(
            func=web_search,
            name="web_search",
            description=(
                "Search the public web using DuckDuckGo. "
                "Returns a list of results with keys: title, href, body. "
                "The 'href' field is the real URL — always record it. "
                "Use multiple searches with different query terms to cover all angles."
            ),
        ),
        FunctionTool(
            func=extract_page_content,
            name="extract_page_content",
            description=(
                "Fetch a URL and extract its clean text content. "
                "Call this on the most relevant URLs from web_search results "
                "to get the full article text with real data and quotes. "
                "Returns truncated plain text."
            ),
        ),
    ]


def _build_researcher_agent(
    model_client: OpenAIChatCompletionClient,
    tools: list[FunctionTool],
) -> AssistantAgent:
    return AssistantAgent(
        name="ResearcherAgent",
        model_client=model_client,
        tools=tools,
        system_message=(
            "You are a meticulous investigative research analyst. Your mission is to build "
            "a rich, URL-anchored body of evidence on the given topic.\n\n"

            "MANDATORY WORKFLOW — execute every step in order:\n\n"

            "STEP 1 — BROAD SEARCH (issue 3-5 web_search calls with DIFFERENT queries)\n"
            "  Cover distinct angles, e.g. for 'AI chip supply chain':\n"
            "    • 'AI chip supply chain bottlenecks 2024'\n"
            "    • 'NVIDIA TSMC supply shortage response 2024'\n"
            "    • 'semiconductor shortage geopolitics 2025'\n"
            "  For EVERY result, copy the exact 'href' value — that is a real URL you must keep.\n\n"

            "STEP 1.5 — ENTITY DEEP-DIVE (2-3 targeted searches on specific named entities)\n"
            "  After Step 1, scan your results for specific named entities:\n"
            "  companies (e.g. NVIDIA, Intel, TSMC), projects (e.g. Llama 3, WebAssembly WASI),\n"
            "  tools/runtimes, products, standards bodies, or key organizations.\n"
            "  Run 2-3 additional web_search calls focused on those specific names, e.g.:\n"
            "    • 'NVIDIA H100 production volume yield rate 2024 statistics'\n"
            "    • 'TSMC 3nm CoWoS-L advanced packaging capacity numbers'\n"
            "  This ensures the Synthesizer has concrete entity-level data, not just themes.\n\n"

            "STEP 2 — DEEP EXTRACTION (call extract_page_content on 5-8 URLs)\n"
            "  Choose the most specific/authoritative hrefs from Step 1 results.\n"
            "  Call extract_page_content on each.\n"
            "  *** CRITICAL: if extract_page_content returns an error or empty content for "
            "a URL, do NOT discard that URL. Still add it to RAW FINDINGS using the 'body' "
            "snippet text from the web_search result as the key points. ***\n\n"

            "STEP 3 — COMPILE STRUCTURED FINDINGS using this EXACT format:\n\n"
            "  ## RAW FINDINGS\n\n"
            "  ### Source: [Exact Page Title](https://exact-href-url.com)\n"
            "  URL: https://exact-href-url.com\n"
            "  - Key fact, data point, or quote from this source\n"
            "  - Another fact (include numbers, dates, percentages)\n"
            "  (one Source block per URL — MINIMUM 5 blocks)\n\n"
            "  CRITICAL URL FORMATTING RULES:\n"
            "  ✓ CORRECT:  ### Source: [Page Title](https://full-url.com/path)\n"
            "  ✗ WRONG:    ### Source: Page Title  ← NO URL attached!\n"
            "  ✗ WRONG:    ### Source: Page Title (https://url.com)  ← not markdown!\n"
            "  Every source header must use [brackets](parentheses) markdown link syntax.\n"
            "  Also write the URL on its own line 'URL: https://...' as backup.\n\n"
            "  ## KEY THEMES\n"
            "  - Theme 1: …\n\n"
            "  ## DATA POINTS\n"
            "  - Every number, %, date, or statistic found across all sources\n\n"
            "  ## NAMED ENTITIES FOUND\n"
            "  - List every company, project, tool, org, or standard mentioned\n\n"
            "  ## KNOWLEDGE GAPS\n"
            "  - What the sources did not answer\n\n"

            "ABSOLUTE RULES:\n"
            "  1. Every Source block MUST use the real href as a markdown link AND on its\n"
            "     own 'URL: https://...' line. Both formats required for redundancy.\n"
            "  2. Never invent data, quotes, or URLs. Only what your tools returned.\n"
            "  3. Even search-snippet-only sources are valid — just note '(snippet only)'.\n"
            "  4. Compile findings once — do not keep looping searches forever.\n\n"

            f"End your compiled findings message with the exact token: {_FINDINGS_SIGNAL}"
        ),
    )


def _build_synthesizer_agent(
    model_client: OpenAIChatCompletionClient,
) -> AssistantAgent:
    return AssistantAgent(
        name="SynthesizerAgent",
        model_client=model_client,
        tools=[],
        system_message=(
            "You are a senior analyst and technical writer. You receive structured research "
            "findings from the ResearcherAgent and produce a polished, in-depth markdown report. "
            "The CriticAgent will review your output and may ask for revisions — address every "
            "point they raise before resubmitting.\n\n"

            "REQUIRED REPORT STRUCTURE:\n"
            "```\n"
            "# [Descriptive, specific report title]\n\n"
            "## Executive Summary\n"
            "3-4 paragraphs synthesising the topic, major findings, and conclusions. "
            "Reference specific data points from the research.\n\n"
            "## Key Findings\n"
            "Bulleted list — each bullet must state a specific, sourced fact. "
            "Include the inline citation: fact ([Source Title](url)).\n\n"
            "## Detailed Analysis\n"
            "Substantive prose with sub-headings for each major theme. "
            "Analyse, compare, and interpret — don't just repeat bullet points. "
            "Every claim must trace to a source from the research findings.\n\n"
            "## Conflicting Information & Knowledge Gaps\n"
            "Flag contradictions between sources, uncertain claims, and open questions.\n\n"
            "## Sources\n"
            "Numbered list of all cited sources as proper markdown links:\n"
            "1. [Real Page Title](https://real-url.com)\n"
            "```\n\n"

            "MINIMUM DEPTH REQUIREMENTS (non-negotiable — Critic will reject anything below these):\n"
            "  • Total word count: minimum 2,000 words (aim for 2,500+)\n"
            "  • Named entities: ≥ 8 specific named companies, projects, tools, or organizations\n"
            "    mentioned by name with specific facts attached to each\n"
            "  • Executive Summary: minimum 4 full paragraphs covering scope, key findings,\n"
            "    technical implications, and conclusions\n"
            "  • Detailed Analysis: minimum 4 sub-headings (###), each with ≥ 2 full paragraphs\n"
            "  • Key Findings: minimum 8 bullets, each with a specific fact + inline citation\n"
            "  A short or sparse report WILL be rejected. Write comprehensively.\n\n"

            "STRICT RULES:\n"
            "  - Use ONLY the sources and data from the ResearcherAgent's findings.\n"
            "  - Every source in the Sources section MUST be a proper markdown link.\n"
            "    CORRECT:   `1. [Page Title](https://example.com/article)`\n"
            "    WRONG:     `1. Page Title`  ← missing URL, always rejected by Critic\n"
            "    The task message contains an 'EXTRACTED SOURCE URLs' block with every "
            "    real URL the researcher found — copy them verbatim into your Sources.\n"
            "  - Inline citations in the body use the same format: "
            "    `([Page Title](https://example.com/article))`\n"
            "  - NEVER say 'data limitations' or 'cannot include sources'. You have real "
            "    URLs in the task message — use them.\n"
            "  - Include specific numbers, dates, and quotes from the findings.\n"
            "  - Write for a sophisticated technical audience — precise, no filler.\n"
            "  - Do NOT call any tools.\n"
            "  - When the CriticAgent returns REVISION_NEEDED, address EVERY numbered "
            "    point explicitly in your revision. Do not skip any.\n\n"

            "Your final approved message does NOT need any special token — "
            "the CriticAgent will emit RESEARCH_COMPLETE when satisfied."
        ),
    )


def _build_critic_agent(
    model_client: OpenAIChatCompletionClient,
) -> AssistantAgent:
    return AssistantAgent(
        name="CriticAgent",
        model_client=model_client,
        tools=[],
        system_message=(
            "You are a rigorous research quality auditor. Your role is to review research "
            "reports written by the SynthesizerAgent and enforce strict quality standards "
            "before the report is published. You do NOT rewrite the report — you give "
            "specific, numbered feedback for the Synthesizer to act on.\n\n"

            "REVIEW CHECKLIST — evaluate every item strictly:\n\n"

            "★ ZERO-TOLERANCE RULE (check this first):\n"
            "   Count the markdown links in the Sources section that start with http.\n"
            "   If the count is ZERO — return REVISION_NEEDED immediately, no exceptions.\n"
            "   If the Sources section says anything like 'cannot include citations' or "
            "   'data limitations' — return REVISION_NEEDED immediately.\n"
            "   The ResearcherAgent always finds real URLs via web_search; the Synthesizer "
            "   has them in the provided findings and must use them.\n\n"

            "QUANTITATIVE GATES (check in order — fail on the first gate that is not met):\n\n"

            "  GATE A — REPORT DEPTH (visual check, not word count)\n"
            "   Count the number of paragraphs in the Executive Summary.\n"
            "   Count the number of ### sub-headings in the Detailed Analysis.\n"
            "   Count the number of bullets in Key Findings.\n"
            "   If Executive Summary has fewer than 3 paragraphs → REVISION_NEEDED.\n"
            "   If Detailed Analysis has fewer than 3 ### sub-headings → REVISION_NEEDED.\n"
            "   If Key Findings has fewer than 6 bullets → REVISION_NEEDED.\n"
            "   State exactly what is missing, e.g. '1. Executive Summary has 2 paragraphs "
            "(need ≥ 3). Detailed Analysis has 2 sub-headings (need ≥ 3).'\n\n"

            "  GATE B — NAMED ENTITIES\n"
            "   Count distinct named companies, projects, tools, standards, or organizations "
            "   mentioned by name (e.g. NVIDIA, PyTorch, WASI, W3C, Bytecode Alliance).\n"
            "   If fewer than 5 distinct named entities → REVISION_NEEDED.\n"
            "   State: 'Only X named entities found. Add specific company/project/tool names "
            "with concrete facts about each.'\n\n"

            "  GATE C — SECTION DEPTH\n"
            "   Check: Executive Summary has ≥ 3 paragraphs; Detailed Analysis has ≥ 3 "
            "   sub-headings (### lines); each sub-section has ≥ 2 paragraphs.\n"
            "   If any of these fail → REVISION_NEEDED with specific section name.\n\n"

            "1. REAL CITATIONS (minimum 3)\n"
            "   Every Sources entry must be [Title](https://...). Count real http URLs.\n"
            "   If fewer than 3, that is grounds for REVISION_NEEDED.\n\n"

            "2. INLINE CITATIONS\n"
            "   Claims in the body must have ([Source Title](url)) citations inline.\n"
            "   Unsourced assertions throughout the body → REVISION_NEEDED.\n\n"

            "3. DATA DEPTH\n"
            "   Must contain specific facts: numbers, percentages, dates, quotes.\n"
            "   Vague qualitative-only claims → REVISION_NEEDED.\n\n"

            "4. SECTION COMPLETENESS\n"
            "   All five sections present and substantive: Executive Summary (3+ paragraphs), "
            "   Key Findings (5+ bullets with citations), Detailed Analysis (multi-section "
            "   with real content), Conflicting Info & Gaps, Sources.\n\n"

            "5. ANALYSIS QUALITY\n"
            "   Detailed Analysis must interpret and synthesise — not repeat Key Findings.\n\n"

            "RESPONSE FORMAT:\n\n"
            "If ALL gates and criteria are met:\n"
            "  Write a one-sentence approval then on a new line: RESEARCH_COMPLETE\n\n"
            "If ANY gate or criterion fails:\n"
            "  Start with: REVISION_NEEDED\n"
            "  Give a numbered list of specific, actionable fixes, e.g.:\n"
            "  1. Report is ~850 words — must reach ≥ 2,000. Expand all sections.\n"
            "  2. Sources section has 0 real URLs. Add them as markdown links.\n"
            "  3. Detailed Analysis has only 1 sub-section — needs ≥ 3.\n\n"
            "Do NOT rewrite the report. Do NOT call any tools."
        ),
    )


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


async def _stream_message(message: Any, publisher: "StreamPublisher") -> None:
    """
    Translates a single AutoGen message into a human-readable stream event.

    Uses class-name checks instead of isinstance so we don't need to import
    every autogen message type (version-proof approach).
    """
    msg_class = type(message).__name__
    source: str = getattr(message, "source", "")
    content: Any = getattr(message, "content", None)

    # ── Tool call requests (Researcher calling web_search / extract_page_content)
    if "ToolCallRequestEvent" in msg_class and isinstance(content, list):
        for call in content:
            name: str = getattr(call, "name", "")
            args_raw: Any = getattr(call, "arguments", "{}")
            try:
                args: dict = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            except Exception:
                args = {}

            if name == "web_search":
                q = args.get("query", "")
                await publisher.emit("search", f'Searching: "{q}"', source)
            elif name == "extract_page_content":
                url: str = args.get("url", "")
                short = (url[:72] + "…") if len(url) > 72 else url
                await publisher.emit("extract", f"Reading: {short}", source)
        return

    # ── Text messages from agents
    if msg_class != "TextMessage" or not isinstance(content, str) or not content.strip():
        return

    if source == "ResearcherAgent":
        # Only emit a summary when the researcher wraps up — not the full findings wall.
        if _FINDINGS_SIGNAL in content:
            url_count = len(re.findall(r"https?://", content))
            await publisher.emit(
                "phase_end",
                f"Research compiled — {url_count} source{'s' if url_count != 1 else ''} captured",
                source,
            )

    elif source == "SynthesizerAgent":
        word_count = len(content.split())
        if word_count > 40:
            await publisher.emit("writing", f"Writing report… ({word_count} words)", source)

    elif source == "CriticAgent":
        if _REVISION_SIGNAL in content:
            # Surface the first numbered issue so the user sees what changed
            lines = [
                ln.strip()
                for ln in content.splitlines()
                if ln.strip() and ln.strip() != _REVISION_SIGNAL and len(ln.strip()) > 8
            ]
            first_issue = lines[0][:120] if lines else "Quality issues found"
            await publisher.emit("revision", first_issue, source)
        elif _APPROVED_SIGNAL in content:
            await publisher.emit("approved", "Report approved ✓", source)


def _extract_last_agent_text(result: TaskResult, agent_name: str) -> Optional[str]:
    """Return the last non-empty text message from the named agent."""
    for message in reversed(result.messages):
        if (
            getattr(message, "source", None) == agent_name
            and isinstance(getattr(message, "content", None), str)
            and message.content.strip()
        ):
            return message.content.strip()
    return None


def _build_url_manifest(findings: str) -> str:
    """
    Extract every URL from the researcher's findings and format them as an
    explicit numbered list for the Synthesizer.

    Captures both markdown-linked URLs [Title](url) AND bare https:// URLs that
    the researcher may have written outside markdown syntax.  De-duplicated and
    capped at 15 entries.
    """
    pairs: list[tuple[str, str]] = re.findall(
        r'\[([^\]]{1,120})\]\((https?://[^\)\s]{10,})\)', findings
    )
    seen: set[str] = {url for _, url in pairs}

    # Also grab bare https:// URLs the researcher wrote outside of markdown links
    for url in re.findall(r'(?<!\()(https?://[^\s\)\]>",]{10,})', findings):
        url = url.rstrip('.,;:')
        if url not in seen:
            # Derive a short label from the domain + first path segment
            label = re.sub(r'^https?://(www\.)?', '', url).split('/')[0]
            pairs.append((label, url))
            seen.add(url)

    if not pairs:
        return ""

    lines = [f"{i}. [{title}]({url})" for i, (title, url) in enumerate(pairs[:15], 1)]
    return (
        "\n\nEXTRACTED SOURCE URLs (copy these exactly into your Sources section):\n"
        + "\n".join(lines)
        + "\n"
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_research_orchestration(
    query: str,
    project_id: str,
    max_rounds: int = settings.max_research_rounds,
    publisher: Optional["StreamPublisher"] = None,
) -> str:
    """
    Run the full three-agent pipeline and return the final markdown report.

    Stateless: every call builds fresh agents and teams — safe for concurrent
    Celery workers with no locking or session leakage.

    Args:
        query:       The user's research question or topic.
        project_id:  Used for structured logging only — not mutated here.
        max_rounds:  Hard message cap for Phase 1 (research).  Phase 2 uses
                     a fixed 16-message cap (up to 8 Synthesizer + 8 Critic turns).

    Returns:
        The final synthesized and critic-approved markdown report.

    Raises:
        RuntimeError: When a phase ends without producing the expected output.
    """
    logger.info(
        "Orchestration start | project_id=%s | model=%s | max_rounds=%d | query=%r",
        project_id, settings.openai_model, max_rounds, query,
    )

    model_client = _build_model_client()
    tools = _build_tools()

    researcher = _build_researcher_agent(model_client, tools)
    synthesizer = _build_synthesizer_agent(model_client)
    critic = _build_critic_agent(model_client)

    # ── Phase 1: Research ────────────────────────────────────────────────────

    research_task = (
        f"Conduct thorough, multi-angle research on the following topic:\n\n"
        f"RESEARCH TOPIC: {query}\n\n"
        "Use multiple distinct search queries, extract content from at least 5 real URLs, "
        "and compile your findings in the required structured format defined in your "
        "system instructions. Signal completion when your findings are ready."
    )

    research_team = RoundRobinGroupChat(
        participants=[researcher],
        termination_condition=(
            TextMentionTermination(_FINDINGS_SIGNAL) | MaxMessageTermination(max_rounds)
        ),
    )

    if publisher:
        await publisher.emit("phase", "Phase 1 — Gathering evidence", "system")

    research_result: Optional[TaskResult] = None
    async for msg in research_team.run_stream(
        task=research_task,
        cancellation_token=CancellationToken(),
    ):
        if isinstance(msg, TaskResult):
            research_result = msg
        elif publisher:
            await _stream_message(msg, publisher)

    if research_result is None:
        raise RuntimeError(f"Phase 1 produced no TaskResult | project_id={project_id!r}")

    logger.info(
        "Phase 1 complete | project_id=%s | messages=%d | stop=%r",
        project_id, len(research_result.messages), research_result.stop_reason,
    )

    findings = _extract_last_agent_text(research_result, "ResearcherAgent")
    if not findings:
        raise RuntimeError(
            f"ResearcherAgent produced no findings | project_id={project_id!r} | "
            f"stop_reason={research_result.stop_reason!r}"
        )

    # Pre-extract real URLs so the Synthesizer gets them served up explicitly.
    # Without this, the Synthesizer consistently drops the href when writing
    # the Sources section — it copies the title but not the link.
    url_manifest = _build_url_manifest(findings)
    url_count = len(re.findall(r'\[.+?\]\(https?://[^\)]+\)', findings))
    findings_words = len(findings.split())
    logger.info(
        "Phase 1 URL count | project_id=%s | real_urls_found=%d | findings_words=%d",
        project_id, url_count, findings_words,
    )

    # ── Phase 2: Synthesize + Critique loop ──────────────────────────────────

    synthesis_task = (
        "The ResearcherAgent has completed their investigation. "
        "Here are their full structured findings:\n\n"
        f"{findings}"
        f"{url_manifest}\n"
        "---\n"
        f"The researcher compiled approximately {findings_words} words of evidence "
        f"across {url_count} sources. Your final report MUST be at least 2,000 words "
        "(aim for 2,500+). A 600-word summary is NOT acceptable — that is a failure.\n\n"
        "Word budget guide:\n"
        "  • Executive Summary alone: 400–500 words (4 full paragraphs)\n"
        "  • Detailed Analysis: 1,000–1,200 words across 4+ sub-sections (### headings)\n"
        "    Each sub-section needs at least 2 full paragraphs of real analysis\n"
        "  • Key Findings: 8–10 bullets, each with a specific fact + inline citation\n\n"
        "SynthesizerAgent: Write the comprehensive research report using ONLY the real "
        "URLs and data from the findings above. The 'EXTRACTED SOURCE URLs' block above "
        "lists every real URL the researcher found — copy them exactly into your Sources "
        "section as numbered markdown links: `1. [Title](https://url)`.\n\n"
        "CriticAgent: After the Synthesizer produces the report, review it against all "
        "quality criteria per your system instructions and either approve it or return "
        "specific revision requests."
    )

    synthesis_team = RoundRobinGroupChat(
        participants=[synthesizer, critic],
        termination_condition=(
            TextMentionTermination(_APPROVED_SIGNAL) | MaxMessageTermination(16)
        ),
    )

    if publisher:
        await publisher.emit("phase", "Phase 2 — Writing & Review", "system")

    synthesis_result: Optional[TaskResult] = None
    async for msg in synthesis_team.run_stream(
        task=synthesis_task,
        cancellation_token=CancellationToken(),
    ):
        if isinstance(msg, TaskResult):
            synthesis_result = msg
        elif publisher:
            await _stream_message(msg, publisher)

    if synthesis_result is None:
        raise RuntimeError(f"Phase 2 produced no TaskResult | project_id={project_id!r}")

    logger.info(
        "Phase 2 complete | project_id=%s | messages=%d | stop=%r",
        project_id, len(synthesis_result.messages), synthesis_result.stop_reason,
    )

    # The final report is the last substantive SynthesizerAgent message.
    # When the Critic approves, it emits RESEARCH_COMPLETE — the Synthesizer's
    # preceding message is the clean, approved report.
    final_report = _extract_last_agent_text(synthesis_result, "SynthesizerAgent")
    if not final_report:
        raise RuntimeError(
            f"SynthesizerAgent produced no report | project_id={project_id!r} | "
            f"stop_reason={synthesis_result.stop_reason!r}"
        )

    # Strip any stray sentinel tokens before storing
    final_report = final_report.replace(_APPROVED_SIGNAL, "").strip()

    # ── Programmatic length gate ─────────────────────────────────────────────
    # LLMs cannot reliably count words, so we enforce minimum length in code.
    # If the report is under 1,500 words, run one targeted expansion pass.
    report_word_count = len(final_report.split())
    logger.info(
        "Phase 2 word count | project_id=%s | words=%d",
        project_id, report_word_count,
    )

    if report_word_count < 1500:
        logger.warning(
            "Report too short — forcing expansion | project_id=%s | words=%d",
            project_id, report_word_count,
        )
        if publisher:
            await publisher.emit(
                "revision",
                f"Report is {report_word_count} words — expanding to 2,500+ (automatic)",
                "system",
            )

        # Run a FRESH Synthesizer SOLO (no Critic) for the expansion pass.
        # A Synthesizer+Critic loop causes a shortening spiral — Critic demands
        # make the Synthesizer trim rather than expand on each revision.
        # MaxMessageTermination(2) = task(1) + one Synthesizer response(1); avoids
        # the second shorter follow-up message that MaxMessageTermination(3) triggers.
        # Fresh agent avoids AutoGen runtime state leakage from Phase 2.
        expansion_task = (
            f"Your previous report was only {report_word_count} words — this is not enough.\n"
            "Write a new, full-length version at 2,500+ words from the researcher's findings below.\n\n"
            "WORD BUDGET — write AT LEAST this much per section:\n"
            "  ## Executive Summary          500+ words   (4+ full paragraphs)\n"
            "  ## Key Findings               300+ words   (10+ bullets with inline citations)\n"
            "  ## Detailed Analysis        1,200+ words   (5+ ### sub-sections, 2+ paragraphs each)\n"
            "  ## Conflicting Info & Gaps    200+ words   (2+ paragraphs)\n"
            "  ## Sources                    numbered list of all cited sources as markdown links\n\n"
            "Do NOT copy the short draft — write fresh, elaborate prose for every section.\n"
            "Name specific companies, projects, tools, and organizations throughout.\n"
            "Every factual claim needs an inline citation ([Source Title](url)).\n\n"
            "RESEARCHER'S FULL FINDINGS:\n\n"
            f"{findings}"
            f"{url_manifest}\n"
        )

        fresh_synthesizer = _build_synthesizer_agent(model_client)
        expansion_team = RoundRobinGroupChat(
            participants=[fresh_synthesizer],
            termination_condition=MaxMessageTermination(2),
        )

        expansion_result: Optional[TaskResult] = None
        async for msg in expansion_team.run_stream(
            task=expansion_task,
            cancellation_token=CancellationToken(),
        ):
            if isinstance(msg, TaskResult):
                expansion_result = msg
            elif publisher:
                await _stream_message(msg, publisher)

        if expansion_result is not None:
            expanded = _extract_last_agent_text(expansion_result, fresh_synthesizer.name)
            if expanded:
                expanded = expanded.replace(_APPROVED_SIGNAL, "").strip()
                expanded_wc = len(expanded.split())
                logger.info(
                    "Expansion complete | project_id=%s | words=%d → %d",
                    project_id, report_word_count, expanded_wc,
                )
                if expanded_wc > report_word_count:
                    final_report = expanded

    if publisher:
        await publisher.emit("complete", "Research complete", "system")

    logger.info(
        "Report ready | project_id=%s | chars=%d",
        project_id, len(final_report),
    )
    return final_report
