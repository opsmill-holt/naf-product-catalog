"""Run the stack-review skill on a submitted automation stack, keep the answer for the web page to
collect, and store it on the stack record in Infrahub.

The skill's instructions are skill_home/.claude/skills/stack-review/SKILL.md. The service writes the
"Coverage and gaps" section itself from the catalog facts; the model writes the rest. By default the
instructions are sent in one request to the Claude API (STACK_ANALYSIS_RUNNER=direct); with
STACK_ANALYSIS_RUNNER=sdk they run as a skill through the Claude Agent SDK. Analysis is switched off
unless ANTHROPIC_API_KEY is set. The model gets only catalog facts (products, coverage, requirements);
never the name, email or organization the visitor typed.
"""

import asyncio
import json
import logging
import os
import secrets
import tempfile
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from infrahub_sdk import InfrahubClient

logger = logging.getLogger(__name__)

SKILL = "stack-review"
SKILL_HOME = Path(__file__).resolve().parent.parent / "skill_home"
SKILL_FILE = SKILL_HOME / ".claude" / "skills" / SKILL / "SKILL.md"
# Compared on four stacks on 2026-11-06 with the direct call: Sonnet 5.5 kept to the skill's rules; at
# medium effort it missed a ready workflow that high effort found, for 0.02 to 0.035 USD and under 20 s a
# review. Haiku 5.5 was ten times cheaper but called workflows ready without evidence.
MODEL = os.environ.get("STACK_ANALYSIS_MODEL", "claude-sonnet-5-5")
RUNNER = os.environ.get("STACK_ANALYSIS_RUNNER", "direct")
MAX_OUTPUT_TOKENS = 16000

# USD per million tokens: input, cache write (5 minutes), cache read, output. From
# https://platform.claude.com/docs/en/about-claude/pricing on 2026-11-06, prompts under 100,000 tokens.
PRICES = {
    "claude-sonnet-5": (2.0, 2.5, 0.2, 10.0),
    "claude-sonnet-5-5": (2.0, 2.5, 0.1, 10.0),
    "claude-haiku-5-5": (0.1, 0.125, 0.01, 0.5),
}
# How much the model thinks. With the Agent SDK and Sonnet 5, high took 87 s on a 5-product stack; with
# the direct call and Sonnet 5.5 it took 19 s.
EFFORT = os.environ.get("STACK_ANALYSIS_EFFORT", "high")
TIMEOUT_SECONDS = 150
MAX_BUDGET_USD = 0.5
KEEP_SECONDS = 3600  # how long the page can collect an answer

Runner = Callable[[dict[str, Any]], Awaitable[str]]


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def build_input(catalog: dict[str, Any], products: list[str], no_tool_blocks: list[str]) -> dict[str, Any]:
    """The facts the skill reviews: each product with its coverage, and every block with its status
    and its MUST and SHOULD requirements."""
    chosen = [product for product in catalog["products"] if product["full_name"] in products]
    covered = {claim["block"] for product in chosen for claim in product["claims"]}
    fully = {claim["block"] for product in chosen for claim in product["claims"] if claim["extent"] == "full"}
    # Each block requirement as "MUST: <summary>" or "SHOULD: <summary>", so the level travels with it.
    # Framework-wide requirements are left out: they do not count toward a block's coverage.
    summaries = {
        requirement["identifier"]: f"{requirement['level'].upper()}: {requirement['summary']}"
        for requirement in catalog["requirements"]
        if requirement["block"] is not None
    }
    blocks = []
    for block in catalog["blocks"]:
        name = block["name"]
        status = "covered" if name in covered else "no tool" if name in no_tool_blocks else "not stated"
        blocks.append(
            {
                "name": name,
                "status": status,
                # A fully covered block needs no list of what it requires.
                "requirements": []
                if name in fully
                else [
                    {"level": requirement["level"], "summary": requirement["summary"]}
                    for requirement in catalog["requirements"]
                    if requirement["block"] == name and requirement["level"] in ("must", "should")
                ],
            }
        )
    return {
        "products": [
            {
                "name": product["full_name"],
                "short_name": product["name"],
                "description": product["description"],
                "status": product["status"],
                "coverage": [
                    {
                        "block": claim["block"],
                        "extent": claim["extent"] if claim["assessed"] else "not assessed",
                        "note": claim["note"],
                        "requirements_met": [
                            summaries[verdict["requirement"]]
                            for verdict in claim["verdicts"]
                            if verdict["verdict"] == "met" and verdict["requirement"] in summaries
                        ],
                        "requirements_not_met": [
                            summaries[verdict["requirement"]]
                            for verdict in claim["verdicts"]
                            if verdict["verdict"] != "met" and verdict["requirement"] in summaries
                        ],
                    }
                    for claim in product["claims"]
                ],
            }
            for product in chosen
        ],
        "blocks": blocks,
    }


def coverage_section(facts: dict[str, Any]) -> str:
    """The "Coverage and gaps" section, written from the facts so that it is exact. For each block that
    is only partly covered it names the first MUST requirement not fully met, or else the first SHOULD."""
    full: dict[str, list[str]] = {}
    partial: dict[str, list[str]] = {}
    shortfalls: dict[str, list[str]] = {}
    for product in facts["products"]:
        name = product.get("short_name") or product["name"]
        for claim in product["coverage"]:
            target = full if claim["extent"] == "full" else partial
            target.setdefault(claim["block"], []).append(name)
            shortfalls.setdefault(claim["block"], []).extend(claim["requirements_not_met"])
    order = [block["name"] for block in facts["blocks"]]
    lines = ["Coverage and gaps"]
    if full:
        lines.append("- Fully covered: " + "; ".join(f"{b} ({', '.join(full[b])})" for b in order if b in full) + ".")
    for block in (b for b in order if b in partial and b not in full):
        missing = shortfalls.get(block, [])
        first = next((item for item in missing if item.startswith("MUST")), None) or next(iter(missing), None)
        line = f"- Partly covered: {block} ({', '.join(partial[block])})"
        if first:
            level, _, summary = first.partition(": ")
            line += f". {level} requirement not fully met: {summary}"
        lines.append(line + ".")
    for status, label in (("no tool", "No tool"), ("not stated", "Not stated")):
        names = [block["name"] for block in facts["blocks"] if block["status"] == status]
        if names:
            lines.append(f"- {label}: {', '.join(names)}.")
    if all(block["status"] == "covered" for block in facts["blocks"]):
        lines.append("- Every building block has at least one tool.")
    return "\n".join(lines)


def compose(written: str, coverage: str) -> str:
    """Put the service's coverage section after the model's "Your stack" section."""
    marker = "\nWorkflows\n"
    at = written.find(marker)
    if at == -1:
        return f"{written.strip()}\n\n{coverage}"
    return f"{written[:at].rstrip()}\n\n{coverage}\n{written[at:]}".strip()


def skill_instructions() -> str:
    """SKILL.md without its front matter."""
    text = SKILL_FILE.read_text()
    if text.startswith("---"):
        text = text.split("---", 2)[2]
    return text.strip()


def prompt_for(facts: dict[str, Any]) -> str:
    return (
        f"Review this automation stack. The facts come from the catalog:\n\n"
        f"```json\n{json.dumps(facts, indent=1)}\n```"
    )


def cost_of(model: str, usage: Any) -> float | None:
    prices = PRICES.get(model)
    if prices is None:
        return None
    base, write, read, out = prices
    return (
        usage.input_tokens * base
        + (usage.cache_creation_input_tokens or 0) * write
        + (usage.cache_read_input_tokens or 0) * read
        + usage.output_tokens * out
    ) / 1_000_000


async def run_direct(facts: dict[str, Any], model: str = MODEL, effort: str = EFFORT) -> str:
    """Send SKILL.md as cached instructions and the facts in one request to the Claude API."""
    from anthropic import AsyncAnthropic

    started = time.monotonic()
    async with AsyncAnthropic() as client:
        response = await client.messages.create(
            model=model,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=[{"type": "text", "text": skill_instructions(), "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": prompt_for(facts)}],
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
        )
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise RuntimeError(f"the model gave no answer ({response.stop_reason})")
    logger.info(
        "stack review took %d ms and cost %s USD (%s output tokens)",
        (time.monotonic() - started) * 1000,
        cost_of(model, response.usage),
        response.usage.output_tokens,
    )
    return text


async def review(facts: dict[str, Any]) -> str:
    """The full review: the model's sections with the service's coverage section."""
    written = await (run_direct(facts) if RUNNER == "direct" else run_skill(facts))
    return compose(written, coverage_section(facts))


async def run_skill(facts: dict[str, Any]) -> str:
    """Run the stack-review skill with the Claude Agent SDK and return its answer."""
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    prompt = f"Use the {SKILL} skill. " + prompt_for(facts)
    with tempfile.TemporaryDirectory(prefix="stack-review-") as home:
        options = ClaudeAgentOptions(
            cwd=SKILL_HOME,
            skills=[SKILL],
            tools=["Skill"],  # no shell, file or web access
            permission_mode="dontAsk",
            model=MODEL,
            effort=EFFORT,
            max_turns=4,
            max_budget_usd=MAX_BUDGET_USD,
            # The CLI keeps its session files under HOME; the service account has no home. The
            # Infrahub token is not needed by the skill, so it is removed from its environment.
            env={"HOME": home, "INFRAHUB_API_TOKEN": ""},
        )
        result = None
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, ResultMessage):
                result = message
    if result is None or result.is_error or not result.result:
        raise RuntimeError(f"the skill gave no answer ({result.subtype if result else 'no result'})")
    logger.info("stack review took %s ms and cost %s USD", result.duration_ms, result.total_cost_usd)
    return result.result.strip()


async def store_analysis(client: InfrahubClient, reference: str, text: str) -> None:
    """Save the answer on the stack record, on the stack's submission branch."""
    node = await client.get("CatalogAutomationStack", reference__value=reference, branch=reference)
    node.analysis.value = text
    await node.save()


@dataclass
class Analysis:
    reference: str
    status: str = "pending"  # pending, done or failed
    text: str | None = None
    started: float = field(default_factory=time.monotonic)


class Analyses:
    """Answers being prepared or ready, by a random ID the page polls with. Kept in memory, because
    the answer is also stored in Infrahub; a restart only stops the page from collecting it."""

    def __init__(self, runner: Runner = review, timeout: float = TIMEOUT_SECONDS) -> None:
        self.runner = runner
        self.timeout = timeout
        self._items: dict[str, Analysis] = {}
        self._tasks: set[asyncio.Task] = set()

    def start(self, client: InfrahubClient, reference: str, facts: dict[str, Any]) -> str:
        self._prune()
        analysis_id = secrets.token_urlsafe(16)
        self._items[analysis_id] = Analysis(reference=reference)
        task = asyncio.create_task(self._run(client, analysis_id, facts))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return analysis_id

    def get(self, analysis_id: str) -> Analysis | None:
        return self._items.get(analysis_id)

    async def _run(self, client: InfrahubClient, analysis_id: str, facts: dict[str, Any]) -> None:
        item = self._items[analysis_id]
        try:
            text = await asyncio.wait_for(self.runner(facts), timeout=self.timeout)
        except Exception:
            logger.exception("stack review for %s failed", item.reference)
            item.status = "failed"
            return
        item.text, item.status = text, "done"
        try:
            await store_analysis(client, item.reference, text)
        except Exception:
            logger.exception("could not store the stack review on %s", item.reference)

    def _prune(self) -> None:
        now = time.monotonic()
        for analysis_id in [key for key, item in self._items.items() if now - item.started > KEEP_SECONDS]:
            del self._items[analysis_id]
