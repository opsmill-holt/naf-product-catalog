"""Validate a product submission and turn it into an Infrahub branch and proposed change."""

import logging
import secrets
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from typing import Literal

from infrahub_sdk import InfrahubClient
from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

logger = logging.getLogger(__name__)

NAME_MAX = 100
TEXT_MAX = 1000
TITLE_MAX = 200
URL_MAX = 500
SOURCES_MAX = 20

LicenseModel = Literal["open_source", "open_core", "commercial"]
Status = Literal["active", "discontinued"]


def _text(max_length: int, min_length: int = 1):
    return Field(min_length=min_length, max_length=max_length)


def check_url(value: str) -> str:
    """Accept only http and https links of a sane length."""
    value = value.strip()
    if len(value) > URL_MAX:
        raise ValueError(f"must be at most {URL_MAX} characters")
    if HttpUrl(value).scheme not in {"http", "https"}:
        raise ValueError("must start with http:// or https://")
    return value


class Source(BaseModel):
    key: str = _text(40)
    title: str = _text(TITLE_MAX)
    url: str

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        return check_url(value)


class NewPublisher(BaseModel):
    name: str = _text(NAME_MAX)
    homepage_url: str

    @field_validator("homepage_url")
    @classmethod
    def valid_homepage(cls, value: str) -> str:
        return check_url(value)


class PublisherChoice(BaseModel):
    existing: str | None = Field(default=None, max_length=NAME_MAX)
    new: NewPublisher | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> "PublisherChoice":
        if (self.existing is None) == (self.new is None):
            raise ValueError("choose an existing publisher or enter a new one")
        return self

    @property
    def name(self) -> str:
        return self.existing if self.existing is not None else self.new.name


class Product(BaseModel):
    name: str = _text(NAME_MAX)
    description: str = _text(TEXT_MAX)
    homepage_url: str
    license_model: LicenseModel | None = None
    status: Status = "active"
    status_date: date | None = None

    @field_validator("homepage_url")
    @classmethod
    def valid_homepage(cls, value: str) -> str:
        return check_url(value)


class FactSources(BaseModel):
    publisher: list[str] = Field(min_length=1, max_length=SOURCES_MAX)
    description: list[str] = Field(min_length=1, max_length=SOURCES_MAX)
    license_model: list[str] = Field(default_factory=list, max_length=SOURCES_MAX)
    status: list[str] = Field(default_factory=list, max_length=SOURCES_MAX)


class Claim(BaseModel):
    """A building block the product covers. Its extent is computed from requirement verdicts that
    maintainers add during review; an "extent" sent by an older form is ignored."""

    block: str = _text(NAME_MAX)
    note: str | None = Field(default=None, max_length=TEXT_MAX)
    sources: list[str] = Field(min_length=1, max_length=SOURCES_MAX)


class Submission(BaseModel):
    product: Product
    publisher: PublisherChoice
    sources: list[Source] = Field(min_length=1, max_length=SOURCES_MAX)
    fact_sources: FactSources
    claims: list[Claim] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def check_rules(self) -> "Submission":
        keys = [source.key for source in self.sources]
        if len(set(keys)) != len(keys):
            raise ValueError("each source needs its own key")
        urls = [source.url for source in self.sources]
        if len(set(urls)) != len(urls):
            raise ValueError("each source link may appear only once")
        known = set(keys)
        used = (
            self.fact_sources.publisher
            + self.fact_sources.description
            + self.fact_sources.license_model
            + self.fact_sources.status
            + [key for claim in self.claims for key in claim.sources]
        )
        unknown = sorted(set(used) - known)
        if unknown:
            raise ValueError(f"unknown source keys: {', '.join(unknown)}")
        if self.product.license_model and not self.fact_sources.license_model:
            raise ValueError("a license model needs a license model source")
        if self.product.status != "active" and not self.fact_sources.status:
            raise ValueError(f"a status of {self.product.status} needs a status source")
        blocks = [claim.block for claim in self.claims]
        if len(set(blocks)) != len(blocks):
            raise ValueError("only one claim per building block")
        return self


class SubmissionError(Exception):
    """A problem the visitor can act on, with the HTTP status the service returns."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def new_branch_name() -> str:
    return f"submission-{datetime.now(UTC):%Y%m%d}-{secrets.token_hex(3)}"


async def submit(client: InfrahubClient, submission: Submission, branch_name: str | None = None) -> str:
    """Create a branch with the product and open a proposed change. Returns the branch name."""
    publisher_name = submission.publisher.name

    blocks = {block.name.value: block for block in await client.all("CatalogBuildingBlock", branch="main")}
    unknown_blocks = sorted({claim.block for claim in submission.claims} - set(blocks))
    if unknown_blocks:
        raise SubmissionError(422, f"unknown building blocks: {', '.join(unknown_blocks)}")

    existing_publisher = await client.filters("CatalogPublisher", name__value=publisher_name, branch="main")
    if submission.publisher.existing is not None and not existing_publisher:
        raise SubmissionError(422, f"publisher {publisher_name} is not in the catalog")
    if submission.publisher.new is not None and existing_publisher:
        raise SubmissionError(409, f"publisher {publisher_name} is already in the catalog; choose it from the list")
    if existing_publisher and await client.filters(
        "CatalogProduct", publisher__ids=[existing_publisher[0].id], name__value=submission.product.name, branch="main"
    ):
        raise SubmissionError(409, f"{publisher_name} {submission.product.name} is already in the catalog")

    branch = branch_name or new_branch_name()
    await open_proposed_change(
        client,
        branch,
        name=f"Submission: {publisher_name} {submission.product.name}",
        description=(
            "Submitted through the public catalog web app. Check every fact against its source "
            "before merging."
        ),
        write=lambda: _write_submission(client, submission, branch),
    )
    return branch


async def open_proposed_change(
    client: InfrahubClient, branch: str, name: str, description: str, write: Callable[[], Awaitable[None]]
) -> None:
    """Create the branch, write the records on it and open a proposed change to main. If any step
    fails, delete the branch so that nothing is left behind."""
    await client.branch.create(branch_name=branch, sync_with_git=False, wait_until_completion=True)
    try:
        await write()
        proposed_change = await client.create(
            "CoreProposedChange",
            name=name[:250],
            description=description,
            source_branch=branch,
            destination_branch="main",
        )
        await proposed_change.save()
    except Exception:
        logger.exception("submission %s failed; deleting the branch", branch)
        try:
            await client.branch.delete(branch)
        except Exception:
            logger.exception("could not delete branch %s after a failed submission", branch)
        raise


async def _write_submission(client: InfrahubClient, submission: Submission, branch: str) -> None:
    today = f"{date.today().isoformat()}T00:00:00Z"
    sources = {}
    for source in submission.sources:
        found = await client.filters("CatalogSource", url__value=source.url, branch=branch)
        if found:
            sources[source.key] = found[0]
        else:
            node = await client.create(
                "CatalogSource", branch=branch, title=source.title, url=source.url, last_checked=today
            )
            await node.save()
            sources[source.key] = node

    if submission.publisher.new is not None:
        publisher = await client.create(
            "CatalogPublisher",
            branch=branch,
            name=submission.publisher.new.name,
            homepage_url=submission.publisher.new.homepage_url,
        )
        await publisher.save()
    else:
        publisher = await client.get("CatalogPublisher", name__value=submission.publisher.existing, branch=branch)

    facts = submission.fact_sources
    product_data = {
        "name": submission.product.name,
        "publisher": publisher,
        "description": submission.product.description,
        "homepage_url": submission.product.homepage_url,
        "status": submission.product.status,
        "publisher_sources": [sources[key] for key in facts.publisher],
        "description_sources": [sources[key] for key in facts.description],
    }
    if submission.product.license_model:
        product_data["license_model"] = submission.product.license_model
        product_data["license_model_sources"] = [sources[key] for key in facts.license_model]
    if facts.status:
        product_data["status_sources"] = [sources[key] for key in facts.status]
    if submission.product.status_date:
        product_data["status_date"] = f"{submission.product.status_date.isoformat()}T00:00:00Z"
    product = await client.create("CatalogProduct", branch=branch, **product_data)
    await product.save()

    for claim in submission.claims:
        block = await client.get("CatalogBuildingBlock", name__value=claim.block, branch=branch)
        claim_data = {
            "product": product,
            "building_block": block,
            "sources": [sources[key] for key in claim.sources],
        }
        if claim.note:
            claim_data["note"] = claim.note
        node = await client.create("CatalogCoverageClaim", branch=branch, **claim_data)
        await node.save()
