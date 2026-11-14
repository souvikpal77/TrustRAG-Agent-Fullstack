"""MITRE ATT&CK Enterprise technique catalog and analyst validation candidates."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import CandidateStatus
from app.db.types import JSONVariant, UTCDateTime

if TYPE_CHECKING:
    from app.models.document import Document


class MitreTactic(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "mitre_tactics"

    tactic_id: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    short_name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    order: Mapped[int] = mapped_column(nullable=False, default=0)

    techniques: Mapped[list["MitreTechnique"]] = relationship(back_populates="tactic")


class MitreTechnique(Base):
    __tablename__ = "mitre_techniques"
    __table_args__ = (
        Index("ix_mitre_techniques_tactic", "tactic_id"),
        Index("ix_mitre_techniques_parent", "parent_technique_id"),
    )

    technique_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    tactic_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("mitre_tactics.id", ondelete="RESTRICT"), nullable=False
    )
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    parent_technique_id: Mapped[str | None] = mapped_column(
        ForeignKey("mitre_techniques.technique_id", ondelete="SET NULL"), nullable=True
    )
    is_subtechnique: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    platforms: Mapped[list[str]] = mapped_column(JSONVariant, nullable=False, default=list)
    keywords: Mapped[list[str]] = mapped_column(JSONVariant, nullable=False, default=list)
    url: Mapped[str] = mapped_column(String(512), nullable=False, default="")

    tactic: Mapped["MitreTactic"] = relationship(back_populates="techniques")
    candidates: Mapped[list["MitreCandidate"]] = relationship(back_populates="technique")


class MitreCandidate(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "mitre_candidates"
    __table_args__ = (
        UniqueConstraint("document_id", "technique_id", name="uq_mitre_candidates_doc_tech"),
        Index("ix_mitre_candidates_status_confidence", "status", "confidence"),
    )

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    technique_id: Mapped[str] = mapped_column(
        ForeignKey("mitre_techniques.technique_id", ondelete="CASCADE"), nullable=False, index=True
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_snippet: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[CandidateStatus] = mapped_column(
        SAEnum(CandidateStatus, name="candidate_status", native_enum=False, length=16),
        nullable=False,
        default=CandidateStatus.PENDING,
        index=True,
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime(), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    document: Mapped["Document"] = relationship(back_populates="mitre_candidates")
    technique: Mapped["MitreTechnique"] = relationship(back_populates="candidates", lazy="selectin")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<MitreCandidate doc={self.document_id} tech={self.technique_id} status={self.status}>"
