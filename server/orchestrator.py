"""
Multi-agent research orchestration layer.

Architecture decisions captured here:

  STATELESS FACTORY PATTERN
  -------------------------
  run_research_orchestration() creates fresh agent and team instances on every
  call.  There is no shared mutable state between invocations.  This makes the
  function safe to call concurrently from multiple asyncio tasks (FastAPI
  background tasks) and trivially parallelisable across Celery workers later —
  no locking, no session leakage.

  TWO-AGENT PIPELINE
  ------------------
  ResearcherAgent  — has tools (web_search, extract_page_content).  Gathers
                     raw facts from the web and compiles cited findings.
  SynthesizerAgent — no tools.  Receives the researcher's compiled findings
                     and produces the polished markdown report.

  Separating these roles prevents a single agent from conflating tool-calling
  steps with the writing step, which degrades report quality.  The Synthesizer
  is also cheaper to run (no tool overhead) and can be pointed at a smaller /
  faster model if cost becomes a concern.

  TERMINATION STRATEGY
  --------------------
  Primary:  TextMentionTermination on a sentinel token the Synthesizer must
            emit at the end of its final message.  This is an explicit contract
            — not relying on model judgement alone.
  Fallback: MaxMessageTermination as a hard cap to prevent runaway loops when
            the model fails to produce the sentinel.

  TEAM ORDERING
  -------------
  RoundRobinGroupChat guarantees Researcher → Synthesizer → Researcher → …
  This prevents the Synthesizer (which has no tools) from being asked to call
  tools, and ensures the Researcher always hands off findings before the
  Synthesizer writes the final report.
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

# The Synthesizer must include this exact token at the end of its final message.
# The TextMentionTermination condition detects it and halts the loop cleanly.
_TERMINATION_SIGNAL = "RESEARCH_COMPLETE"


# ---------------------------------------------------------------------------
# Private builder helpers — each returns a self-contained, reusable object
# ---------------------------------------------------------------------------


def _build_model_client() -> OpenAIChatCompletionClient:
    """
    Constructs the shared OpenAI client.

    Isolated here so swapping providers (Anthropic, Azure, local Ollama) only
    touches this one function rather than every agent constructor.
    """
    return OpenAIChatCompletionClient(
        model=settings.openai_model,
        api_key=settings.openai_api_key,
    )


def _build_tools() -> list[FunctionTool]:
    """
    Wraps async tool callables as AutoGen FunctionTool instances.

    Providing explicit ``description`` strings here rather than relying on
    docstrings improves tool-selection accuracy because the descriptions are
    formatted specifically for the model's tool-choice prompt.
    """
    return [
        FunctionTool(
            func=web_search,
            name="web_search",
            description=(
                "Search the public web using DuckDuckGo. "
                "Returns a list of results with keys: title, href, body. "
                "Use this first to identify relevant sources on a topic."
            ),
        ),
        FunctionTool(
            func=extract_page_content,
            name="extract_page_content",
            description=(
                "Fetch a URL and extract its clean text content. "
                "Use this after web_search to read the full details of a "
                "promising page. Returns truncated plain text."
            ),
        ),
    ]


def _build_researcher_agent(
    model_client: OpenAIChatCompletionClient,
    tools: list[FunctionTool],
) -> AssistantAgent:
    """
    Builds the information-gathering agent with full tool access.

    The system message encodes a deterministic workflow so the agent does not
    freestyle — it searches, extracts, compiles, and hands off. This reduces
    token waste from open-ended exploration.
    """
    return AssistantAgent(
        name="ResearcherAgent",
        model_client=model_client,
        tools=tools,
        system_message=(
            "You are a meticulous research analyst with access to web search tools.\n\n"
            "WORKFLOW — follow this strictly:\n"
            "1. Issue 2–3 targeted web_search calls to build an overview of the topic.\n"
            "2. Identify the 3–5 most authoritative or recent URLs from the results.\n"
            "3. Call extract_page_content on each of those URLs.\n"
            "4. Compile your findings in the following structured format:\n\n"
            "   ## RAW FINDINGS\n"
            "   ### Source: [title](<url>)\n"
            "   Key points: …\n"
            "   (repeat for each source)\n\n"
            "   ## KEY THEMES\n"
            "   - Theme 1: …\n"
            "   - Theme 2: …\n\n"
            "   ## KNOWLEDGE GAPS\n"
            "   - …\n\n"
            "5. End your message with 'FINDINGS_READY' so the SynthesizerAgent knows "
            "to pick up.\n\n"
            "Do NOT write the final report — that is the Synthesizer's role.\n"
            "Prioritize recency and source authority.  Cite every URL you used."
        ),
    )


def _build_synthesizer_agent(
    model_client: OpenAIChatCompletionClient,
) -> AssistantAgent:
    """
    Builds the writing agent — intentionally given zero tools.

    No tools means no accidental tool-calling during the writing phase, which
    wastes tokens and can produce malformed reports.  The Synthesizer is a pure
    reasoning / composition agent.
    """
    return AssistantAgent(
        name="SynthesizerAgent",
        model_client=model_client,
        tools=[],  # Explicit empty list — no tools by design.
        system_message=(
            "You are a senior technical writer and analyst. "
            "You receive structured raw findings from the ResearcherAgent and "
            "produce a polished, comprehensive markdown research report.\n\n"
            "REQUIRED REPORT STRUCTURE:\n"
            "```\n"
            "# [Descriptive Report Title]\n\n"
            "## Executive Summary\n"
            "(2–3 paragraph overview of the topic and key conclusions)\n\n"
            "## Key Findings\n"
            "(bullet-point list of the most important facts, one per line)\n\n"
            "## Detailed Analysis\n"
            "(structured prose with sub-headings as needed)\n\n"
            "## Conflicting Information & Knowledge Gaps\n"
            "(flag anything uncertain, contradictory, or missing from the research)\n\n"
            "## Sources\n"
            "(numbered list of all cited sources as markdown links)\n"
            "```\n\n"
            "REQUIREMENTS:\n"
            "- Synthesize, do not just copy-paste.  Add analytical insight.\n"
            "- Use inline markdown citations: text ([source title](url)).\n"
            "- Write for a technical audience — precise, concise, no filler.\n"
            f"- Your final message MUST end with the exact token: {_TERMINATION_SIGNAL}\n\n"
            "Do NOT call any tools.  Use only the findings provided to you."
        ),
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_research_orchestration(
    query: str,
    project_id: str,
    max_rounds: int = settings.max_research_rounds,
) -> str:
    """
    Run the full Researcher → Synthesizer pipeline and return the markdown report.

    This function is intentionally stateless.  Every call builds its own model
    client, tool wrappers, agents, and team.  No cross-call shared state means:
      - Concurrent FastAPI background tasks are safe without locks.
      - Future Celery workers can call this in separate processes with no IPC.
      - Test isolation is trivial — each test call is fully independent.

    Args:
        query:      The user's research question or topic string.
        project_id: Used only for structured logging; not mutated here.
        max_rounds: Hard upper bound on total agent messages (safety net).

    Returns:
        The final synthesized markdown report as a plain string.

    Raises:
        RuntimeError: When the loop ends (max_rounds or unexpected early stop)
                      without the Synthesizer producing a valid report.
    """
    logger.info(
        "Orchestration start | project_id=%s | model=%s | max_rounds=%d | query=%r",
        project_id, settings.openai_model, max_rounds, query,
    )

    model_client = _build_model_client()
    tools = _build_tools()

    researcher = _build_researcher_agent(model_client, tools)
    synthesizer = _build_synthesizer_agent(model_client)

    # OR-combined termination: whichever fires first wins.
    # The signal-based condition is the happy path; the round cap is the safety net.
    termination = (
        TextMentionTermination(_TERMINATION_SIGNAL)
        | MaxMessageTermination(max_rounds)
    )

    team = RoundRobinGroupChat(
        participants=[researcher, synthesizer],
        termination_condition=termination,
    )

    task_message = (
        f"Research the following topic thoroughly and produce a comprehensive report:\n\n"
        f"TOPIC: {query}\n\n"
        "Start with web searches, extract key sources, compile structured findings, "
        "then hand off to the SynthesizerAgent."
    )

    result: TaskResult = await team.run(
        task=task_message,
        cancellation_token=CancellationToken(),
    )

    logger.info(
        "Orchestration ended | project_id=%s | stop_reason=%r | messages=%d",
        project_id, result.stop_reason, len(result.messages),
    )

    # Extract the last substantive SynthesizerAgent text message.
    # Iterating in reverse means we get the most recent synthesis attempt,
    # which handles the max_rounds fallback case gracefully.
    final_report: Optional[str] = None

    for message in reversed(result.messages):
        is_synthesizer = getattr(message, "source", None) == "SynthesizerAgent"
        content = getattr(message, "content", None)
        if is_synthesizer and isinstance(content, str) and content.strip():
            # Strip the termination sentinel before storing/returning
            final_report = content.replace(_TERMINATION_SIGNAL, "").strip()
            break

    if final_report is None:
        raise RuntimeError(
            f"Orchestration for project_id={project_id!r} produced no final report. "
            f"stop_reason={result.stop_reason!r}, total_messages={len(result.messages)}"
        )

    logger.info(
        "Report ready | project_id=%s | chars=%d",
        project_id, len(final_report),
    )
    return final_report
