"""Evaluation centre schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import EvaluationMode


class EvaluationRequest(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    document_ids: list[uuid.UUID] = Field(default_factory=list)
    top_k: int = Field(default=6, ge=1, le=20)
    semantic_weight: float = Field(default=0.6, ge=0.0, le=1.0)
    expected_iocs: list[str] = Field(default_factory=list, max_length=100)
    persist: bool = True


class EvaluationRunOut(BaseModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    question: str
    mode: EvaluationMode
    answer_text: str
    model_used: str
    grounded_claims: int
    contradicted_claims: int
    unresolved_claims: int
    total_claims: int
    groundedness: float
    hallucination_rate: float
    citation_coverage: float
    ioc_recall: float | None = None
    trust_score: float | None = None
    latency_ms: float
    degraded: bool
    document_ids: list[str] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class EvaluationBatchResponse(BaseModel):
    batch_id: uuid.UUID
    question: str
    runs: list[EvaluationRunOut]
    winner: str
    comparison: list[dict[str, Any]]
    notes: list[str] = Field(default_factory=list)


class EvaluationSummaryResponse(BaseModel):
    total_batches: int
    average_by_mode: list[dict[str, Any]]
    latest_batch_id: uuid.UUID | None = None
    recent: list[EvaluationRunOut] = Field(default_factory=list)


class EvaluationRunListItem(BaseModel):
    batch_id: uuid.UUID
    question: str
    created_at: datetime
    runs: int
    best_mode: str
