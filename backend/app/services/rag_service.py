"""Evidence-grounded RAG orchestration for Gemini with strict trust boundaries."""

from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings as default_settings
from app.core.exceptions import UpstreamServiceError
from app.models.answer import Generation
from app.models.document import Document
from app.models.enums import InjectionRisk
from app.schemas.gemini import GenerateRequest, GenerateResponse
from app.schemas.retrieval import RetrievedChunk
from app.schemas.trust import TrustFactors
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.injection import assess_injection, escape_for_prompt
from app.services.prompts import RAG_SYSTEM_INSTRUCTION, RAG_USER_TEMPLATE
from app.services.retrieval import RetrievalService, get_retrieval_service
from app.services.text import lexical_overlap, split_sentences
from app.services.trust_service import TrustEngine, get_trust_engine

logger = logging.getLogger(__name__)

_CITATION_RE = re.compile(r"\[E(\d+)\]")
INSUFFICIENT = "INSUFFICIENT_EVIDENCE"


def _sanitize_block(text: str) -> str:
    return escape_for_prompt(text)


def build_evidence_lines(evidence: list[RetrievedChunk]) -> list[str]:
    lines: list[str] = []
    for item in evidence:
        safe_text = _sanitize_block(item.text)
        lines.append(
            f"[E{item.rank}] DOCUMENT: {item.document_title} | TLP: {item.tlp.value} | "
            f"SECTION: {item.section_header or 'n/a'} | PAGES: {item.page_start}-{item.page_end} | "
            f"HYBRID_SCORE: {item.hybrid_score:.3f}\n{safe_text}"
        )
    return lines


def quick_entailment(answer: str, evidence: list[RetrievedChunk]) -> float:
    texts = [item.text for item in evidence]
    if not texts:
        return 0.0
    sentences = [
        sentence
        for sentence in split_sentences(answer)
        if len(sentence) > 25 and not sentence.upper().startswith(INSUFFICIENT)
    ]
    if not sentences:
        return 0.0
    scores = [max(lexical_overlap(sentence, text) for text in texts) for sentence in sentences]
    scores.sort(reverse=True)
    top = scores[: min(6, len(scores))]
    return round(sum(top) / len(top), 4)


def citation_coverage(answer: str, evidence_count: int) -> float:
    cited = {int(match) for match in _CITATION_RE.findall(answer)}
    valid = {index for index in cited if 1 <= index <= evidence_count}
    if evidence_count == 0:
        return 0.0
    expected = min(3, evidence_count)
    return round(min(1.0, len(valid) / expected), 4)


def _offline_extractive_answer(evidence: list[RetrievedChunk]) -> str:
    if not evidence:
        return (
            f"{INSUFFICIENT}: No relevant CTI evidence was retrieved for this question. "
            "Ingest relevant reporting or broaden the document scope."
        )
    lines = [
        "Offline extractive mode: the Gemini API key is not configured, so no model synthesis "
        "was performed. The following excerpts are verbatim evidence, not an analytical judgement.",
        "",
    ]
    for item in evidence[:3]:
        sentences = split_sentences(item.text)
        excerpt = " ".join(sentences[:2]) if sentences else item.text[:400]
        lines.append(f"- [E{item.rank}] {excerpt[:700]}")
    lines.append("")
    lines.append(
        "Analyst note: configure GOOGLE_API_KEY to enable evidence-grounded synthesis and "
        "claim-level verification."
    )
    return "\n".join(lines)


class RAGService:
    def __init__(
        self,
        config: Settings | None = None,
        retrieval: RetrievalService | None = None,
        gemini: GeminiService | None = None,
        trust: TrustEngine | None = None,
    ) -> None:
        self._settings = config or default_settings
        self._retrieval = retrieval or get_retrieval_service()
        self._gemini = gemini or get_gemini_service()
        self._trust = trust or get_trust_engine()

    async def ask(
        self,
        db: AsyncSession,
        request: GenerateRequest,
        *,
        persist: bool = True,
    ) -> GenerateResponse:
        started = time.perf_counter()
        retrieval_result = await self._retrieval.search(
            db,
            query=request.question,
            document_ids=request.document_ids,
            top_k=request.top_k,
            semantic_weight=request.semantic_weight,
            tlp_max=request.tlp_max,
        )
        evidence = retrieval_result.results
        injection = assess_injection(request.question, [item.text for item in evidence])
        warnings: list[str] = []
        if injection.matches:
            warnings.append(
                f"{len(injection.matches)} prompt-injection heuristic match(es) detected; "
                "evidence was sanitised and treated as untrusted data."
            )

        degraded = False
        model_used = "none"
        answer = ""
        error_detail: str | None = None

        if not evidence:
            answer = _offline_extractive_answer([])
            model_used = "abstention"
            warnings.append("No evidence retrieved; the system abstained instead of guessing.")
        elif not self._gemini.configured:
            degraded = True
            answer = _offline_extractive_answer(evidence)
            model_used = "offline-extractive"
            warnings.append(
                "Gemini is not configured; answer is a labelled extractive fallback, not model synthesis."
            )
            if not self._settings.allow_offline_llm_fallback:
                raise UpstreamServiceError(
                    "Gemini is not configured and offline fallback is disabled."
                )
        else:
            evidence_block = "\n\n".join(build_evidence_lines(evidence))
            prompt = RAG_USER_TEMPLATE.format(
                question=request.question.strip(), evidence=evidence_block
            )
            try:
                result = await self._gemini.generate(
                    prompt=prompt,
                    system_instruction=RAG_SYSTEM_INSTRUCTION,
                    model_override=request.model,
                )
                answer = result.text
                model_used = result.model
                degraded = result.degraded
            except Exception as exc:  # noqa: BLE001
                if not self._settings.allow_offline_llm_fallback:
                    raise
                logger.warning("Gemini generation failed; using extractive fallback: %s", exc)
                degraded = True
                model_used = "offline-extractive"
                answer = _offline_extractive_answer(evidence)
                error_detail = str(exc)[:400]
                warnings.append(
                    "Gemini generation failed; a labelled extractive fallback was returned."
                )

        coverage = citation_coverage(answer, len(evidence))
        relevance = (
            sum(item.hybrid_score for item in evidence[: min(3, len(evidence))])
            / max(1, min(3, len(evidence)))
        )
        entailment = quick_entailment(answer, evidence)
        model_confidence = round(
            max(0.0, min(1.0, 0.5 * coverage + 0.5 * relevance)), 4
        )
        if coverage < 0.34 and evidence and not answer.startswith(INSUFFICIENT):
            warnings.append("Answer contains few or no evidence citations; trust is reduced.")

        documents = await self._load_documents(db, [item.document_id for item in evidence])
        factors = self._trust.combine_document_factors(
            documents,
            relevance=relevance,
            entailment=entailment,
            model_confidence=model_confidence,
        )
        if degraded:
            factors.model_confidence = round(factors.model_confidence * 0.9, 4)
        extra_flags = [flag for flag in [("offline_extractive_mode" if degraded else None)] if flag]
        trust = self._trust.compute(
            factors,
            evidence_count=len(evidence),
            injection_risk=injection.risk,
            extra_flags=extra_flags,
        )

        generation_id: uuid.UUID | None = None
        if persist:
            generation = Generation(
                question=request.question,
                answer_text=answer,
                model_used=model_used,
                degraded=degraded,
                injection_risk=injection.risk.value,
                evidence_chunk_ids=[str(item.chunk_id) for item in evidence],
                evidence_snapshot=[item.model_dump(mode="json") for item in evidence],
                document_ids=sorted({str(item.document_id) for item in evidence}),
                trust_score=trust.score,
                trust_breakdown=trust.model_dump(mode="json"),
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            db.add(generation)
            await db.flush()
            generation_id = generation.id

        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        if error_detail:
            warnings.append(f"Upstream detail: {error_detail}")

        return GenerateResponse(
            generation_id=generation_id,
            question=request.question,
            answer=answer,
            model_used=model_used,
            degraded=degraded,
            latency_ms=latency_ms,
            evidence=evidence,
            injection=injection,
            trust=trust,
            citation_coverage=coverage,
            warnings=warnings,
        )

    async def _load_documents(
        self, db: AsyncSession, document_ids: list[uuid.UUID]
    ) -> list[tuple[Any, str, float, Any]]:
        unique_ids = list({document_id for document_id in document_ids})
        if not unique_ids:
            return []
        documents = (
            (await db.execute(select(Document).where(Document.id.in_(unique_ids))))
            .scalars()
            .all()
        )
        return [
            (document.source_type, document.provenance, document.authority_score, document.published_at)
            for document in documents
        ]


_rag_service: RAGService | None = None


def get_rag_service() -> RAGService:
    global _rag_service
    if _rag_service is None:
        _rag_service = RAGService()
    return _rag_service


def factors_or_default(factors: dict[str, Any] | None) -> TrustFactors:
    if not factors:
        return TrustFactors()
    return TrustFactors(**{key: factors.get(key, 0.5) for key in TrustFactors.model_fields})
