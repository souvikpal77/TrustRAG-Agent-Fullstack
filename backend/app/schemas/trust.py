"""Trust scoring schemas."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.models.enums import TrustBand


class TrustFactors(BaseModel):
    """Normalised inputs (0..1) for the multi-factor trust engine."""

    provenance: float = Field(default=0.6, ge=0.0, le=1.0)
    authority: float = Field(default=0.6, ge=0.0, le=1.0)
    relevance: float = Field(default=0.6, ge=0.0, le=1.0)
    entailment: float = Field(default=0.5, ge=0.0, le=1.0)
    freshness: float = Field(default=0.5, ge=0.0, le=1.0)
    model_confidence: float = Field(default=0.6, ge=0.0, le=1.0)


class TrustWeights(BaseModel):
    provenance: float = Field(default=0.15, ge=0.0, le=1.0)
    authority: float = Field(default=0.15, ge=0.0, le=1.0)
    relevance: float = Field(default=0.20, ge=0.0, le=1.0)
    entailment: float = Field(default=0.20, ge=0.0, le=1.0)
    freshness: float = Field(default=0.10, ge=0.0, le=1.0)
    model_confidence: float = Field(default=0.20, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _require_positive_weight(self) -> "TrustWeights":
        if sum(self.as_dict().values()) <= 0:
            raise ValueError("At least one trust weight must be greater than zero")
        return self

    def as_dict(self) -> dict[str, float]:
        return {
            "provenance": self.provenance,
            "authority": self.authority,
            "relevance": self.relevance,
            "entailment": self.entailment,
            "freshness": self.freshness,
            "model_confidence": self.model_confidence,
        }


class TrustScoreRequest(BaseModel):
    """Score ad-hoc factors, or explain an existing persisted generation."""

    generation_id: uuid.UUID | None = None
    factors: TrustFactors | None = None
    weights: TrustWeights | None = None

    @model_validator(mode="after")
    def _require_source(self) -> "TrustScoreRequest":
        if self.generation_id is None and self.factors is None:
            raise ValueError("Provide either generation_id or factors")
        return self


class TrustComponent(BaseModel):
    key: str
    label: str
    weight: float
    raw_value: float
    contribution: float
    explanation: str


class TrustScoreResponse(BaseModel):
    score: float = Field(ge=0.0, le=100.0)
    band: TrustBand
    decision: Literal["ANSWER", "HUMAN_REVIEW", "ABSTAIN"]
    abstain: bool
    components: list[TrustComponent]
    weights: dict[str, float]
    thresholds: dict[str, float]
    safety_flags: list[str]
    explanation: str
    factors: dict[str, float]


class TrustThresholds(BaseModel):
    abstain: float
    review: float
