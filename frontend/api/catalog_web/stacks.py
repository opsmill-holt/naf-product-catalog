"""Validate an automation stack (the products one visitor uses) and send it to Infrahub on a branch
with a proposed change, as product submissions are."""

import re
from datetime import UTC, datetime

from infrahub_sdk import InfrahubClient
from pydantic import BaseModel, Field, field_validator

from catalog_web.submissions import NAME_MAX, SubmissionError, new_branch_name, open_proposed_change

PRODUCTS_MAX = 200
EMAIL_MAX = 254
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _optional(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


class Stack(BaseModel):
    products: list[str] = Field(min_length=1, max_length=PRODUCTS_MAX)  # full names, as in /api/catalog
    name: str | None = Field(default=None, max_length=NAME_MAX)
    email: str | None = Field(default=None, max_length=EMAIL_MAX)
    organization: str | None = Field(default=None, max_length=NAME_MAX)

    @field_validator("products")
    @classmethod
    def no_repeats(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("each product may be listed only once")
        return value

    @field_validator("name", "organization")
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


async def submit_stack(client: InfrahubClient, stack: Stack, branch_name: str | None = None) -> str:
    """Create a branch with the stack and open a proposed change. Returns the branch name."""
    products = {
        product.full_name.value: product for product in await client.all("CatalogProduct", branch="main")
    }
    unknown = sorted(set(stack.products) - set(products))
    if unknown:
        raise SubmissionError(422, f"these products are not in the catalog: {', '.join(unknown)}")

    branch = branch_name or new_branch_name()
    who = stack.organization or stack.name or "anonymous"
    count = len(stack.products)

    async def write() -> None:
        data = {
            "reference": branch,
            "submitted_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "products": [products[name] for name in stack.products],
        }
        for field in ("name", "email", "organization"):
            if getattr(stack, field) is not None:
                data[f"submitter_{field}"] = getattr(stack, field)
        node = await client.create("CatalogAutomationStack", branch=branch, **data)
        await node.save()

    await open_proposed_change(
        client,
        branch,
        name=f"Automation stack: {who} ({count} {'product' if count == 1 else 'products'})",
        description=(
            "Submitted through the public catalog web app. Name, email and organization are optional "
            "and not verified."
        ),
        write=write,
    )
    return branch
