import asyncio

from fastapi.testclient import TestClient

from catalog_web import analysis
from catalog_web.analysis import Analyses, build_input

CATALOG = {
    "blocks": [{"name": "Collector"}, {"name": "Executor"}, {"name": "Intent"}],
    "requirements": [
        {"identifier": "C1", "level": "must", "summary": "Reads live data", "block": "Collector"},
        {"identifier": "C2", "level": "may", "summary": "Optional thing", "block": "Collector"},
        {"identifier": "E1", "level": "must", "summary": "Writes changes", "block": "Executor"},
    ],
    "products": [
        {
            "full_name": "Example Tool",
            "description": "Collects data.",
            "status": "active",
            "claims": [
                {
                    "block": "Collector",
                    "extent": "partial",
                    "assessed": True,
                    "note": "Only SNMP.",
                    "verdicts": [{"requirement": "C1", "verdict": "partly_met"}],
                }
            ],
        },
        {"full_name": "Other Tool", "description": "", "status": "active", "claims": []},
    ],
}


def test_input_has_only_the_chosen_products_and_the_status_of_every_block() -> None:
    facts = build_input(CATALOG, ["Example Tool"], ["Executor"])
    assert [product["name"] for product in facts["products"]] == ["Example Tool"]
    assert facts["products"][0]["coverage"] == [
        {
            "block": "Collector",
            "extent": "partial",
            "note": "Only SNMP.",
            "requirements_met": [],
            "requirements_not_met": ["Reads live data"],
        }
    ]
    assert {block["name"]: block["status"] for block in facts["blocks"]} == {
        "Collector": "covered",
        "Executor": "no tool",
        "Intent": "not stated",
    }
    # MAY requirements are left out.
    assert facts["blocks"][0]["requirements"] == [{"level": "must", "summary": "Reads live data"}]


class FakeStackNode:
    def __init__(self) -> None:
        self.analysis = type("Value", (), {"value": None})()
        self.saved = False

    async def save(self) -> None:
        self.saved = True


class FakeClient:
    def __init__(self) -> None:
        self.node = FakeStackNode()
        self.asked = None

    async def get(self, kind: str, **filters):
        self.asked = (kind, filters)
        return self.node


def run_analysis(runner, timeout: float = 5) -> tuple[Analyses, str, FakeClient]:
    analyses = Analyses(runner=runner, timeout=timeout)
    client = FakeClient()

    async def go() -> str:
        analysis_id = analyses.start(client, "submission-test", {"products": []})
        await asyncio.gather(*analyses._tasks)
        return analysis_id

    return analyses, asyncio.run(go()), client


def test_answer_is_kept_for_the_page_and_stored_on_the_stack_branch() -> None:
    async def runner(facts):
        return "Your stack covers Collector."

    analyses, analysis_id, client = run_analysis(runner)
    item = analyses.get(analysis_id)
    assert (item.status, item.text) == ("done", "Your stack covers Collector.")
    assert client.asked == ("CatalogAutomationStack", {"reference__value": "submission-test", "branch": "submission-test"})
    assert client.node.analysis.value == "Your stack covers Collector."
    assert client.node.saved


def test_a_failed_or_slow_skill_is_reported_as_failed_and_nothing_is_stored() -> None:
    async def broken(facts):
        raise RuntimeError("no answer")

    async def slow(facts):
        await asyncio.sleep(1)
        return "late"

    for runner, timeout in ((broken, 5), (slow, 0.05)):
        analyses, analysis_id, client = run_analysis(runner, timeout)
        assert analyses.get(analysis_id).status == "failed"
        assert not client.node.saved


def test_service_returns_an_analysis_id_only_when_analysis_is_switched_on(monkeypatch) -> None:
    from catalog_web import main

    async def fake_submit(client, stack):
        return "submission-test"

    async def fake_catalog(client):
        return CATALOG

    started = []
    monkeypatch.setattr(main, "submit_stack", fake_submit)
    monkeypatch.setattr(main, "get_client", lambda: None)
    monkeypatch.setattr(main.cache, "get", fake_catalog)
    monkeypatch.setattr(main.analyses, "start", lambda client, reference, facts: started.append(facts) or "abc")
    monkeypatch.setattr(main, "limit", main.SubmissionLimit(per_address=10, total=10))
    http = TestClient(main.app)

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert http.post("/api/stacks", json={"products": ["Example Tool"]}).json() == {"reference": "submission-test"}

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    response = http.post("/api/stacks", json={"products": ["Example Tool"]}).json()
    assert response == {"reference": "submission-test", "analysis_id": "abc"}
    assert [product["name"] for product in started[0]["products"]] == ["Example Tool"]


def test_unknown_analysis_id_is_not_found() -> None:
    from catalog_web import main

    assert TestClient(main.app).get("/api/analyses/nope").status_code == 404


def test_skill_file_is_where_the_service_looks_for_it() -> None:
    assert (analysis.SKILL_HOME / ".claude" / "skills" / analysis.SKILL / "SKILL.md").is_file()
