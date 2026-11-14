"""Document ingestion and repository endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import Actor, PaginationParams
from app.api.serializers import chunk_out, document_detail, document_summary
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.document import Chunk, Document
from app.models.enums import DocumentStatus, SourceType, TLPLevel
from app.models.ioc import IOC
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.document import (
    ChunkOut,
    DocumentDetail,
    DocumentSummary,
    DocumentUpdate,
    DocumentUploadResponse,
)
from app.services.audit_service import record_event
from app.services.ingestion import get_ingestion_service

router = APIRouter(prefix="/documents", tags=["documents"])


def _filters(
    *,
    q: str | None,
    tlp: TLPLevel | None,
    source_type: SourceType | None,
    status_filter: DocumentStatus | None,
) -> list:
    conditions = []
    if q:
        like = f"%{q.strip()}%"
        conditions.append(
            or_(
                Document.title.ilike(like),
                Document.original_filename.ilike(like),
                Document.provenance.ilike(like),
            )
        )
    if tlp:
        conditions.append(Document.tlp == tlp)
    if source_type:
        conditions.append(Document.source_type == source_type)
    if status_filter:
        conditions.append(Document.status == status_filter)
    return conditions


@router.post(
    "",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and ingest CTI (PDF / TXT / Markdown)",
)
async def upload_document(
    file: Annotated[UploadFile, File(description="CTI file: .pdf, .txt, .md, .markdown")],
    actor: Actor,
    title: Annotated[str | None, Form(max_length=512)] = None,
    tlp: Annotated[TLPLevel, Form()] = TLPLevel.AMBER,
    provenance: Annotated[str | None, Form(max_length=512)] = None,
    authority_score: Annotated[float, Form(ge=0.0, le=1.0)] = 0.6,
    published_at: Annotated[datetime | None, Form()] = None,
    db: AsyncSession = Depends(get_db),
) -> DocumentUploadResponse:
    payload = await file.read()
    result = await get_ingestion_service().ingest(
        db,
        payload=payload,
        original_filename=file.filename or "upload.txt",
        content_type=file.content_type,
        title=title,
        tlp=tlp,
        provenance=provenance,
        authority_score=authority_score,
        published_at=published_at,
        actor=actor,
    )
    await record_event(
        db,
        actor=actor,
        action="document.ingested",
        entity_type="document",
        entity_id=str(result.document.id),
        summary=f"Ingested '{result.document.title}' with {result.chunks_created} chunks",
        details={
            "sha256": result.document.sha256,
            "tlp": tlp.value,
            "source_type": result.document.source_type.value,
            "chunks": result.chunks_created,
            "iocs": result.iocs_extracted,
            "mitre_candidates": result.mitre_candidates,
            "size_bytes": result.document.size_bytes,
        },
    )
    await db.commit()

    return DocumentUploadResponse(
        document=document_summary(
            result.document,
            chunk_count=result.chunks_created,
            ioc_count=result.iocs_extracted,
        ),
        chunks_created=result.chunks_created,
        iocs_extracted=result.iocs_extracted,
        mitre_candidates=result.mitre_candidates,
    )


@router.get("", response_model=PaginatedResponse[DocumentSummary], summary="List documents")
async def list_documents(
    pagination: PaginationParams,
    q: Annotated[str | None, Query(max_length=200)] = None,
    tlp: Annotated[TLPLevel | None, Query()] = None,
    source_type: Annotated[SourceType | None, Query()] = None,
    status_filter: Annotated[DocumentStatus | None, Query(alias="status")] = None,
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse[DocumentSummary]:
    conditions = _filters(q=q, tlp=tlp, source_type=source_type, status_filter=status_filter)

    chunk_count = (
        select(func.count(Chunk.id))
        .where(Chunk.document_id == Document.id)
        .correlate(Document)
        .scalar_subquery()
    )
    ioc_count = (
        select(func.count(IOC.id))
        .where(IOC.document_id == Document.id)
        .correlate(Document)
        .scalar_subquery()
    )
    stmt = (
        select(Document, chunk_count.label("chunk_count"), ioc_count.label("ioc_count"))
        .where(*conditions)
        .order_by(Document.created_at.desc())
        .offset(pagination.offset)
        .limit(pagination.page_size)
    )
    total = int(
        (
            await db.execute(select(func.count(Document.id)).where(*conditions))
        ).scalar_one()
    )
    rows = (await db.execute(stmt)).all()

    return PaginatedResponse[DocumentSummary](
        items=[
            document_summary(document, chunk_count=int(chunks), ioc_count=int(iocs))
            for document, chunks, iocs in rows
        ],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/{document_id}", response_model=DocumentDetail, summary="Get document and chunks")
async def get_document(
    document_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> DocumentDetail:
    document = (
        await db.execute(
            select(Document)
            .options(selectinload(Document.chunks))
            .where(Document.id == document_id)
        )
    ).scalar_one_or_none()
    if document is None:
        raise NotFoundError("Document not found.")

    ioc_count = int(
        (
            await db.execute(select(func.count(IOC.id)).where(IOC.document_id == document.id))
        ).scalar_one()
    )
    return document_detail(
        document, chunk_count=len(document.chunks), ioc_count=ioc_count
    )


@router.get(
    "/{document_id}/chunks",
    response_model=PaginatedResponse[ChunkOut],
    summary="Paginate document chunks",
)
async def list_chunks(
    document_id: uuid.UUID,
    pagination: PaginationParams,
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse[ChunkOut]:
    exists = (
        await db.execute(select(Document.id).where(Document.id == document_id))
    ).scalar_one_or_none()
    if exists is None:
        raise NotFoundError("Document not found.")

    total = int(
        (
            await db.execute(
                select(func.count(Chunk.id)).where(Chunk.document_id == document_id)
            )
        ).scalar_one()
    )
    chunks = (
        (
            await db.execute(
                select(Chunk)
                .where(Chunk.document_id == document_id)
                .order_by(Chunk.chunk_index)
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    return PaginatedResponse[ChunkOut](
        items=[chunk_out(chunk) for chunk in chunks],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.patch("/{document_id}", response_model=DocumentSummary, summary="Update document metadata")
async def update_document(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    actor: Actor,
    db: AsyncSession = Depends(get_db),
) -> DocumentSummary:
    document = (
        await db.execute(select(Document).where(Document.id == document_id))
    ).scalar_one_or_none()
    if document is None:
        raise NotFoundError("Document not found.")

    changes: dict[str, object] = {}
    if payload.title is not None:
        document.title = payload.title
        changes["title"] = payload.title
    if payload.tlp is not None:
        document.tlp = payload.tlp
        changes["tlp"] = payload.tlp.value
    if payload.provenance is not None:
        document.provenance = payload.provenance
        changes["provenance"] = payload.provenance
    if payload.authority_score is not None:
        document.authority_score = payload.authority_score
        changes["authority_score"] = payload.authority_score
    if payload.published_at is not None:
        document.published_at = payload.published_at
        changes["published_at"] = payload.published_at.isoformat()
    if payload.metadata is not None:
        document.doc_metadata = payload.metadata
        changes["metadata"] = payload.metadata

    await record_event(
        db,
        actor=actor,
        action="document.updated",
        entity_type="document",
        entity_id=str(document.id),
        summary=f"Updated metadata for '{document.title}'",
        details={"changes": changes},
    )
    await db.commit()

    chunk_count = int(
        (
            await db.execute(select(func.count(Chunk.id)).where(Chunk.document_id == document.id))
        ).scalar_one()
    )
    ioc_count = int(
        (
            await db.execute(select(func.count(IOC.id)).where(IOC.document_id == document.id))
        ).scalar_one()
    )
    return document_summary(document, chunk_count=chunk_count, ioc_count=ioc_count)


@router.delete("/{document_id}", response_model=MessageResponse, summary="Delete a document")
async def delete_document(
    document_id: uuid.UUID, actor: Actor, db: AsyncSession = Depends(get_db)
) -> MessageResponse:
    document = (
        await db.execute(select(Document).where(Document.id == document_id))
    ).scalar_one_or_none()
    if document is None:
        raise NotFoundError("Document not found.")

    title = document.title
    sha256 = document.sha256
    await record_event(
        db,
        actor=actor,
        action="document.deleted",
        entity_type="document",
        entity_id=str(document.id),
        summary=f"Deleted document '{title}'",
        details={"sha256": sha256},
    )
    await db.delete(document)
    await db.commit()
    return MessageResponse(message="Document deleted.")
