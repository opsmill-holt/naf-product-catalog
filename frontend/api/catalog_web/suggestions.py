"""Validate a visitor's suggestion that a product's facts are wrong or out of date, and send it to
Infrahub as an update suggestion on a branch with a proposed change. The catalog itself does not
change; a maintainer checks the suggestion and edits the product."""

from datetime import UTC, datetime
from typing import Literal

from infrahub_sdk import InfrahubClient
from pydantic import BaseModel, Field, field_validator, model_validator

from catalog_web.stacks import EMAIL, EMAIL_MAX, _optional
from catalog_web.submissions import NAME_MAX, SubmissionError, check_url, new_branch_name, open_proposed_change

CORRECTION_MAX = 2000

Topic = Literal["description", "homepage", "publisher", "license_model", "status", "coverage", "other"]
TOPIC_LABELS = {
    "description": "description",
    "homepage": "home page",
    "publisher": "publisher",
    "license_model": "license model",
    "status": "status",
    "coverage": "coverage",
    "other": "other",
}


class Suggestion(BaseModel):
    product: str = Field(min_length=1, max_length=2 * NAME_MAX + 1)  # full name, as in /api/catalog
    topic: Topic
    block: str | None = Field(default=None, max_length=NAME_MAX)  # required when the topic is coverage
    correction: str = Field(min_length=1, max_length=CORRECTION_MAX)
    source_url: str | None = None
    name: str | None = Field(default=None, max_length=NAME_MAX)
    email: str | None = Field(default=None, max_length=EMAIL_MAX)

    @field_validator("correction")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("say what should change")
        return value

    @field_validator("block", "name")
    @classmethod
    def strip(cls, value: str | None) -> str | None:
        return _optional(value)

    @field_validator("source_url")
    @classmethod
    def valid_url(cls, value: str | None) -> str | None:
        value = _optional(value)
        return check_url(value) if value is not None else None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str | None) -> str | None:
        value = _optional(value)
        if value is not None and not EMAIL.match(value):
            raise ValueError("is not an email address")
        return value

    @model_validator(mode="after")
    def block_for_coverage(self) -> "Suggestion":
        if self.topic == "coverage" and self.block is None:
            raise ValueError("choose the building block the coverage suggestion is about")
        if self.topic != "coverage":
            self.block = None
        return self


async def submit_suggestion(client: InfrahubClient, suggestion: Suggestion, branch_name: str | None = None) -> str:
    """Create a branch with the update suggestion and open a proposed change. Returns the branch name."""
    found = await client.filters("CatalogProduct", full_name__value=suggestion.product, branch="main")
    if not found:
        raise SubmissionError(422, f"{suggestion.product} is not in the catalog")
    product = found[0]
    block = None
    if suggestion.block is not None:
        blocks = await client.filters("CatalogBuildingBlock", name__value=suggestion.block, branch="main")
        if not blocks:
            raise SubmissionError(422, f"unknown building block: {suggestion.block}")
        block = blocks[0]

    branch = branch_name or new_branch_name()

    async def write() -> None:
        data = {
            "reference": branch,
            "submitted_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "product": product,
            "topic": suggestion.topic,
            "correction": suggestion.correction,
        }
        if block is not None:
            data["building_block"] = block
        if suggestion.source_url is not None:
            data["source_url"] = suggestion.source_url
        for field in ("name", "email"):
            if getattr(suggestion, field) is not None:
                data[f"submitter_{field}"] = getattr(suggestion, field)
        node = await client.create("CatalogUpdateSuggestion", branch=branch, **data)
        await node.save()

    about = TOPIC_LABELS[suggestion.topic] + (f" of {suggestion.block}" if suggestion.block else "")
    await open_proposed_change(
        client,
        branch,
        name=f"Update suggestion: {suggestion.product} ({about})",
        description=(
            "Submitted through the public catalog web app. The catalog does not change on merge: check "
            "the suggestion and its source, then edit the product on a branch of its own. Name and email "
            "are optional and not verified."
        ),
        write=write,
    )
    return branch
