# The catalog service for the deployed web app. Runs with the service account token from the
# INFRAHUB_API_TOKEN environment variable; no token is stored in the image. With ANTHROPIC_API_KEY set,
# it also runs the stack-review skill (skill_home/) on submitted stacks.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY catalog_web ./catalog_web
COPY skill_home ./skill_home

RUN useradd --system --no-create-home catalog
USER catalog

EXPOSE 8200
# Caddy is the only client that can reach the service, and it replaces X-Forwarded-For with the
# visitor's address, so the submission limit counts visitors and not Caddy.
CMD [".venv/bin/uvicorn", "catalog_web.main:app", "--host", "0.0.0.0", "--port", "8200", "--proxy-headers", "--forwarded-allow-ips", "*"]
