"""Validate a visitor's suggestion that a product's facts are wrong or out of date, and send it to
Infrahub on a branch with a proposed change: one update suggestion per change the visitor lists. The catalog itself does not
change; a maintainer checks the suggestion and edits the product."""

from datetime import UTC, datetime
from typing import Literal

from infrahub_sdk import InfrahubClient
from pydantic import BaseModel, Field, field_validator, model_validator

from catalog_web.stacks import EMAIL, EMAIL_MAX, _optional
from catalog_web.submissions import NAME_MAX, SubmissionError, check_url, new_branch_name, open_proposed_change

CORRECTION_MAX = 2000
CHANGES_MAX = 10

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


class Change(BaseModel):
    """One thing the visitor says should change."""

    topic: Topic
    block: str | None = Field(default=None, max_length=NAME_MAX)  # required when the topic is coverage
    correction: str = Field(min_length=1, max_length=CORRECTION_MAX)
    source_url: str | None = None

    @field_validator("correction")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("say what should change")
        return value

    @field_validator("block")
    @classmethod
    def strip(cls, value: str | None) -> str | None:
        return _optional(value)

    @field_validator("source_url")
    @classmethod
    def valid_url(cls, value: str | None) -> str | None:
        value = _optional(value)
        return check_url(value) if value is not None else None

    @model_validator(mode="after")
    def block_for_coverage(self) -> "Change":
        if self.topic == "coverage" and self.block is None:
            raise ValueError("choose the building block the coverage suggestion is about")
        if self.topic != "coverage":
            self.block = None
        return self

    @property
    def about(self) -> str:
        return TOPIC_LABELS[self.topic] + (f" of {self.block}" if self.block else "")


class Suggestion(BaseModel):
    product: str = Field(min_length=1, max_length=2 * NAME_MAX + 1)  # full name, as in /api/catalog
    changes: list[Change] = Field(min_length=1, max_length=CHANGES_MAX)
    name: str | None = Field(default=None, max_length=NAME_MAX)
    email: str | None = Field(default=None, max_length=EMAIL_MAX)

    @field_validator("name")
    @classmethod
    def strip(cls, value: str | None) -> str | None:
        return _optional(value)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str | None) -> str | None:
        value = _optional(value)
        if value is not None and not EMAIL.match(value):
            raise ValueError("is not an email address")
        return value


async def submit_suggestion(client: InfrahubClient, suggestion: Suggestion, branch_name: str | None = None) -> str:
    """Create a branch with one update suggestion per change and open one proposed change for them.
    Returns the branch name."""
    found = await client.filters("CatalogProduct", full_name__value=suggestion.product, branch="main")
    if not found:
        raise SubmissionError(422, f"{suggestion.product} is not in the catalog")
    product = found[0]
    blocks = {}
    for name in sorted({change.block for change in suggestion.changes if change.block is not None}):
        matches = await client.filters("CatalogBuildingBlock", name__value=name, branch="main")
        if not matches:
            raise SubmissionError(422, f"unknown building block: {name}")
        blocks[name] = matches[0]

    branch = branch_name or new_branch_name()
    submitted_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    async def write() -> None:
        for number, change in enumerate(suggestion.changes, start=1):
            data = {
                # One record per change; with several, the reference numbers them.
                "reference": branch if len(suggestion.changes) == 1 else f"{branch}-{number}",
                "submitted_at": submitted_at,
                "product": product,
                "topic": change.topic,
                "correction": change.correction,
            }
            if change.block is not None:
                data["building_block"] = blocks[change.block]
            if change.source_url is not None:
                data["source_url"] = change.source_url
            for field in ("name", "email"):
                if getattr(suggestion, field) is not None:
                    data[f"submitter_{field}"] = getattr(suggestion, field)
            node = await client.create("CatalogUpdateSuggestion", branch=branch, **data)
            await node.save()

    about = ", ".join(dict.fromkeys(change.about for change in suggestion.changes))
    await open_proposed_change(
        client,
        branch,
        name=f"Update suggestion: {suggestion.product} ({about})",
        description=(
            "Submitted through the public catalog web app. The catalog does not change on merge: check "
            "each suggestion and its source, then edit the product on a branch of its own. Name and email "
            "are optional and not verified."
        ),
        write=write,
    )
    return branch
