"""Hybrid retrieval endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.retrieval import RetrievalRequest, RetrievalResponse
from app.services.retrieval import get_retrieval_service

router = APIRouter(prefix="/retrieval", tags=["retrieval"])


@router.post(
    "/search",
    response_model=RetrievalResponse,
    summary="Dual-vector hybrid search (BM25 + semantic)",
)
async def search(
    payload: RetrievalRequest, db: AsyncSession = Depends(get_db)
) -> RetrievalResponse:
    return await get_retrieval_service().search(
        db,
        query=payload.query,
        document_ids=payload.document_ids,
        top_k=payload.top_k,
        semantic_weight=payload.semantic_weight,
        tlp_max=payload.tlp_max,
        min_score=payload.min_score,
    )
