"""SOC dashboard aggregate schema."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.audit import AuditLogOut
from app.schemas.evaluation import EvaluationRunOut


class DashboardKpis(BaseModel):
    documents: int
    chunks: int
    iocs: int
    generations: int
    claims: int
    pending_mitre: int
    approved_mitre: int
    avg_trust_score: float
    abstention_rate: float
    avg_latency_ms: float


class VerificationBreakdown(BaseModel):
    supported: int
    contradicted: int
    unresolved: int
    total: int
    supported_ratio: float
    contradicted_ratio: float
    unresolved_ratio: float


class DistributionBucket(BaseModel):
    label: str
    value: int
    percentage: float = 0.0


class TrendPoint(BaseModel):
    date: str
    documents: int
    generations: int


class TechniqueCount(BaseModel):
    technique_id: str
    name: str
    count: int
    tactic: str


class DashboardResponse(BaseModel):
    kpis: DashboardKpis
    verification: VerificationBreakdown
    trust_distribution: list[DistributionBucket]
    ioc_distribution: list[DistributionBucket]
    tlp_distribution: list[DistributionBucket]
    ingestion_trend: list[TrendPoint]
    recent_audit: list[AuditLogOut]
    top_techniques: list[TechniqueCount]
    latest_evaluation: list[EvaluationRunOut] = Field(default_factory=list)
    latest_batch_id: uuid.UUID | None = None
    generated_at: datetime


class DashboardFilters(BaseModel):
    days: int = Field(default=30, ge=1, le=365)
