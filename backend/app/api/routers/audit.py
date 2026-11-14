"""Immutable audit log endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import PaginationParams
from app.db.session import get_db
from app.models.audit import AuditLog
from app.schemas.audit import AuditLogListResponse, AuditLogOut, AuditVerifyResponse
from app.services.audit_service import verify_chain

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/logs", response_model=AuditLogListResponse, summary="List immutable audit events")
async def list_logs(
    pagination: PaginationParams,
    action: str | None = Query(default=None, max_length=128),
    entity_type: str | None = Query(default=None, max_length=64),
    entity_id: str | None = Query(default=None, max_length=128),
    db: AsyncSession = Depends(get_db),
) -> AuditLogListResponse:
    conditions = []
    if action:
        conditions.append(AuditLog.action == action)
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    if entity_id:
        conditions.append(AuditLog.entity_id == entity_id)

    total = int(
        (await db.execute(select(func.count(AuditLog.id)).where(*conditions))).scalar_one()
    )
    entries = (
        (
            await db.execute(
                select(AuditLog)
                .where(*conditions)
                .order_by(AuditLog.id.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
        )
        .scalars()
        .all()
    )
    return AuditLogListResponse(
        items=[AuditLogOut.model_validate(entry) for entry in entries],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get(
    "/verify",
    response_model=AuditVerifyResponse,
    summary="Verify the SHA-256 hash chain of the audit log",
)
async def verify(db: AsyncSession = Depends(get_db)) -> AuditVerifyResponse:
    valid, entries, broken_at, message, head_hash = await verify_chain(db)
    return AuditVerifyResponse(
        valid=valid,
        entries=entries,
        broken_at=broken_at,
        message=message,
        head_hash=head_hash,
    )
