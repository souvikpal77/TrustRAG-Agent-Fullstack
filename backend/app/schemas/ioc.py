"""IOC schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field

from app.models.enums import IOCType
from app.schemas.common import ORMModel


class IOCOut(ORMModel):
    id: uuid.UUID
    value: str
    normalized_value: str
    defanged: str
    ioc_type: IOCType
    document_id: uuid.UUID | None = None
    document_title: str | None = None
    confidence: float
    context: str
    created_at: datetime


class IOCStats(BaseModel):
    total: int
    by_type: dict[str, int]
    documents_with_iocs: int


class IOCListResponse(BaseModel):
    items: list[IOCOut]
    total: int
    page: int
    page_size: int
    stats: IOCStats


class ExtractedIOC(BaseModel):
    value: str
    normalized_value: str
    defanged: str
    ioc_type: IOCType
    confidence: float
    context: str = ""


class IOCExtractRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    defang: bool = True


class IOCExtractResponse(BaseModel):
    count: int
    items: list[ExtractedIOC]


class IOCDocumentSummary(BaseModel):
    document_id: uuid.UUID | None
    document_title: str = "Ad-hoc extraction"
    count: int = 0


class IOCExtractionPersistResponse(BaseModel):
    document_id: uuid.UUID | None = None
    created: int
    updated: int
    items: list[ExtractedIOC]


class IOCBulkItem(BaseModel):
    ioc_type: IOCType
    defanged: str
    count: int = Field(ge=0)
    percentage: float = Field(ge=0.0, le=100.0)
