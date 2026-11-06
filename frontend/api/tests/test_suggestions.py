import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from catalog_web.submissions import SubmissionError
from catalog_web.suggestions import Suggestion, submit_suggestion
from tests.test_submissions import FakeClient

EXISTING = {
    "CatalogProduct": [{"full_name": "Example Corp Tool"}],
    "CatalogBuildingBlock": [{"name": "Collector"}, {"name": "Executor"}],
}
LICENSE = {"topic": "license_model", "correction": "It is open core since 2026."}
VALID = {"product": "Example Corp Tool", "changes": [LICENSE]}


def run(client: FakeClient, data: dict) -> str:
    return asyncio.run(submit_suggestion(client, Suggestion.model_validate(data), branch_name="submission-test"))


def test_needs_at_least_one_change_and_at_most_ten() -> None:
    with pytest.raises(ValidationError):
        Suggestion.model_validate({**VALID, "changes": []})
    with pytest.raises(ValidationError):
        Suggestion.model_validate({**VALID, "changes": [LICENSE] * 11})


def test_correction_is_required_and_blank_is_refused() -> None:
    with pytest.raises(ValidationError):
        Suggestion.model_validate({**VALID, "changes": [{**LICENSE, "correction": "   "}]})


def test_coverage_needs_a_block_and_other_topics_drop_it() -> None:
    with pytest.raises(ValidationError):
        Suggestion.model_validate({**VALID, "changes": [{**LICENSE, "topic": "coverage"}]})
    assert Suggestion.model_validate({**VALID, "changes": [{**LICENSE, "block": "Collector"}]}).changes[0].block is None


def test_source_link_must_be_http_and_email_must_look_like_an_address() -> None:
    with pytest.raises(ValidationError):
        Suggestion.model_validate({**VALID, "changes": [{**LICENSE, "source_url": "ftp://example.org"}]})
    with pytest.raises(ValidationError):
        Suggestion.model_validate({**VALID, "email": "nope"})
    blank = Suggestion.model_validate({**VALID, "changes": [{**LICENSE, "source_url": ""}], "name": " ", "email": ""})
    assert (blank.changes[0].source_url, blank.name, blank.email) == (None, None, None)


def test_one_change_is_one_record_with_the_branch_as_reference() -> None:
    client = FakeClient(existing=EXISTING)
    data = {**VALID, "changes": [{**LICENSE, "source_url": "https://example.org/license"}], "name": "Ada"}
    assert run(client, data) == "submission-test"
    suggestion, proposed_change = client.saved
    assert suggestion.kind == "CatalogUpdateSuggestion"
    assert suggestion.branch == "submission-test"
    assert suggestion.data["reference"] == "submission-test"
    assert suggestion.data["product"].full_name.value == "Example Corp Tool"
    assert suggestion.data["topic"] == "license_model"
    assert suggestion.data["source_url"] == "https://example.org/license"
    assert suggestion.data["submitter_name"] == "Ada"
    assert "building_block" not in suggestion.data and "submitter_email" not in suggestion.data
    assert proposed_change.data["name"] == "Update suggestion: Example Corp Tool (license model)"


def test_several_changes_are_numbered_records_on_one_branch_with_one_proposed_change() -> None:
    client = FakeClient(existing=EXISTING)
    changes = [
        LICENSE,
        {"topic": "coverage", "block": "Executor", "correction": "It also writes changes."},
        {"topic": "homepage", "correction": "https://example.org/new", "source_url": "https://example.org/new"},
    ]
    run(client, {**VALID, "changes": changes, "email": "ada@example.org"})
    *suggestions, proposed_change = client.saved
    assert [node.kind for node in suggestions] == ["CatalogUpdateSuggestion"] * 3
    assert [node.data["reference"] for node in suggestions] == ["submission-test-1", "submission-test-2", "submission-test-3"]
    assert {node.branch for node in suggestions} == {"submission-test"}
    assert suggestions[1].data["building_block"].name.value == "Executor"
    assert all(node.data["submitter_email"] == "ada@example.org" for node in suggestions)
    assert proposed_change.kind == "CoreProposedChange"
    assert proposed_change.data["name"] == "Update suggestion: Example Corp Tool (license model, coverage of Executor, home page)"


def test_unknown_product_or_block_is_refused_before_a_branch_is_created() -> None:
    client = FakeClient(existing=EXISTING)
    with pytest.raises(SubmissionError) as error:
        run(client, {**VALID, "product": "Missing"})
    assert error.value.status_code == 422
    with pytest.raises(SubmissionError):
        run(client, {**VALID, "changes": [LICENSE, {"topic": "coverage", "block": "Nonsense", "correction": "x"}]})
    assert client.branches == []


def test_branch_is_deleted_when_writing_fails() -> None:
    client = FakeClient(existing=EXISTING, fail_on={"CatalogUpdateSuggestion"})
    with pytest.raises(RuntimeError):
        run(client, VALID)
    assert client.deleted == ["submission-test"]


def test_service_returns_the_reference(monkeypatch) -> None:
    from catalog_web import main

    async def fake_submit(client, suggestion):
        return "submission-20261106-abcdef"

    monkeypatch.setattr(main, "submit_suggestion", fake_submit)
    monkeypatch.setattr(main, "get_client", lambda: None)
    monkeypatch.setattr(main, "limit", main.SubmissionLimit(per_address=10, total=10))
    response = TestClient(main.app).post("/api/suggestions", json=VALID)
    assert response.status_code == 201
    assert response.json() == {"reference": "submission-20261106-abcdef"}
