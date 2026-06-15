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

import logging
from typing import Optional

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.base import TaskResult
from autogen_agentchat.conditions import MaxMessageTermination, TextMentionTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_core import CancellationToken
from autogen_core.tools import FunctionTool
from autogen_ext.models.openai import OpenAIChatCompletionClient

from .config import settings
from .tools import extract_page_content, web_search

logger = logging.getLogger(__name__)

# Sentinel tokens — explicit contracts between agents and termination conditions.
_FINDINGS_SIGNAL = "FINDINGS_READY"
_APPROVED_SIGNAL = "RESEARCH_COMPLETE"


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

            "STEP 2 — DEEP EXTRACTION (call extract_page_content on 5-8 URLs)\n"
            "  Choose the most specific/authoritative hrefs from Step 1 results.\n"
            "  Call extract_page_content on each.\n"
            "  *** CRITICAL: if extract_page_content returns an error or empty content for "
            "a URL, do NOT discard that URL. Still add it to RAW FINDINGS using the 'body' "
            "snippet text from the web_search result as the key points. ***\n\n"

            "STEP 3 — COMPILE STRUCTURED FINDINGS using this EXACT format:\n\n"
            "  ## RAW FINDINGS\n"
            "  ### Source: [Exact Page Title](https://exact-href-url.com)\n"
            "  - Key fact, data point, or quote from this source\n"
            "  - Another fact (include numbers, dates, percentages)\n"
            "  (one Source block per URL — minimum 5 blocks)\n\n"
            "  ## KEY THEMES\n"
            "  - Theme 1: …\n\n"
            "  ## DATA POINTS\n"
            "  - Every number, %, date, or statistic found across all sources\n\n"
            "  ## KNOWLEDGE GAPS\n"
            "  - What the sources did not answer\n\n"

            "ABSOLUTE RULES:\n"
            "  1. Every Source block MUST have the real https?:// URL in the markdown link.\n"
            "     'Forbes IT Trends' with no URL is forbidden — use the actual href.\n"
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

            "STRICT RULES:\n"
            "  - Use ONLY the sources and data from the ResearcherAgent's findings.\n"
            "  - Every source in the Sources section MUST be a proper markdown link: "
            "    [Title](https://real-url.com). The URLs come from the researcher's RAW "
            "    FINDINGS blocks — copy them exactly as provided.\n"
            "  - If the researcher marked a source '(snippet only)', still cite it with "
            "    its URL — snippet-based citations are valid.\n"
            "  - NEVER say 'data limitations' or 'cannot include sources'. If the "
            "    researcher found even one real URL, you must cite it.\n"
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
            "If ALL criteria are met (including ≥3 real http URLs in Sources):\n"
            "  Write a one-sentence approval then on a new line: RESEARCH_COMPLETE\n\n"
            "If ANY criterion fails:\n"
            "  Start with: REVISION_NEEDED\n"
            "  Give a numbered list of specific, actionable fixes, e.g.:\n"
            "  1. Sources section has 0 real URLs. The research findings contain these "
            "     URLs: [list them]. Add them as markdown links.\n"
            "  2. Paragraph 3 of Executive Summary cites no source inline.\n\n"
            "Do NOT rewrite the report. Do NOT call any tools."
        ),
    )


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_research_orchestration(
    query: str,
    project_id: str,
    max_rounds: int = settings.max_research_rounds,
) -> str:
    """
    Run the full three-agent pipeline and return the final markdown report.

    Stateless: every call builds fresh agents and teams — safe for concurrent
    Celery workers with no locking or session leakage.

    Args:
        query:       The user's research question or topic.
        project_id:  Used for structured logging only — not mutated here.
        max_rounds:  Hard message cap for Phase 1 (research).  Phase 2 uses
                     a fixed 10-message cap (5 Synthesizer + 5 Critic turns).

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

    research_result: TaskResult = await research_team.run(
        task=research_task,
        cancellation_token=CancellationToken(),
    )

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

    # ── Phase 2: Synthesize + Critique loop ──────────────────────────────────

    synthesis_task = (
        "The ResearcherAgent has completed their investigation. "
        "Here are their full structured findings:\n\n"
        f"{findings}\n\n"
        "---\n"
        "SynthesizerAgent: Write the comprehensive research report using ONLY the real "
        "URLs and data from the findings above. Do not invent any sources or statistics.\n\n"
        "CriticAgent: After the Synthesizer produces the report, review it against all "
        "quality criteria per your system instructions and either approve it or return "
        "specific revision requests."
    )

    synthesis_team = RoundRobinGroupChat(
        participants=[synthesizer, critic],
        termination_condition=(
            TextMentionTermination(_APPROVED_SIGNAL) | MaxMessageTermination(10)
        ),
    )

    synthesis_result: TaskResult = await synthesis_team.run(
        task=synthesis_task,
        cancellation_token=CancellationToken(),
    )

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

    logger.info(
        "Report ready | project_id=%s | chars=%d",
        project_id, len(final_report),
    )
    return final_report
