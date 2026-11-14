"""MITRE ATT&CK schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import CandidateStatus


class TechniqueOut(BaseModel):
    technique_id: str
    name: str
    tactic_id: str
    tactic_name: str
    description: str
    is_subtechnique: bool
    parent_technique_id: str | None = None
    platforms: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    url: str


class TacticOut(BaseModel):
    tactic_id: str
    name: str
    short_name: str
    order: int
    technique_count: int


class MitreMatrixResponse(BaseModel):
    tactics: list[TacticOut]
    techniques: list[TechniqueOut]
    total_techniques: int
    total_tactics: int


class MitreCandidateOut(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    technique_id: str
    technique_name: str
    tactic_id: str
    tactic_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str
    evidence_snippet: str
    status: CandidateStatus
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime


class MitreCandidateListResponse(BaseModel):
    items: list[MitreCandidateOut]
    total: int
    page: int
    page_size: int


class CandidateDecisionRequest(BaseModel):
    status: CandidateStatus
    reviewed_by: str = Field(default="analyst", min_length=1, max_length=128)
    note: str | None = Field(default=None, max_length=2000)


class MitreMapRequest(BaseModel):
    document_id: uuid.UUID
    max_candidates: int = Field(default=8, ge=1, le=30)
    replace_existing: bool = False


class MitreMapResponse(BaseModel):
    document_id: uuid.UUID
    created: int
    candidates: list[MitreCandidateOut]
    degraded: bool = False


class MitreStatsResponse(BaseModel):
    pending: int
    approved: int
    rejected: int
    top_techniques: list[dict[str, object]]
