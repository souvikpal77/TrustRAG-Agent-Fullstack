"""Three-way evaluation runs (Standalone LLM vs Standard RAG vs TrustRAG)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    Enum as SAEnum,
    Float,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import EvaluationMode
from app.db.types import JSONVariant, UTCDateTime


class EvaluationRun(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "evaluation_runs"
    __table_args__ = (
        Index("ix_evaluation_runs_batch_mode", "batch_id", "mode"),
        Index("ix_evaluation_runs_created_mode", "created_at", "mode"),
    )

    batch_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[EvaluationMode] = mapped_column(
        SAEnum(EvaluationMode, name="evaluation_mode", native_enum=False, length=20),
        nullable=False,
    )
    answer_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model_used: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    grounded_claims: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    contradicted_claims: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unresolved_claims: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_claims: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trust_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    degraded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    document_ids: Mapped[list[str]] = mapped_column(JSONVariant, nullable=False, default=list)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONVariant, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
