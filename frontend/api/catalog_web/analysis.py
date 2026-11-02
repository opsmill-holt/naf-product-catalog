"""Run the stack-review skill on a submitted automation stack, keep the answer for the web page to
collect, and store it on the stack record in Infrahub.

The skill lives in skill_home/.claude/skills/stack-review/SKILL.md and runs through the Claude Agent
SDK. Analysis is switched off unless ANTHROPIC_API_KEY is set. The skill gets only catalog facts
(products, coverage, requirements); never the name, email or organization the visitor typed.
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
MODEL = os.environ.get("STACK_ANALYSIS_MODEL", "claude-sonnet-5")
TIMEOUT_SECONDS = 90
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
    summaries = {requirement["identifier"]: requirement["summary"] for requirement in catalog["requirements"]}
    blocks = []
    for block in catalog["blocks"]:
        name = block["name"]
        status = "covered" if name in covered else "no tool" if name in no_tool_blocks else "not stated"
        blocks.append(
            {
                "name": name,
                "status": status,
                "requirements": [
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
                "description": product["description"],
                "status": product["status"],
                "coverage": [
                    {
                        "block": claim["block"],
                        "extent": claim["extent"] if claim["assessed"] else "not assessed",
                        "note": claim["note"],
                        "requirements_not_met": [
                            summaries.get(verdict["requirement"], verdict["requirement"])
                            for verdict in claim["verdicts"]
                            if verdict["verdict"] != "met"
                        ],
                    }
                    for claim in product["claims"]
                ],
            }
            for product in chosen
        ],
        "blocks": blocks,
    }


async def run_skill(facts: dict[str, Any]) -> str:
    """Run the stack-review skill with the Claude Agent SDK and return its answer."""
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    prompt = (
        f"Use the {SKILL} skill to review this automation stack. The facts come from the catalog:\n\n"
        f"```json\n{json.dumps(facts, indent=2)}\n```"
    )
    with tempfile.TemporaryDirectory(prefix="stack-review-") as home:
        options = ClaudeAgentOptions(
            cwd=SKILL_HOME,
            skills=[SKILL],
            tools=["Skill"],  # no shell, file or web access
            permission_mode="dontAsk",
            model=MODEL,
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

    def __init__(self, runner: Runner = run_skill, timeout: float = TIMEOUT_SECONDS) -> None:
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
