"""System health and runtime metadata."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.mitre import MitreTechnique
from app.schemas.common import HealthResponse, RuntimeMetaResponse

router = APIRouter(tags=["system"])

# The liveness probe must return quickly even if the database is slow or locked.
_HEALTH_DB_TIMEOUT_SECONDS = 2.0


@router.get("/health", response_model=HealthResponse, summary="Liveness and DB readiness")
async def health(db: AsyncSession = Depends(get_db)) -> HealthResponse:
    """Liveness probe.

    Only a bounded ``SELECT 1`` is executed. This handler never calls Gemini or
    any other external service, so an in-flight LLM request can never delay the
    frontend's health poller.
    """
    database = "ok"
    try:
        await asyncio.wait_for(
            db.execute(text("SELECT 1")), timeout=_HEALTH_DB_TIMEOUT_SECONDS
        )
    except Exception:  # noqa: BLE001 - any probe failure means "unavailable"
        database = "unavailable"

    return HealthResponse(
        status="ok" if database == "ok" else "degraded",
        database=database,
        version=settings.version,
        environment=settings.environment,
        gemini_configured=settings.gemini_enabled,
        offline_fallback=settings.allow_offline_llm_fallback,
    )


@router.get("/meta", response_model=RuntimeMetaResponse, summary="Non-secret runtime configuration")
async def meta(db: AsyncSession = Depends(get_db)) -> RuntimeMetaResponse:
    technique_count = 0
    try:
        technique_count = int(
            (await db.execute(select(func.count(MitreTechnique.technique_id)))).scalar_one()
        )
    except Exception:  # noqa: BLE001
        technique_count = 0

    return RuntimeMetaResponse(
        app_name=settings.app_name,
        version=settings.version,
        environment=settings.environment,
        gemini_configured=settings.gemini_enabled,
        gemini_models=settings.gemini_model_list,
        embedding_provider=settings.embedding_provider,
        chunking={
            "chunk_size": settings.chunk_size,
            "chunk_overlap": settings.chunk_overlap,
            "min_chunk_size": settings.chunk_min_size,
        },
        retrieval={
            "default_top_k": settings.retrieval_default_top_k,
            "semantic_weight": settings.retrieval_semantic_weight,
            "bm25_k1": settings.retrieval_bm25_k1,
            "bm25_b": settings.retrieval_bm25_b,
        },
        trust={
            "weights": settings.default_trust_weights,
            "abstain_threshold": settings.trust_abstain_threshold,
            "review_threshold": settings.trust_review_threshold,
            "support_threshold": settings.entailment_support_threshold,
        },
        mitre_techniques=technique_count,
    )
