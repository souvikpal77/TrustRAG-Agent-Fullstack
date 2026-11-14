"""TrustRAG-Agent – FastAPI application factory."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routers import (
    audit,
    dashboard,
    documents,
    evaluation,
    gemini,
    health,
    iocs,
    mitre,
    retrieval,
    trust,
)
from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging, set_request_id
from app.db.base import Base
from app.db.session import AsyncSessionLocal, dispose_engine, engine, get_db
from app.models import __all__ as _model_registry  # noqa: F401 - registers ORM models
from app.schemas.common import HealthResponse
from app.services.gemini_service import get_gemini_service
from app.services.mitre_service import seed_catalog

logger = logging.getLogger(__name__)

configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info(
        "Starting %s v%s (env=%s, gemini=%s)",
        settings.app_name,
        settings.version,
        settings.environment,
        "configured" if settings.gemini_enabled else "not-configured",
    )
    try:
        if settings.auto_create_schema:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            logger.info("Schema ensured via SQLAlchemy metadata (AUTO_CREATE_SCHEMA=true)")

        if settings.seed_mitre:
            async with AsyncSessionLocal() as session:
                count = await seed_catalog(session)
                await session.commit()
            logger.info("MITRE ATT&CK catalog ready (%s techniques)", count)

        # Warm one pooled connection so the first health probe is not delayed by
        # database connection setup (SQLite file open / PostgreSQL handshake).
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        logger.info("Database connection pool warmed")

        if settings.gemini_enabled:
            # Import/build the SDK before serving traffic so the first request
            # cannot block the event loop (and the /health poller) for seconds.
            warmed = await asyncio.to_thread(get_gemini_service().prewarm)
            logger.info(
                "Gemini client %s",
                "pre-warmed" if warmed else "unavailable (offline fallback remains active)",
            )
    except Exception:
        logger.exception(
            "Startup initialisation could not complete. The API will start in a degraded state; "
            "ensure migrations have run and PostgreSQL is reachable."
        )

    yield
    await dispose_engine()
    logger.info("Shutdown complete")


app = FastAPI(
    title="TrustRAG-Agent API",
    version=settings.version,
    description=(
        "Evidence-grounded CTI RAG with claim verification, multi-factor trust scoring, "
        "IOC extraction, MITRE ATT&CK validation and a 3-way evaluation centre."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# Browser dev origins are always permitted so the Vite app can reach the API
# whether it is opened as localhost or 127.0.0.1. Additional origins come from
# CORS_ORIGINS in the environment.
_CORS_ORIGINS = list(
    dict.fromkeys(
        [
            *settings.cors_origin_list,
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = set_request_id(request.headers.get("X-Request-ID"))
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled error on %s %s (request_id=%s)",
            request.method,
            request.url.path,
            request_id,
        )
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "%s %s -> %s in %.1fms",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "code": exc.code,
            "context": jsonable_encoder(exc.context),
            "request_id": request.headers.get("X-Request-ID"),
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = exc.errors()
    first = errors[0] if errors else {}
    location = " → ".join(str(part) for part in first.get("loc", []))
    message = first.get("msg", "Invalid request payload")
    detail = f"{location}: {message}" if location else message
    return JSONResponse(
        status_code=422,
        content={
            "detail": detail,
            "code": "validation_error",
            "errors": json.loads(jsonable_encoder_json(errors)),
            "request_id": request.headers.get("X-Request-ID"),
        },
    )


def jsonable_encoder_json(value: object) -> str:
    from fastapi.encoders import jsonable_encoder as encode

    return json.dumps(encode(value), default=str)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "code": "http_error",
            "request_id": request.headers.get("X-Request-ID"),
        },
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An unexpected server error occurred. Quote the request ID to support.",
            "code": "internal_error",
            "request_id": request.headers.get("X-Request-ID"),
        },
    )


for router in (
    health.router,
    documents.router,
    retrieval.router,
    gemini.router,
    trust.router,
    iocs.router,
    mitre.router,
    audit.router,
    evaluation.router,
    dashboard.router,
):
    app.include_router(router, prefix=settings.api_prefix)


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["system"],
    summary="Root-level health alias",
    include_in_schema=False,
)
async def health_alias(db: AsyncSession = Depends(get_db)) -> HealthResponse:
    """Backward-compatible liveness probe; identical to ``GET /api/health``."""
    return await health.health(db)


@app.get("/api/ready", tags=["system"], summary="Readiness probe")
async def ready() -> dict[str, object]:
    database = "ok"
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        database = "unavailable"
    return {
        "status": "ready" if database == "ok" else "degraded",
        "database": database,
        "version": settings.version,
    }


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "version": settings.version,
        "docs": "/docs",
        "health": f"{settings.api_prefix}/health",
    }
