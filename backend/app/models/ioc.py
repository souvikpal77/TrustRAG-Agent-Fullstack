"""Indicators of compromise extracted from CTI documents."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import (
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
from app.models.enums import IOCType
from app.db.types import UTCDateTime

if TYPE_CHECKING:
    from app.models.document import Document


class IOC(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "iocs"
    __table_args__ = (
        UniqueConstraint(
            "normalized_value", "ioc_type", "document_id", name="uq_iocs_value_type_document"
        ),
        Index("ix_iocs_type_value", "ioc_type", "normalized_value"),
        Index("ix_iocs_created_type", "created_at", "ioc_type"),
    )

    value: Mapped[str] = mapped_column(String(2048), nullable=False)
    normalized_value: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    defanged: Mapped[str] = mapped_column(String(2048), nullable=False)
    ioc_type: Mapped[IOCType] = mapped_column(
        SAEnum(IOCType, name="ioc_type", native_enum=False, length=16), nullable=False
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=True, index=True
    )
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chunks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.8)
    context: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    document: Mapped["Document | None"] = relationship(back_populates="iocs")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<IOC {self.ioc_type}={self.defanged}>"
