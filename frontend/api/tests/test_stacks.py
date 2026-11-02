import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from catalog_web.stacks import Stack, submit_stack
from catalog_web.submissions import SubmissionError
from tests.test_submissions import FakeClient

# Example Corp Tool covers Collector; Other Org Engine covers Collector and Executor.
COVERAGE = {"Example Corp Tool": ["Collector"], "Other Org Engine": ["Collector", "Executor"]}
BLOCKS = ["Collector", "Executor", "Intent"]


class StackClient(FakeClient):
    """Answers the stack service's catalog query with COVERAGE and BLOCKS."""

    async def execute_graphql(self, query: str, branch_name: str) -> dict:
        claim = lambda block: {"node": {"building_block": {"node": {"name": {"value": block}}}}}  # noqa: E731
        return {
            "CatalogProduct": {
                "edges": [
                    {"node": {"id": f"id-{name}", "full_name": {"value": name}, "coverage_claims": {"edges": [claim(b) for b in blocks]}}}
                    for name, blocks in COVERAGE.items()
                ]
            },
            "CatalogBuildingBlock": {"edges": [{"node": {"id": f"id-{name}", "name": {"value": name}}} for name in BLOCKS]},
        }


def run(client: FakeClient, data: dict) -> str:
    return asyncio.run(submit_stack(client, Stack.model_validate(data), branch_name="submission-test"))


def test_stack_needs_at_least_one_product() -> None:
    with pytest.raises(ValidationError):
        Stack.model_validate({"products": []})


def test_a_product_may_be_listed_once() -> None:
    with pytest.raises(ValidationError):
        Stack.model_validate({"products": ["Example Corp Tool", "Example Corp Tool"]})


def test_name_email_and_organization_are_optional_and_blank_means_left_out() -> None:
    stack = Stack.model_validate({"products": ["Example Corp Tool"], "name": "  ", "email": "", "organization": None})
    assert (stack.name, stack.email, stack.organization) == (None, None, None)


def test_email_must_look_like_an_address() -> None:
    with pytest.raises(ValidationError):
        Stack.model_validate({"products": ["Example Corp Tool"], "email": "not an address"})


def test_stack_is_written_on_a_branch_with_a_proposed_change() -> None:
    client = StackClient()
    data = {"products": ["Example Corp Tool", "Other Org Engine"], "name": "Ada", "organization": "Example Net"}
    assert run(client, data) == "submission-test"
    stack, proposed_change = client.saved
    assert stack.kind == "CatalogAutomationStack"
    assert stack.branch == "submission-test"
    assert stack.data["reference"] == "submission-test"
    assert stack.data["products"] == ["id-Example Corp Tool", "id-Other Org Engine"]
    assert "blocks_without_tool" not in stack.data
    assert stack.data["submitter_name"] == "Ada"
    assert stack.data["submitter_organization"] == "Example Net"
    assert "submitter_email" not in stack.data
    assert proposed_change.data["name"] == "Automation stack: Example Net (2 products)"
    assert proposed_change.data["source_branch"] == "submission-test"


def test_anonymous_stack_is_named_anonymous() -> None:
    client = StackClient()
    run(client, {"products": ["Example Corp Tool"]})
    assert client.saved[-1].data["name"] == "Automation stack: anonymous (1 product)"


def test_unknown_product_is_refused_before_a_branch_is_created() -> None:
    client = StackClient()
    with pytest.raises(SubmissionError) as error:
        run(client, {"products": ["Example Corp Tool", "Missing Thing"]})
    assert error.value.status_code == 422
    assert "Missing Thing" in error.value.message
    assert client.branches == []


def test_branch_is_deleted_when_writing_fails() -> None:
    client = StackClient(fail_on={"CatalogAutomationStack"})
    with pytest.raises(RuntimeError):
        run(client, {"products": ["Example Corp Tool"]})
    assert client.deleted == ["submission-test"]
    assert client.branches == []


def test_service_returns_the_reference(monkeypatch) -> None:
    from catalog_web import main

    async def fake_submit(client, stack):
        return "submission-20261102-abcdef"

    monkeypatch.setattr(main, "submit_stack", fake_submit)
    monkeypatch.setattr(main, "get_client", lambda: None)
    monkeypatch.setattr(main, "limit", main.SubmissionLimit(per_address=10, total=10))
    response = TestClient(main.app).post("/api/stacks", json={"products": ["Example Corp Tool"]})
    assert response.status_code == 201
    assert response.json() == {"reference": "submission-20261102-abcdef"}


def test_blocks_the_visitor_has_no_tool_for_are_recorded() -> None:
    client = StackClient()
    run(client, {"products": ["Example Corp Tool"], "no_tool_blocks": ["Intent", "Executor"]})
    assert client.saved[0].data["blocks_without_tool"] == ["id-Intent", "id-Executor"]


def test_a_block_the_stack_covers_cannot_be_marked_as_having_no_tool() -> None:
    client = StackClient()
    with pytest.raises(SubmissionError) as error:
        run(client, {"products": ["Other Org Engine"], "no_tool_blocks": ["Executor"]})
    assert error.value.status_code == 422
    assert "Executor" in error.value.message
    assert client.branches == []


def test_unknown_block_is_refused() -> None:
    client = StackClient()
    with pytest.raises(SubmissionError) as error:
        run(client, {"products": ["Example Corp Tool"], "no_tool_blocks": ["Nonsense"]})
    assert "Nonsense" in error.value.message
