"""Hybrid retrieval schemas."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.models.enums import TLPLevel


class RetrievalRequest(BaseModel):
    query: str = Field(min_length=2, max_length=4000)
    document_ids: list[uuid.UUID] = Field(default_factory=list)
    top_k: int = Field(default=8, ge=1, le=50)
    semantic_weight: float = Field(default=0.6, ge=0.0, le=1.0)
    tlp_max: TLPLevel | None = None
    min_score: float = Field(default=0.0, ge=0.0, le=1.0)
    expand_query: bool = False


class RetrievedChunk(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    tlp: TLPLevel
    section_header: str | None = None
    page_start: int
    page_end: int
    text: str
    bm25_score: float
    semantic_score: float
    hybrid_score: float
    document_authority: float
    rank: int


class RetrievalResponse(BaseModel):
    query: str
    semantic_weight: float
    keyword_weight: float
    candidate_chunks: int
    matched_terms: list[str]
    results: list[RetrievedChunk]
    elapsed_ms: float
