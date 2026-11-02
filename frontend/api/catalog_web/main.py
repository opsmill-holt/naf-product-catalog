"""The catalog web service: read the catalog, and submit products and automation stacks for review."""

import logging

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from infrahub_sdk.exceptions import Error as InfrahubError

from catalog_web import analysis
from catalog_web.catalog import CatalogCache
from catalog_web.infrahub import get_client
from catalog_web.limits import SubmissionLimit
from catalog_web.stacks import Stack, submit_stack
from catalog_web.submissions import Submission, SubmissionError, submit

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Catalog web service", docs_url=None, redoc_url=None, openapi_url=None)
cache = CatalogCache()
limit = SubmissionLimit()
analyses = analysis.Analyses()

UNAVAILABLE = "The catalog is not available right now. Try again later."
TOO_MANY = "Too many submissions were sent in the last hour. Nothing was created. Please try again later."


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/catalog")
async def catalog() -> dict:
    try:
        return await cache.get(get_client())
    except (httpx.HTTPError, InfrahubError):
        logger.exception("reading the catalog failed")
        raise HTTPException(status_code=503, detail=UNAVAILABLE)


@app.post("/api/submissions", status_code=201)
async def submissions(submission: Submission, request: Request) -> dict[str, str]:
    address = request.client.host if request.client else "unknown"
    if not limit.allow(address):
        logger.warning("submission refused: over the limit for %s or in total", address)
        return JSONResponse(status_code=429, content={"detail": TOO_MANY})
    try:
        reference = await submit(get_client(), submission)
    except SubmissionError as error:
        return JSONResponse(status_code=error.status_code, content={"detail": error.message})
    except (httpx.HTTPError, InfrahubError):
        logger.exception("saving a submission failed")
        return JSONResponse(
            status_code=502,
            content={"detail": "Your submission was not saved. Nothing was created. Please try again."},
        )
    return {"reference": reference}


@app.post("/api/stacks", status_code=201)
async def stacks(stack: Stack, request: Request) -> dict[str, str]:
    address = request.client.host if request.client else "unknown"
    if not limit.allow(address):
        logger.warning("stack refused: over the limit for %s or in total", address)
        return JSONResponse(status_code=429, content={"detail": TOO_MANY})
    try:
        reference = await submit_stack(get_client(), stack)
    except SubmissionError as error:
        return JSONResponse(status_code=error.status_code, content={"detail": error.message})
    except (httpx.HTTPError, InfrahubError):
        logger.exception("saving a stack failed")
        return JSONResponse(
            status_code=502,
            content={"detail": "Your stack was not saved. Nothing was created. Please try again."},
        )
    response = {"reference": reference}
    if analysis.enabled():
        # The stack is saved; a failure to start the review must not turn the submission into an error.
        try:
            catalog_data = await cache.get(get_client())
            facts = analysis.build_input(catalog_data, stack.products, stack.no_tool_blocks)
            response["analysis_id"] = analyses.start(get_client(), reference, facts)
        except Exception:
            logger.exception("could not start the stack review for %s", reference)
    return response


@app.get("/api/analyses/{analysis_id}")
async def stack_analysis(analysis_id: str) -> dict[str, str | None]:
    item = analyses.get(analysis_id)
    if item is None:
        raise HTTPException(status_code=404, detail="No review with this ID. Reviews are kept for an hour.")
    return {"status": item.status, "text": item.text}
