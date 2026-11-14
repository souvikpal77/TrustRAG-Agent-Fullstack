"""Gemini generation + claim verification schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.models.enums import InjectionRisk, TLPLevel, VerificationStatus
from app.schemas.retrieval import RetrievedChunk
from app.schemas.trust import TrustScoreResponse


class InjectionMatch(BaseModel):
    pattern: str
    label: str
    location: Literal["QUESTION", "EVIDENCE"]
    excerpt: str


class InjectionAssessment(BaseModel):
    risk: InjectionRisk
    score: float = Field(ge=0.0, le=1.0)
    matches: list[InjectionMatch] = Field(default_factory=list)
    sanitized: bool = False


class GenerateRequest(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    document_ids: list[uuid.UUID] = Field(default_factory=list)
    top_k: int = Field(default=8, ge=1, le=20)
    semantic_weight: float = Field(default=0.6, ge=0.0, le=1.0)
    tlp_max: TLPLevel | None = None
    persist: bool = True
    model: str | None = Field(default=None, max_length=128)


class GenerateResponse(BaseModel):
    generation_id: uuid.UUID | None = None
    question: str
    answer: str
    model_used: str
    degraded: bool
    latency_ms: float
    evidence: list[RetrievedChunk]
    injection: InjectionAssessment
    trust: TrustScoreResponse
    citation_coverage: float = Field(ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)


class EvidenceRef(BaseModel):
    chunk_id: uuid.UUID
    marker: str


class ClaimOut(BaseModel):
    id: uuid.UUID | None = None
    claim_index: int
    claim_text: str
    status: VerificationStatus
    confidence: float = Field(ge=0.0, le=1.0)
    entailment_score: float = Field(ge=0.0, le=1.0)
    rationale: str
    evidence_chunk_ids: list[uuid.UUID] = Field(default_factory=list)


class VerificationSummary(BaseModel):
    total: int
    supported: int
    contradicted: int
    unresolved: int
    supported_ratio: float
    contradicted_ratio: float
    unresolved_ratio: float
    verification_ratio: float
    abstained: bool
    abstention_reason: str | None = None


class VerifyClaimsRequest(BaseModel):
    generation_id: uuid.UUID | None = None
    answer: str | None = Field(default=None, min_length=5)
    question: str | None = Field(default=None, max_length=4000)
    evidence_chunk_ids: list[uuid.UUID] = Field(default_factory=list)
    document_ids: list[uuid.UUID] = Field(default_factory=list)
    persist: bool = True

    @model_validator(mode="after")
    def _require_answer_source(self) -> "VerifyClaimsRequest":
        if self.generation_id is None and not self.answer:
            raise ValueError("Provide either generation_id or answer")
        return self


class VerifyClaimsResponse(BaseModel):
    generation_id: uuid.UUID | None = None
    claims: list[ClaimOut]
    summary: VerificationSummary
    trust: TrustScoreResponse | None = None
    model_used: str
    degraded: bool
    elapsed_ms: float


class GenerationSummary(BaseModel):
    id: uuid.UUID
    question: str
    answer_text: str
    model_used: str
    degraded: bool
    injection_risk: str
    trust_score: float | None = None
    latency_ms: float
    evidence_count: int = 0
    claims_total: int = 0
    claims_supported: int = 0
    claims_contradicted: int = 0
    claims_unresolved: int = 0
    created_at: datetime


class GenerationListResponse(BaseModel):
    items: list[GenerationSummary]
    total: int
    page: int
    page_size: int


class GenerationDetail(GenerationSummary):
    claims: list[ClaimOut] = Field(default_factory=list)
    evidence: list[RetrievedChunk] = Field(default_factory=list)
    trust: TrustScoreResponse | None = None
    warnings: list[str] = Field(default_factory=list)
