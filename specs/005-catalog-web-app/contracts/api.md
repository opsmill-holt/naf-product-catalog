# Contract: Catalog Web Service API

Base path `/api`. JSON only. No authentication, so the service exposes nothing else.

| Method | Path | Purpose | Responses |
|--------|------|---------|-----------|
| GET | `/api/catalog` | The catalog on `main` ([data-model.md](../data-model.md)) | `200`, `503` when Infrahub is unreachable |
| POST | `/api/submissions` | Submit a product | `201`, `409`, `422`, `502`, `503` |
| POST | `/api/stacks` | Submit the products one visitor uses (their automation stack) | `201`, `422`, `429`, `502` |
| GET | `/api/analyses/{id}` | The stack-review skill's answer for a submitted stack | `200`, `404` |
| GET | `/api/health` | Liveness for deployment | `200` |

Configuration (environment variables, never committed):

| Variable | Meaning |
|----------|---------|
| `INFRAHUB_ADDRESS` | Infrahub URL, `http://localhost:8100` in development |
| `INFRAHUB_API_TOKEN` | The `catalog-web` service account token |
| `CATALOG_CACHE_SECONDS` | Catalog cache lifetime, default 60 |

## POST /api/stacks

Request body. `products` holds full names as `/api/catalog` returns them, at least 1 and at most 200,
each once. `no_tool_blocks` lists the building blocks the visitor says they have no tool for; a block
that is neither covered by the products nor listed means the visitor did not say. It is optional and
may not name a block the products cover. `name`, `email` and `organization` are optional; an empty
string is the same as leaving the field out.

```json
{ "products": ["Cisco Crosswork Network Services Orchestrator (NSO)"], "no_tool_blocks": ["Presentation"], "name": "", "email": "", "organization": "Example Net" }
```

The service creates a branch named `submission-<date>-<random>` with one `CatalogAutomationStack`
record (products in `products`, the blocks without a tool in `blocks_without_tool`) and opens a proposed change named "Automation stack: <organization, else name, else
anonymous> (<n> products)". Maintainers merge it after review. Responses:

- `201` `{"reference": "<branch name>"}`, plus `"analysis_id"` when the stack review is switched on;
- `422` when a product or block is not in the catalog on `main`, when `no_tool_blocks` names a
  block the products cover, or when the body is not valid;
- `429` over the submission limit, which `/api/submissions` and `/api/stacks` share;
- `502` when Infrahub could not store it; nothing is left behind.

The web app keeps the visitor's marked products in local storage (`catalog.myTools`) until they
submit them. Stacks are not part of `/api/catalog`.

## GET /api/analyses/{id}

When `ANTHROPIC_API_KEY` is set, the service runs the `stack-review` skill
(`frontend/api/skill_home/.claude/skills/stack-review/SKILL.md`) on each submitted stack with the
Claude Agent SDK, after the branch and proposed change exist. The skill gets the stack's products,
their coverage and the blocks' MUST and SHOULD requirements, never the name, email or organization.
The answer is stored in the stack record's `analysis` field on the submission branch.

The page polls with the random `analysis_id` from the submission. Responses:

- `200` `{"status": "pending" | "done" | "failed", "text": "<answer>" | null}`;
- `404` for an unknown ID; answers are kept in the service's memory for an hour.

A failed or slow review (over 90 seconds or 0.50 USD) is reported as `failed`; the stack is saved
either way.

