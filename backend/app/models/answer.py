"""Generated answers and atomic claim verification records."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import VerificationStatus
from app.db.types import JSONVariant, UTCDateTime


class Generation(Base, UUIDPrimaryKeyMixin):
    """A persisted, evidence-grounded answer produced by the RAG pipeline."""

    __tablename__ = "generations"
    __table_args__ = (
        Index("ix_generations_created_trust", "created_at", "trust_score"),
    )

    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    model_used: Mapped[str] = mapped_column(String(128), nullable=False)
    retrieval_strategy: Mapped[str] = mapped_column(
        String(64), nullable=False, default="hybrid-dual-vector"
    )
    degraded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    injection_risk: Mapped[str] = mapped_column(String(16), nullable=False, default="LOW")
    evidence_chunk_ids: Mapped[list[str]] = mapped_column(
        JSONVariant, nullable=False, default=list
    )
    evidence_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONVariant, nullable=False, default=list
    )
    document_ids: Mapped[list[str]] = mapped_column(JSONVariant, nullable=False, default=list)
    trust_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    trust_breakdown: Mapped[dict[str, Any]] = mapped_column(
        JSONVariant, nullable=False, default=dict
    )
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    claims: Mapped[list["Claim"]] = relationship(
        back_populates="generation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Claim.claim_index",
        lazy="selectin",
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Generation id={self.id} model={self.model_used} trust={self.trust_score}>"


class Claim(Base, UUIDPrimaryKeyMixin):
    """Atomic factual proposition extracted from a generated answer."""

    __tablename__ = "claims"
    __table_args__ = (
        Index("ix_claims_generation_status", "generation_id", "verification_status"),
        Index("ix_claims_status_created", "verification_status", "created_at"),
    )

    generation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("generations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    claim_index: Mapped[int] = mapped_column(Integer, nullable=False)
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    verification_status: Mapped[VerificationStatus] = mapped_column(
        SAEnum(VerificationStatus, name="verification_status", native_enum=False, length=20),
        nullable=False,
        default=VerificationStatus.UNRESOLVED,
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    entailment_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_chunk_ids: Mapped[list[str]] = mapped_column(
        JSONVariant, nullable=False, default=list
    )
    verification_meta: Mapped[dict[str, Any]] = mapped_column(
        JSONVariant, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    generation: Mapped["Generation"] = relationship(back_populates="claims")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Claim id={self.id} status={self.verification_status} text={self.claim_text[:40]!r}>"
