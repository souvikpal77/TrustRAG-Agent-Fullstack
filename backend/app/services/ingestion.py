"""Secure document ingestion: checksum, parsing, chunking, embedding, enrichment."""

from __future__ import annotations

import hashlib
import io
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings as default_settings
from app.core.exceptions import (
    ConflictError,
    PayloadTooLargeError,
    UnsupportedMediaError,
    ValidationAppError,
)
from app.models.document import Chunk, Document
from app.models.enums import DocumentStatus, SourceType, TLPLevel
from app.services.chunking import PageText, chunk_document
from app.services.embeddings import EmbeddingService, get_embedding_service
from app.services.ioc_service import persist_document_iocs
from app.services.mitre_service import map_document

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS: dict[str, tuple[SourceType, str]] = {
    ".pdf": (SourceType.PDF, "application/pdf"),
    ".txt": (SourceType.TXT, "text/plain"),
    ".text": (SourceType.TXT, "text/plain"),
    ".md": (SourceType.MARKDOWN, "text/markdown"),
    ".markdown": (SourceType.MARKDOWN, "text/markdown"),
}


@dataclass(slots=True)
class IngestionResult:
    document: Document
    chunks_created: int
    iocs_extracted: int
    mitre_candidates: int


def _decode_text(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _clean_text(text: str) -> str:
    return text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")


def parse_pdf(payload: bytes) -> tuple[list[PageText], str]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise UnsupportedMediaError("PDF support is not installed on the server.") from exc

    try:
        reader = PdfReader(io.BytesIO(payload))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:  # noqa: BLE001
                raise ValidationAppError(
                    "PDF is password protected and cannot be parsed."
                ) from exc
        pages: list[PageText] = []
        for index, page in enumerate(reader.pages, start=1):
            try:
                extracted = page.extract_text() or ""
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to extract PDF page %s: %s", index, exc)
                extracted = ""
            pages.append(PageText(page_number=index, text=_clean_text(extracted)))
        raw_text = "\n\n".join(page.text for page in pages).strip()
        if not raw_text:
            raise ValidationAppError(
                "No extractable text found in the PDF. Scanned/image-only PDFs require OCR and "
                "are not supported by this ingestion path."
            )
        return pages, raw_text
    except ValidationAppError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValidationAppError(f"Unable to parse PDF: {exc}") from exc


def parse_plain_text(payload: bytes) -> tuple[list[PageText], str]:
    raw_text = _clean_text(_decode_text(payload)).strip()
    if not raw_text:
        raise ValidationAppError("The uploaded file contains no readable text.")
    return [PageText(page_number=1, text=raw_text)], raw_text


def _resolve_source_type(filename: str, content_type: str | None) -> tuple[SourceType, str]:
    suffix = Path(filename).suffix.lower()
    if suffix in ALLOWED_EXTENSIONS:
        return ALLOWED_EXTENSIONS[suffix]
    if content_type == "application/pdf":
        return SourceType.PDF, "application/pdf"
    if content_type in {"text/markdown", "text/x-markdown"}:
        return SourceType.MARKDOWN, "text/markdown"
    if content_type and content_type.startswith("text/"):
        return SourceType.TXT, "text/plain"
    raise UnsupportedMediaError(
        "Unsupported file type. Upload PDF, TXT or Markdown (.md/.markdown)."
    )


def _safe_filename(original: str, sha256: str, suffix: str) -> str:
    stem = Path(original).stem[:80]
    cleaned = "".join(char for char in stem if char.isalnum() or char in "-_ ").strip()
    return f"{sha256[:16]}-{cleaned or 'document'}{suffix}"


class IngestionService:
    def __init__(
        self,
        config: Settings | None = None,
        embedder: EmbeddingService | None = None,
    ) -> None:
        self._settings = config or default_settings
        self._embedder = embedder or get_embedding_service()

    async def ingest(
        self,
        db: AsyncSession,
        *,
        payload: bytes,
        original_filename: str,
        content_type: str | None,
        title: str | None,
        tlp: TLPLevel,
        provenance: str | None,
        authority_score: float,
        published_at: datetime | None,
        actor: str,
    ) -> IngestionResult:
        if not payload:
            raise ValidationAppError("Uploaded file is empty.")
        if len(payload) > self._settings.max_upload_bytes:
            raise PayloadTooLargeError(
                f"File exceeds the {self._settings.max_upload_mb} MB upload limit."
            )

        source_type, resolved_content_type = _resolve_source_type(
            original_filename, content_type
        )
        sha256 = hashlib.sha256(payload).hexdigest()
        existing = (
            await db.execute(select(Document).where(Document.sha256 == sha256))
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError(
                "A document with the identical SHA-256 checksum already exists.",
                context={"existing_document_id": str(existing.id), "sha256": sha256},
            )

        pages, raw_text = (
            parse_pdf(payload) if source_type is SourceType.PDF else parse_plain_text(payload)
        )
        drafts = chunk_document(
            pages,
            chunk_size=self._settings.chunk_size,
            chunk_overlap=self._settings.chunk_overlap,
            min_chunk_size=self._settings.chunk_min_size,
        )
        if not drafts:
            raise ValidationAppError("The document produced no usable chunks.")

        embeddings = await self._embedder.embed_texts([draft.text for draft in drafts])

        suffix = Path(original_filename).suffix.lower() or ".txt"
        cluster_title = (title or Path(original_filename).stem).strip()[:512] or "Untitled CTI"
        document = Document(
            title=cluster_title,
            filename=_safe_filename(original_filename, sha256, suffix),
            original_filename=original_filename[:512],
            content_type=resolved_content_type,
            source_type=source_type,
            tlp=tlp,
            sha256=sha256,
            size_bytes=len(payload),
            page_count=len(pages),
            char_count=len(raw_text),
            raw_text=raw_text,
            provenance=(provenance or "Unspecified").strip()[:512],
            authority_score=max(0.0, min(1.0, authority_score)),
            published_at=published_at,
            status=DocumentStatus.PROCESSED,
            doc_metadata={
                "parser": "pypdf" if source_type is SourceType.PDF else "native-text",
                "embedding_provider": self._embedder.provider,
                "embedding_dimensions": len(embeddings[0]) if embeddings else 0,
                "chunking": {
                    "chunk_size": self._settings.chunk_size,
                    "overlap": self._settings.chunk_overlap,
                    "strategy": "section-aware-sliding-window",
                },
                "ingested_by": actor,
            },
        )
        db.add(document)
        await db.flush()

        chunks: list[Chunk] = []
        for draft, embedding in zip(drafts, embeddings, strict=True):
            chunk = Chunk(
                document_id=document.id,
                chunk_index=draft.index,
                text=draft.text,
                char_count=draft.char_count,
                token_estimate=draft.token_estimate,
                section_header=draft.section_header,
                page_start=draft.page_start,
                page_end=draft.page_end,
                embedding=embedding,
            )
            db.add(chunk)
            chunks.append(chunk)
        await db.flush()

        iocs_created, _ = await persist_document_iocs(db, document, chunks)
        if self._settings.seed_mitre:
            candidates = await map_document(
                db, document, chunks, max_candidates=8, replace_existing=True
            )
            mitre_count = len(candidates)
        else:
            mitre_count = 0

        logger.info(
            "Ingested document %s (%s chunks, %s IOCs, %s MITRE candidates)",
            document.id,
            len(chunks),
            iocs_created,
            mitre_count,
        )
        return IngestionResult(
            document=document,
            chunks_created=len(chunks),
            iocs_extracted=iocs_created,
            mitre_candidates=mitre_count,
        )


_ingestion_service: IngestionService | None = None


def get_ingestion_service() -> IngestionService:
    global _ingestion_service
    if _ingestion_service is None:
        _ingestion_service = IngestionService()
    return _ingestion_service
