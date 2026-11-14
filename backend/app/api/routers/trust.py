"""Trust score endpoints (interactive weight tuning)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.answer import Generation
from app.models.enums import InjectionRisk
from app.schemas.trust import (
    TrustFactors,
    TrustScoreRequest,
    TrustScoreResponse,
    TrustThresholds,
    TrustWeights,
)
from app.services.trust_service import get_trust_engine

router = APIRouter(prefix="/trust", tags=["trust"])


@router.get("/weights", response_model=TrustWeights, summary="Default trust weights")
async def default_weights() -> TrustWeights:
    return get_trust_engine().default_weights()


@router.get("/thresholds", response_model=TrustThresholds, summary="Abstention thresholds")
async def thresholds() -> TrustThresholds:
    return TrustThresholds(
        abstain=settings.trust_abstain_threshold,
        review=settings.trust_review_threshold,
    )


@router.post("/score", response_model=TrustScoreResponse, summary="Compute weighted trust")
async def score_trust(
    payload: TrustScoreRequest, db: AsyncSession = Depends(get_db)
) -> TrustScoreResponse:
    engine = get_trust_engine()
    factors: TrustFactors | None = payload.factors
    evidence_count = 1
    injection_risk = InjectionRisk.LOW

    if payload.generation_id is not None:
        generation = (
            await db.execute(
                select(Generation).where(Generation.id == payload.generation_id)
            )
        ).scalar_one_or_none()
        if generation is None:
            raise NotFoundError("Generation not found.")
        breakdown = generation.trust_breakdown or {}
        stored_factors = breakdown.get("factors") or {}
        factors = TrustFactors(
            **{key: stored_factors.get(key, 0.5) for key in TrustFactors.model_fields}
        )
        evidence_count = len(generation.evidence_chunk_ids or [])
        try:
            injection_risk = InjectionRisk(generation.injection_risk)
        except ValueError:
            injection_risk = InjectionRisk.LOW

    if factors is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide factors or a generation_id.",
        )

    return engine.compute(
        factors,
        payload.weights,
        evidence_count=evidence_count,
        injection_risk=injection_risk,
    )
