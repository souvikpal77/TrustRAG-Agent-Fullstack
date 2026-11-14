"""MITRE ATT&CK matrix, mapping and analyst validation endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import Actor, PaginationParams
from app.core.exceptions import NotFoundError, ValidationAppError
from app.db.session import get_db
from app.models.document import Document
from app.models.enums import CandidateStatus
from app.models.mitre import MitreCandidate, MitreTechnique
from app.schemas.mitre import (
    CandidateDecisionRequest,
    MitreCandidateListResponse,
    MitreCandidateOut,
    MitreMapRequest,
    MitreMapResponse,
    MitreMatrixResponse,
    MitreStatsResponse,
)
from app.services.audit_service import record_event
from app.services.mitre_service import list_matrix, map_document, serialize_candidate

router = APIRouter(prefix="/mitre", tags=["mitre"])

_CANDIDATE_OPTIONS = (
    selectinload(MitreCandidate.document),
    selectinload(MitreCandidate.technique).selectinload(MitreTechnique.tactic),
)


@router.get("/matrix", response_model=MitreMatrixResponse, summary="ATT&CK Enterprise matrix")
async def matrix(db: AsyncSession = Depends(get_db)) -> MitreMatrixResponse:
    return await list_matrix(db)


@router.get(
    "/candidates",
    response_model=MitreCandidateListResponse,
    summary="List ATT&CK candidates for analyst validation",
)
async def list_candidates(
    pagination: PaginationParams,
    status_filter: CandidateStatus | None = Query(default=None, alias="status"),
    document_id: uuid.UUID | None = None,
    technique_id: str | None = Query(default=None, max_length=16),
    db: AsyncSession = Depends(get_db),
) -> MitreCandidateListResponse:
    conditions = []
    if status_filter:
        conditions.append(MitreCandidate.status == status_filter)
    if document_id:
        conditions.append(MitreCandidate.document_id == document_id)
    if technique_id:
        conditions.append(MitreCandidate.technique_id == technique_id)

    total = int(
        (
            await db.execute(select(func.count(MitreCandidate.id)).where(*conditions))
        ).scalar_one()
    )
    candidates = (
        (
            await db.execute(
                select(MitreCandidate)
                .options(*_CANDIDATE_OPTIONS)
                .where(*conditions)
                .order_by(MitreCandidate.status, MitreCandidate.confidence.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    return MitreCandidateListResponse(
        items=[serialize_candidate(candidate) for candidate in candidates],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post(
    "/map",
    response_model=MitreMapResponse,
    summary="Map a document to candidate ATT&CK techniques",
)
async def map_document_endpoint(
    payload: MitreMapRequest, actor: Actor, db: AsyncSession = Depends(get_db)
) -> MitreMapResponse:
    document = (
        await db.execute(select(Document).where(Document.id == payload.document_id))
    ).scalar_one_or_none()
    if document is None:
        raise NotFoundError("Document not found.")

    candidates = await map_document(
        db,
        document,
        max_candidates=payload.max_candidates,
        replace_existing=payload.replace_existing,
    )
    await record_event(
        db,
        actor=actor,
        action="mitre.mapped",
        entity_type="document",
        entity_id=str(document.id),
        summary=f"Generated {len(candidates)} ATT&CK candidates for '{document.title}'",
        details={
            "candidate_count": len(candidates),
            "replace_existing": payload.replace_existing,
            "techniques": [candidate.technique_id for candidate in candidates][:30],
        },
    )
    await db.commit()

    return MitreMapResponse(
        document_id=document.id,
        created=len(candidates),
        candidates=[serialize_candidate(candidate) for candidate in candidates],
    )


@router.patch(
    "/candidates/{candidate_id}",
    response_model=MitreCandidateOut,
    summary="Approve or reject an ATT&CK candidate",
)
async def decide_candidate(
    candidate_id: uuid.UUID,
    payload: CandidateDecisionRequest,
    actor: Actor,
    db: AsyncSession = Depends(get_db),
) -> MitreCandidateOut:
    if payload.status is CandidateStatus.PENDING:
        raise ValidationAppError("Decision must be APPROVED or REJECTED.")
    candidate = (
        await db.execute(
            select(MitreCandidate)
            .options(*_CANDIDATE_OPTIONS)
            .where(MitreCandidate.id == candidate_id)
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise NotFoundError("ATT&CK candidate not found.")

    candidate.status = payload.status
    candidate.reviewed_by = payload.reviewed_by or actor
    candidate.reviewed_at = datetime.now(timezone.utc)
    await record_event(
        db,
        actor=actor,
        action=f"mitre.candidate_{payload.status.value.lower()}",
        entity_type="mitre_candidate",
        entity_id=str(candidate.id),
        summary=(
            f"{payload.status.value.title()} {candidate.technique_id} "
            f"for document {candidate.document_id}"
        ),
        details={
            "technique_id": candidate.technique_id,
            "document_id": str(candidate.document_id),
            "confidence": candidate.confidence,
            "note": payload.note,
            "reviewed_by": candidate.reviewed_by,
        },
    )
    await db.commit()
    return serialize_candidate(candidate)


@router.get("/stats", response_model=MitreStatsResponse, summary="Candidate validation statistics")
async def mitre_stats(db: AsyncSession = Depends(get_db)) -> MitreStatsResponse:
    rows = (
        await db.execute(
            select(MitreCandidate.status, func.count(MitreCandidate.id)).group_by(
                MitreCandidate.status
            )
        )
    ).all()
    counts = {status.value: int(count) for status, count in rows}
    top_rows = (
        await db.execute(
            select(
                MitreTechnique.technique_id,
                MitreTechnique.name,
                func.count(MitreCandidate.id).label("count"),
            )
            .join(MitreCandidate, MitreCandidate.technique_id == MitreTechnique.technique_id)
            .group_by(MitreTechnique.technique_id, MitreTechnique.name)
            .order_by(func.count(MitreCandidate.id).desc())
            .limit(8)
        )
    ).all()
    return MitreStatsResponse(
        pending=counts.get("PENDING", 0),
        approved=counts.get("APPROVED", 0),
        rejected=counts.get("REJECTED", 0),
        top_techniques=[
            {"technique_id": row[0], "name": row[1], "count": int(row[2])} for row in top_rows
        ],
    )
