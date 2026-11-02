# Contract: Catalog Web Service API

Base path `/api`. JSON only. No authentication, so the service exposes nothing else.

| Method | Path | Purpose | Responses |
|--------|------|---------|-----------|
| GET | `/api/catalog` | The catalog on `main` ([data-model.md](../data-model.md)) | `200`, `503` when Infrahub is unreachable |
| POST | `/api/submissions` | Submit a product | `201`, `409`, `422`, `502`, `503` |
| POST | `/api/stacks` | Submit the products one visitor uses (their automation stack) | `201`, `422`, `429`, `502` |
| GET | `/api/health` | Liveness for deployment | `200` |

Configuration (environment variables, never committed):

| Variable | Meaning |
|----------|---------|
| `INFRAHUB_ADDRESS` | Infrahub URL, `http://localhost:8100` in development |
| `INFRAHUB_API_TOKEN` | The `catalog-web` service account token |
| `CATALOG_CACHE_SECONDS` | Catalog cache lifetime, default 60 |

## POST /api/stacks

Request body. `products` holds full names as `/api/catalog` returns them, at least 1 and at most 200,
each once. `name`, `email` and `organization` are optional; an empty string is the same as leaving
the field out.

```json
{ "products": ["Cisco Crosswork Network Services Orchestrator (NSO)"], "name": "", "email": "", "organization": "Example Net" }
```

The service creates a branch named `submission-<date>-<random>` with one `CatalogAutomationStack`
record and opens a proposed change named "Automation stack: <organization, else name, else
anonymous> (<n> products)". Maintainers merge it after review. Responses:

- `201` `{"reference": "<branch name>"}`;
- `422` when a product is not in the catalog on `main`, or the body is not valid;
- `429` over the submission limit, which `/api/submissions` and `/api/stacks` share;
- `502` when Infrahub could not store it; nothing is left behind.

The web app keeps the visitor's marked products in local storage (`catalog.myTools`) until they
submit them. Stacks are not part of `/api/catalog`.

