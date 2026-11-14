"""Audit log schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.schemas.common import ORMModel


class AuditLogOut(ORMModel):
    id: int
    actor: str
    action: str
    entity_type: str
    entity_id: str | None = None
    summary: str
    details: dict[str, Any]
    prev_hash: str
    entry_hash: str
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int


class AuditVerifyResponse(BaseModel):
    valid: bool
    entries: int
    broken_at: int | None = None
    message: str
    head_hash: str | None = None
