# AGENTS.md

Portable, vendor-neutral instructions for AI coding agents working in this repository.
This file is the **single source of truth**; each agent adapter (CLAUDE.md, .codex/)
routes back to it.

## Local Infrahub instance

This repository runs its own Infrahub instance with Docker Compose.

- `docker-compose.yml` is the file from <https://infrahub.opsmill.io>, unchanged. It sets the Infrahub version (1.12.1).
- `docker-compose.override.yml` sets the project name `infrahub-product-catalog` and publishes only the Infrahub web server, on port 8100. Set `INFRAHUB_PORT` to use another port. Other Infrahub instances on this machine can then keep port 8000.
- Start the instance with `docker compose up -d`, and stop it with `docker compose stop`. Do not pass `-p infrahub`: other stacks on this machine use that project name.

## Running infrahubctl

`infrahubctl` comes from the `infrahub-sdk[ctl]` package in the `dev` dependency group. Always run it through uv: `uv run infrahubctl <command>`. It is not installed on the PATH, so a bare `infrahubctl` command fails. This includes the `infrahubctl info` check in the Spec Kit Infrahub routing steps: run `uv run infrahubctl info` there.

- `infrahubctl.toml` sets the address to `http://localhost:8100`.
- Commands that change data need an API token. For the local instance, use the default admin token from `docker-compose.yml`: `export INFRAHUB_API_TOKEN=06438eb2-8019-4776-878c-0941b1f1d1ec`.
- Load files from this working copy with commands such as `uv run infrahubctl schema load schemas/`, `uv run infrahubctl menu load`, `uv run infrahubctl object load`, `uv run infrahubctl transform <name>`, `uv run infrahubctl render <name>`, `uv run infrahubctl generator <name>` and `uv run infrahubctl check <name>`.
- Load schema and object files on an Infrahub branch, for example `uv run infrahubctl schema load --branch <branch> schemas/` and `uv run infrahubctl object load --branch <branch> objects/`. Merge the branch into `main` through a proposed change, never with a direct branch merge, so that the checks run.

## Git repository connection

The instance reads this repository from GitHub as a read-only repository (`CoreReadOnlyRepository`, location `https://github.com/opsmill-holt/naf-product-catalog.git`, ref `main`). The registration is in `bootstrap/repository.yml`. See `dev/adr/0002-connect-repository-read-only.md`.

- `.infrahub.yml` lists checks and their queries, plus the coverage report transform and artifact. Infrahub runs these checks on every proposed change, and a failed check blocks the merge:
  - `catalog_source_check`: facts without a source, and sources due for review;
  - `catalog_submission_check`: on branches named `submission-*`, any record on `main` that was changed or deleted, and any added building block;
  - `catalog_duplicate_check`: publishers, products of one publisher, and source links whose names or links are the same once case, spaces, punctuation, `http`/`https` and a trailing `/` are ignored;
  - `catalog_coverage_check`: products that cover no building block, reported as warnings that do not block the merge;
  - `catalog_unused_source_check`: sources that support no product fact, coverage claim or requirement verdict;
  - `catalog_verdict_check`: requirement verdicts other than "not shown" that have no source, and verdicts for a requirement of another building block.
- The framework's requirements are in `objects/01_building_blocks.yml`, and each coverage claim's requirement verdicts in `objects/06_requirement_verdicts.yml`. A claim's full or partial coverage is computed from its verdicts and is not stored. The research and decisions behind the verdicts are in `dev/knowledge/naf-requirements-2026-10-23/`.
- Object files only add and update records. Deleting a product, claim or source on an Infrahub instance takes a script or the web interface, for example `dev/knowledge/naf-requirements-2026-10-23/apply_removals.py`.
- Schemas, object files and the sidebar menu (`menus/catalog.yml`) are not in `.infrahub.yml`, so the repository import never writes them to `main`. Load them with `infrahubctl` as described above. Nodes listed in the menu file have `include_in_menu: false` in the schema, so that they are not listed twice.
- Infrahub reads only what is pushed to `main` on GitHub. After a change to `checks/`, `queries/` or `.infrahub.yml` is pushed, open the repository in the Infrahub web interface and run **Import latest commit**.
- To run a check by hand before opening a proposed change: `uv run infrahubctl check <name> --branch <branch> --format-json`. Without `--format-json`, information messages (sources due for review, products with no coverage) are not shown when the check passes.
- Run the checks' tests with `uv run pytest tests/`.

## Web app

`frontend/` holds the public catalog web app: a React app in `frontend/web/` and a Python service in
`frontend/api/` that is the only part talking to Infrahub. See `frontend/README.md` for how to run
it and for the two problems that must be fixed before it is reachable from the internet. Never
commit `frontend/api/.env`: it holds the service account token.

<!-- TODO: author the rest of the project instructions here. -->
