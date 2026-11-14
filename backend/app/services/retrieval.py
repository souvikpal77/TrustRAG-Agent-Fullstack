"""Dual-vector hybrid retrieval: BM25 keyword scoring + semantic cosine similarity."""

from __future__ import annotations

import logging
import math
import time
import uuid
from collections import Counter
from dataclasses import dataclass

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings as default_settings
from app.models.document import Chunk, Document
from app.models.enums import DocumentStatus, TLPLevel
from app.schemas.retrieval import RetrievedChunk, RetrievalResponse
from app.services.embeddings import EmbeddingService, get_embedding_service
from app.services.text import tokenize

logger = logging.getLogger(__name__)

TLP_ORDER: dict[TLPLevel, int] = {
    TLPLevel.WHITE: 0,
    TLPLevel.GREEN: 1,
    TLPLevel.AMBER: 2,
    TLPLevel.RED: 3,
}


def allowed_tlp_levels(max_level: TLPLevel | None) -> list[TLPLevel]:
    if max_level is None:
        return list(TLP_ORDER)
    ceiling = TLP_ORDER[max_level]
    return [level for level, rank in TLP_ORDER.items() if rank <= ceiling]


@dataclass(slots=True)
class _Candidate:
    chunk: Chunk
    document: Document
    tokens: list[str]
    bm25: float = 0.0
    semantic: float = 0.0
    hybrid: float = 0.0


class BM25Index:
    """Okapi BM25 over an in-memory candidate set."""

    def __init__(
        self,
        documents: list[list[str]],
        *,
        k1: float = 1.5,
        b: float = 0.75,
    ) -> None:
        self.k1 = k1
        self.b = b
        self.term_frequencies = [Counter(tokens) for tokens in documents]
        self.lengths = [len(tokens) for tokens in documents]
        self.avg_length = sum(self.lengths) / max(1, len(self.lengths))
        document_frequency: Counter[str] = Counter()
        for frequencies in self.term_frequencies:
            document_frequency.update(frequencies.keys())
        total = max(1, len(documents))
        self.idf = {
            term: math.log(1 + (total - df + 0.5) / (df + 0.5))
            for term, df in document_frequency.items()
        }

    def score(self, query_tokens: list[str]) -> list[float]:
        scores = [0.0] * len(self.term_frequencies)
        if not query_tokens:
            return scores
        query_counts = Counter(query_tokens)
        for index, frequencies in enumerate(self.term_frequencies):
            length = self.lengths[index] or 1
            score = 0.0
            for term, query_frequency in query_counts.items():
                frequency = frequencies.get(term)
                if not frequency:
                    continue
                idf = self.idf.get(term, 0.0)
                denominator = frequency + self.k1 * (
                    1 - self.b + self.b * length / max(self.avg_length, 1e-9)
                )
                score += idf * (frequency * (self.k1 + 1) / denominator) * query_frequency
            scores[index] = score
        return scores

    def top_terms(self, query_tokens: list[str], limit: int = 8) -> list[str]:
        unique = {token for token in query_tokens if token in self.idf}
        ranked = sorted(unique, key=lambda token: self.idf.get(token, 0.0), reverse=True)
        return ranked[:limit]


def _min_max(values: list[float]) -> list[float]:
    if not values:
        return []
    low, high = min(values), max(values)
    if math.isclose(high, low):
        return [0.0 for _ in values]
    return [(value - low) / (high - low) for value in values]


class RetrievalService:
    def __init__(
        self,
        config: Settings | None = None,
        embedder: EmbeddingService | None = None,
    ) -> None:
        self._settings = config or default_settings
        self._embedder = embedder or get_embedding_service()

    async def search(
        self,
        db: AsyncSession,
        *,
        query: str,
        document_ids: list[uuid.UUID] | None = None,
        top_k: int | None = None,
        semantic_weight: float | None = None,
        tlp_max: TLPLevel | None = None,
        min_score: float = 0.0,
    ) -> RetrievalResponse:
        started = time.perf_counter()
        top_k = max(1, min(top_k or self._settings.retrieval_default_top_k, 50))
        alpha = (
            self._settings.retrieval_semantic_weight
            if semantic_weight is None
            else max(0.0, min(1.0, semantic_weight))
        )

        stmt = (
            select(Chunk, Document)
            .join(Document, Chunk.document_id == Document.id)
            .where(Document.status == DocumentStatus.PROCESSED)
            .order_by(Document.created_at.desc())
            .limit(self._settings.retrieval_max_candidates)
        )
        if document_ids:
            stmt = stmt.where(Chunk.document_id.in_(document_ids))
        stmt = stmt.where(Document.tlp.in_(allowed_tlp_levels(tlp_max)))

        rows = (await db.execute(stmt)).all()
        if not rows:
            return RetrievalResponse(
                query=query,
                semantic_weight=alpha,
                keyword_weight=round(1 - alpha, 4),
                candidate_chunks=0,
                matched_terms=[],
                results=[],
                elapsed_ms=round((time.perf_counter() - started) * 1000, 2),
            )

        query_tokens = tokenize(query)
        candidates = [
            _Candidate(
                chunk=chunk,
                document=document,
                tokens=tokenize(chunk.text),
            )
            for chunk, document in rows
        ]

        bm25 = BM25Index(
            [candidate.tokens for candidate in candidates],
            k1=self._settings.retrieval_bm25_k1,
            b=self._settings.retrieval_bm25_b,
        )
        bm25_scores = bm25.score(query_tokens)
        matched_terms = bm25.top_terms(query_tokens)

        query_vector = await self._embedder.embed_query(query)
        semantic_raw: list[float] = []
        for candidate in candidates:
            embedding = candidate.chunk.embedding or []
            if len(embedding) != len(query_vector):
                semantic_raw.append(0.0)
            else:
                semantic_raw.append(self._embedder.cosine(query_vector, embedding))

        bm25_norm = _min_max(bm25_scores)
        semantic_norm = _min_max(semantic_raw)
        has_semantic_signal = any(score > 0 for score in semantic_raw)

        for index, candidate in enumerate(candidates):
            candidate.bm25 = bm25_scores[index]
            candidate.semantic = semantic_raw[index]
            if has_semantic_signal:
                candidate.hybrid = alpha * semantic_norm[index] + (1 - alpha) * bm25_norm[index]
            else:
                candidate.hybrid = bm25_norm[index]

        ranked = sorted(candidates, key=lambda item: item.hybrid, reverse=True)
        results: list[RetrievedChunk] = []
        for candidate in ranked:
            if candidate.hybrid < min_score:
                continue
            if candidate.hybrid <= 0 and len(results) >= top_k:
                break
            results.append(
                RetrievedChunk(
                    chunk_id=candidate.chunk.id,
                    document_id=candidate.document.id,
                    document_title=candidate.document.title,
                    tlp=candidate.document.tlp,
                    section_header=candidate.chunk.section_header,
                    page_start=candidate.chunk.page_start,
                    page_end=candidate.chunk.page_end,
                    text=candidate.chunk.text,
                    bm25_score=round(candidate.bm25, 6),
                    semantic_score=round(candidate.semantic, 6),
                    hybrid_score=round(candidate.hybrid, 6),
                    document_authority=candidate.document.authority_score,
                    rank=len(results) + 1,
                )
            )
            if len(results) >= top_k:
                break

        return RetrievalResponse(
            query=query,
            semantic_weight=alpha,
            keyword_weight=round(1 - alpha, 4),
            candidate_chunks=len(candidates),
            matched_terms=matched_terms,
            results=results,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 2),
        )


_retrieval_service: RetrievalService | None = None


def get_retrieval_service() -> RetrievalService:
    global _retrieval_service
    if _retrieval_service is None:
        _retrieval_service = RetrievalService()
    return _retrieval_service
