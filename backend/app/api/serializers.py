"""Shared API serialisers (keeps routers thin and responses consistent)."""

from __future__ import annotations

from app.models.answer import Claim, Generation
from app.models.document import Chunk, Document
from app.models.enums import VerificationStatus
from app.models.ioc import IOC
from app.schemas.document import ChunkOut, DocumentDetail, DocumentSummary
from app.schemas.gemini import ClaimOut
from app.schemas.ioc import IOCOut


def document_summary(
    document: Document, *, chunk_count: int = 0, ioc_count: int = 0
) -> DocumentSummary:
    return DocumentSummary(
        id=document.id,
        title=document.title,
        filename=document.filename,
        original_filename=document.original_filename,
        content_type=document.content_type,
        source_type=document.source_type,
        tlp=document.tlp,
        sha256=document.sha256,
        size_bytes=document.size_bytes,
        page_count=document.page_count,
        char_count=document.char_count,
        provenance=document.provenance,
        authority_score=document.authority_score,
        published_at=document.published_at,
        status=document.status,
        error_message=document.error_message,
        chunk_count=chunk_count,
        ioc_count=ioc_count,
        created_at=document.created_at,
        metadata=document.doc_metadata or {},
    )


def document_detail(
    document: Document, *, chunk_count: int, ioc_count: int
) -> DocumentDetail:
    base = document_summary(document, chunk_count=chunk_count, ioc_count=ioc_count)
    return DocumentDetail(
        **base.model_dump(),
        raw_text=document.raw_text,
        chunks=[ChunkOut.model_validate(chunk) for chunk in document.chunks],
    )


def ioc_out(ioc: IOC, document_title: str | None = None) -> IOCOut:
    return IOCOut(
        id=ioc.id,
        value=ioc.value,
        normalized_value=ioc.normalized_value,
        defanged=ioc.defanged,
        ioc_type=ioc.ioc_type,
        document_id=ioc.document_id,
        document_title=document_title,
        confidence=ioc.confidence,
        context=ioc.context,
        created_at=ioc.created_at,
    )


def claim_out(claim: Claim) -> ClaimOut:
    from uuid import UUID

    return ClaimOut(
        id=claim.id,
        claim_index=claim.claim_index,
        claim_text=claim.claim_text,
        status=claim.verification_status,
        confidence=claim.confidence,
        entailment_score=claim.entailment_score,
        rationale=claim.rationale,
        evidence_chunk_ids=[
            UUID(chunk_id) for chunk_id in (claim.evidence_chunk_ids or [])
        ],
    )


def generation_summary(generation: Generation) -> dict:
    claims = generation.claims or []
    supported = sum(
        1 for claim in claims if claim.verification_status is VerificationStatus.SUPPORTED
    )
    contradicted = sum(
        1 for claim in claims if claim.verification_status is VerificationStatus.CONTRADICTED
    )
    unresolved = len(claims) - supported - contradicted
    return {
        "id": generation.id,
        "question": generation.question,
        "answer_text": generation.answer_text,
        "model_used": generation.model_used,
        "degraded": generation.degraded,
        "injection_risk": generation.injection_risk,
        "trust_score": generation.trust_score,
        "latency_ms": generation.latency_ms,
        "evidence_count": len(generation.evidence_chunk_ids or []),
        "claims_total": len(claims),
        "claims_supported": supported,
        "claims_contradicted": contradicted,
        "claims_unresolved": unresolved,
        "created_at": generation.created_at,
    }


def chunk_out(chunk: Chunk) -> ChunkOut:
    return ChunkOut.model_validate(chunk)
