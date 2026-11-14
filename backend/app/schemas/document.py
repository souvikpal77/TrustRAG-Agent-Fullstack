"""Document, chunk and ingestion schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.models.enums import DocumentStatus, SourceType, TLPLevel
from app.schemas.common import ORMModel


class ChunkOut(ORMModel):
    id: uuid.UUID
    document_id: uuid.UUID
    chunk_index: int
    text: str
    char_count: int
    token_estimate: int
    section_header: str | None = None
    page_start: int
    page_end: int


class DocumentSummary(ORMModel):
    id: uuid.UUID
    title: str
    filename: str
    original_filename: str
    content_type: str
    source_type: SourceType
    tlp: TLPLevel
    sha256: str
    size_bytes: int
    page_count: int
    char_count: int
    provenance: str
    authority_score: float
    published_at: datetime | None = None
    status: DocumentStatus
    error_message: str | None = None
    chunk_count: int = 0
    ioc_count: int = 0
    created_at: datetime
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("metadata", "doc_metadata"),
    )


class DocumentDetail(DocumentSummary):
    raw_text: str = ""
    chunks: list[ChunkOut] = Field(default_factory=list)


class DocumentUploadResponse(BaseModel):
    document: DocumentSummary
    chunks_created: int
    iocs_extracted: int
    mitre_candidates: int


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=512)
    tlp: TLPLevel | None = None
    provenance: str | None = Field(default=None, max_length=512)
    authority_score: float | None = Field(default=None, ge=0.0, le=1.0)
    published_at: datetime | None = None
    metadata: dict[str, Any] | None = None
