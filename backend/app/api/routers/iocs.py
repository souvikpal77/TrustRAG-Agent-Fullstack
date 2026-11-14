"""IOC repository, extraction and statistics endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, PaginationParams
from app.api.serializers import ioc_out
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.document import Chunk, Document
from app.models.enums import IOCType
from app.models.ioc import IOC
from app.schemas.ioc import (
    IOCExtractRequest,
    IOCExtractResponse,
    IOCExtractionPersistResponse,
    IOCListResponse,
    IOCStats,
)
from app.services.audit_service import record_event
from app.services.ioc_service import extract_iocs, persist_document_iocs

router = APIRouter(prefix="/iocs", tags=["iocs"])


async def _stats(db: AsyncSession) -> IOCStats:
    rows = (
        await db.execute(select(IOC.ioc_type, func.count(IOC.id)).group_by(IOC.ioc_type))
    ).all()
    by_type = {ioc_type.value: int(count) for ioc_type, count in rows}
    total = sum(by_type.values())
    documents_with_iocs = int(
        (
            await db.execute(
                select(func.count(func.distinct(IOC.document_id))).where(
                    IOC.document_id.is_not(None)
                )
            )
        ).scalar_one()
    )
    return IOCStats(
        total=total, by_type=by_type, documents_with_iocs=documents_with_iocs
    )


@router.get("", response_model=IOCListResponse, summary="List extracted indicators")
async def list_iocs(
    pagination: PaginationParams,
    ioc_type: IOCType | None = Query(default=None, alias="type"),
    q: str | None = Query(default=None, max_length=200),
    document_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> IOCListResponse:
    conditions = []
    if ioc_type:
        conditions.append(IOC.ioc_type == ioc_type)
    if document_id:
        conditions.append(IOC.document_id == document_id)
    if q:
        like = f"%{q.strip()}%"
        conditions.append(
            or_(IOC.normalized_value.ilike(like), IOC.value.ilike(like), IOC.context.ilike(like))
        )

    total = int(
        (await db.execute(select(func.count(IOC.id)).where(*conditions))).scalar_one()
    )
    rows = (
        await db.execute(
            select(IOC, Document.title)
            .outerjoin(Document, IOC.document_id == Document.id)
            .where(*conditions)
            .order_by(IOC.created_at.desc(), IOC.ioc_type)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()

    return IOCListResponse(
        items=[ioc_out(ioc, title) for ioc, title in rows],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        stats=await _stats(db),
    )


@router.get("/stats", response_model=IOCStats, summary="IOC distribution statistics")
async def ioc_stats(db: AsyncSession = Depends(get_db)) -> IOCStats:
    return await _stats(db)


@router.post(
    "/extract",
    response_model=IOCExtractResponse,
    summary="Extract indicators from ad-hoc text (no persistence)",
)
async def extract_from_text(payload: IOCExtractRequest) -> IOCExtractResponse:
    items = extract_iocs(payload.text)
    return IOCExtractResponse(count=len(items), items=items)


@router.post(
    "/documents/{document_id}/extract",
    response_model=IOCExtractionPersistResponse,
    summary="(Re-)extract and persist indicators for a document",
)
async def extract_for_document(
    document_id: uuid.UUID, actor: Actor, db: AsyncSession = Depends(get_db)
) -> IOCExtractionPersistResponse:
    document = (
        await db.execute(select(Document).where(Document.id == document_id))
    ).scalar_one_or_none()
    if document is None:
        raise NotFoundError("Document not found.")
    chunks = (
        (await db.execute(select(Chunk).where(Chunk.document_id == document.id)))
        .scalars()
        .all()
    )
    created, skipped = await persist_document_iocs(db, document, list(chunks))
    unique = extract_iocs("\n".join(chunk.text for chunk in chunks))
    await record_event(
        db,
        actor=actor,
        action="iocs.extracted",
        entity_type="document",
        entity_id=str(document.id),
        summary=f"Extracted {created} new indicators from '{document.title}'",
        details={"created": created, "skipped": skipped},
    )
    await db.commit()
    return IOCExtractionPersistResponse(
        document_id=document.id, created=created, updated=skipped, items=unique
    )
