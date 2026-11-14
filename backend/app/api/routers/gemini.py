"""Evidence-grounded Gemini generation and claim verification endpoints."""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, PaginationParams
from app.api.serializers import claim_out, generation_summary
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.answer import Generation
from app.models.document import Chunk, Document
from app.models.enums import InjectionRisk
from app.schemas.gemini import (
    ClaimOut,
    GenerateRequest,
    GenerateResponse,
    GenerationDetail,
    GenerationListResponse,
    GenerationSummary,
    VerifyClaimsRequest,
    VerifyClaimsResponse,
)
from app.schemas.retrieval import RetrievedChunk
from app.schemas.trust import TrustFactors, TrustScoreResponse
from app.services.audit_service import record_event
from app.services.claim_service import (
    ClaimVerifier,
    evidence_from_retrieved,
    evidence_from_snapshot,
    get_claim_verifier,
)
from app.services.injection import assess_injection
from app.services.rag_service import (
    RAGService,
    citation_coverage,
    factors_or_default,
    get_rag_service,
)
from app.services.retrieval import get_retrieval_service
from app.services.trust_service import get_trust_engine

router = APIRouter(prefix="/gemini", tags=["gemini"])


async def _load_document_factor_rows(
    db: AsyncSession, document_ids: list[uuid.UUID]
) -> list[tuple]:
    unique_ids = list({document_id for document_id in document_ids})
    if not unique_ids:
        return []
    documents = (
        (await db.execute(select(Document).where(Document.id.in_(unique_ids))))
        .scalars()
        .all()
    )
    return [
        (document.source_type, document.provenance, document.authority_score, document.published_at)
        for document in documents
    ]


async def _evidence_from_ids(
    db: AsyncSession, chunk_ids: list[uuid.UUID]
) -> list[RetrievedChunk]:
    if not chunk_ids:
        return []
    rows = (
        await db.execute(
            select(Chunk, Document)
            .join(Document, Chunk.document_id == Document.id)
            .where(Chunk.id.in_(chunk_ids))
        )
    ).all()
    by_id = {chunk.id: (chunk, document) for chunk, document in rows}
    results: list[RetrievedChunk] = []
    for chunk_id in chunk_ids:
        pair = by_id.get(chunk_id)
        if pair is None:
            continue
        chunk, document = pair
        results.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                document_id=document.id,
                document_title=document.title,
                tlp=document.tlp,
                section_header=chunk.section_header,
                page_start=chunk.page_start,
                page_end=chunk.page_end,
                text=chunk.text,
                bm25_score=0.0,
                semantic_score=0.0,
                hybrid_score=0.0,
                document_authority=document.authority_score,
                rank=len(results) + 1,
            )
        )
    return results


async def _resolve_evidence(
    db: AsyncSession,
    *,
    payload: VerifyClaimsRequest,
    generation: Generation | None,
    answer: str,
    question: str,
) -> list[RetrievedChunk]:
    if payload.evidence_chunk_ids:
        evidence = await _evidence_from_ids(db, payload.evidence_chunk_ids)
        if evidence:
            return evidence
    if generation is not None and generation.evidence_snapshot:
        snapshot = [RetrievedChunk.model_validate(raw) for raw in generation.evidence_snapshot]
        if snapshot:
            return snapshot
    query = (question or answer)[:500]
    if not query.strip():
        return []
    document_ids = payload.document_ids or [
        uuid.UUID(value) for value in (generation.document_ids if generation else []) if value
    ]
    result = await get_retrieval_service().search(
        db, query=query, document_ids=document_ids, top_k=8
    )
    return result.results


@router.post(
    "/generate",
    response_model=GenerateResponse,
    summary="Generate an evidence-grounded answer with trust scoring",
)
async def generate(
    payload: GenerateRequest,
    actor: Actor,
    db: AsyncSession = Depends(get_db),
) -> GenerateResponse:
    response = await get_rag_service().ask(db, payload, persist=payload.persist)
    await record_event(
        db,
        actor=actor,
        action="gemini.generated",
        entity_type="generation",
        entity_id=str(response.generation_id) if response.generation_id else None,
        summary=f"Generated answer for: {payload.question[:120]}",
        details={
            "model": response.model_used,
            "degraded": response.degraded,
            "trust_score": response.trust.score,
            "trust_band": response.trust.band.value,
            "evidence_count": len(response.evidence),
            "injection_risk": response.injection.risk.value,
            "document_ids": [str(document_id) for document_id in payload.document_ids],
        },
    )
    await db.commit()
    return response


@router.post(
    "/verify-claims",
    response_model=VerifyClaimsResponse,
    summary="Decompose an answer into atomic claims and verify each against evidence",
)
async def verify_claims(
    payload: VerifyClaimsRequest,
    actor: Actor,
    db: AsyncSession = Depends(get_db),
) -> VerifyClaimsResponse:
    started = time.perf_counter()
    generation: Generation | None = None
    if payload.generation_id is not None:
        generation = (
            await db.execute(select(Generation).where(Generation.id == payload.generation_id))
        ).scalar_one_or_none()
        if generation is None:
            raise NotFoundError("Generation not found.")
        answer = generation.answer_text
        question = payload.question or generation.question
    else:
        answer = payload.answer or ""
        question = payload.question or ""

    evidence = await _resolve_evidence(
        db, payload=payload, generation=generation, answer=answer, question=question
    )
    verifier: ClaimVerifier = get_claim_verifier()
    outcome = await verifier.verify(
        answer=answer,
        evidence=evidence_from_retrieved(evidence),
        question=question,
        generation=generation,
        persist=bool(payload.persist and generation is not None),
    )

    trust_engine = get_trust_engine()
    trust: TrustScoreResponse | None = None
    injection = assess_injection(question, [item.text for item in evidence])
    if generation is not None:
        breakdown = generation.trust_breakdown or {}
        base_factors = factors_or_default(breakdown.get("factors"))
        factors = base_factors.model_copy(update={"entailment": outcome.entailment})
        try:
            injection_risk = InjectionRisk(generation.injection_risk)
        except ValueError:
            injection_risk = InjectionRisk.LOW
        trust = trust_engine.compute(
            factors,
            evidence_count=len(evidence),
            injection_risk=injection_risk,
            extra_flags=["verification_abstained"] if outcome.summary.abstained else [],
        )
        generation.trust_score = trust.score
        generation.trust_breakdown = trust.model_dump(mode="json")
    else:
        coverage = citation_coverage(answer, len(evidence))
        relevance = (
            sum(item.hybrid_score for item in evidence[:3]) / max(1, min(3, len(evidence)))
        )
        documents = await _load_document_factor_rows(
            db, [item.document_id for item in evidence]
        )
        trust = trust_engine.compute(
            trust_engine.combine_document_factors(
                documents,
                relevance=relevance,
                entailment=outcome.entailment,
                model_confidence=round(0.5 * coverage + 0.5 * relevance, 4),
            ),
            evidence_count=len(evidence),
            injection_risk=injection.risk,
            extra_flags=["verification_abstained"] if outcome.summary.abstained else [],
        )

    await record_event(
        db,
        actor=actor,
        action="claims.verified",
        entity_type="generation" if generation else "answer",
        entity_id=str(generation.id) if generation else None,
        summary=(
            f"Verified {outcome.summary.total} claims: {outcome.summary.supported} supported, "
            f"{outcome.summary.contradicted} contradicted, {outcome.summary.unresolved} unresolved"
        ),
        details={
            "supported": outcome.summary.supported,
            "contradicted": outcome.summary.contradicted,
            "unresolved": outcome.summary.unresolved,
            "abstained": outcome.summary.abstained,
            "model": outcome.model_used,
            "degraded": outcome.degraded,
        },
    )
    await db.commit()

    return VerifyClaimsResponse(
        generation_id=generation.id if generation else None,
        claims=outcome.claims,
        summary=outcome.summary,
        trust=trust,
        model_used=outcome.model_used,
        degraded=outcome.degraded,
        elapsed_ms=round((time.perf_counter() - started) * 1000, 2),
    )


@router.get(
    "/generations",
    response_model=GenerationListResponse,
    summary="List persisted generations",
)
async def list_generations(
    pagination: PaginationParams,
    q: str | None = Query(default=None, max_length=200),
    db: AsyncSession = Depends(get_db),
) -> GenerationListResponse:
    conditions = []
    if q:
        conditions.append(Generation.question.ilike(f"%{q.strip()}%"))
    total = int(
        (
            await db.execute(select(func.count(Generation.id)).where(*conditions))
        ).scalar_one()
    )
    generations = (
        (
            await db.execute(
                select(Generation)
                .where(*conditions)
                .order_by(Generation.created_at.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    items = [GenerationSummary(**generation_summary(generation)) for generation in generations]
    return GenerationListResponse(
        items=items, total=total, page=pagination.page, page_size=pagination.page_size
    )


@router.get(
    "/generations/{generation_id}",
    response_model=GenerationDetail,
    summary="Get a generation with claims and evidence snapshot",
)
async def get_generation(
    generation_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> GenerationDetail:
    generation = (
        await db.execute(select(Generation).where(Generation.id == generation_id))
    ).scalar_one_or_none()
    if generation is None:
        raise NotFoundError("Generation not found.")

    evidence = [
        RetrievedChunk.model_validate(raw) for raw in (generation.evidence_snapshot or [])
    ]
    trust = None
    if generation.trust_breakdown:
        try:
            trust = TrustScoreResponse.model_validate(generation.trust_breakdown)
        except Exception:  # noqa: BLE001 - legacy payload tolerance
            trust = None

    return GenerationDetail(
        **generation_summary(generation),
        claims=[claim_out(claim) for claim in generation.claims],
        evidence=evidence,
        trust=trust,
    )
