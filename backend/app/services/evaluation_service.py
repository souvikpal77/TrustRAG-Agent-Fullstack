"""Three-way evaluation: Standalone LLM vs Standard RAG vs TrustRAG-Agent."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings as default_settings
from app.models.document import Document
from app.models.enums import EvaluationMode
from app.models.evaluation import EvaluationRun
from app.schemas.evaluation import (
    EvaluationBatchResponse,
    EvaluationRequest,
    EvaluationRunOut,
    EvaluationSummaryResponse,
)
from app.schemas.gemini import GenerateRequest
from app.schemas.retrieval import RetrievedChunk
from app.services.claim_service import (
    ClaimVerifier,
    VerificationOutcome,
    evidence_from_retrieved,
    get_claim_verifier,
)
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.prompts import (
    STANDALONE_SYSTEM_INSTRUCTION,
    STANDARD_RAG_SYSTEM_INSTRUCTION,
    STANDARD_RAG_USER_TEMPLATE,
)
from app.services.rag_service import (
    RAGService,
    _offline_extractive_answer,
    citation_coverage,
    get_rag_service,
)
from app.services.retrieval import RetrievalService, get_retrieval_service
from app.services.text import lexical_overlap
from app.services.trust_service import TrustEngine, get_trust_engine

logger = logging.getLogger(__name__)

_STANDALONE_OFFLINE = (
    "Standalone model unavailable: no GOOGLE_API_KEY is configured on the server. "
    "This baseline requires an LLM and cannot be evaluated offline."
)


def _standard_evidence_block(evidence: list[RetrievedChunk]) -> str:
    return "\n\n---\n\n".join(
        f"[E{item.rank}] {item.document_title}\n{item.text}" for item in evidence
    )


class EvaluationService:
    def __init__(
        self,
        config: Settings | None = None,
        retrieval: RetrievalService | None = None,
        gemini: GeminiService | None = None,
        rag: RAGService | None = None,
        claim_verifier: ClaimVerifier | None = None,
        trust: TrustEngine | None = None,
    ) -> None:
        self._settings = config or default_settings
        self._retrieval = retrieval or get_retrieval_service()
        self._gemini = gemini or get_gemini_service()
        self._rag = rag or get_rag_service()
        self._verifier = claim_verifier or get_claim_verifier()
        self._trust = trust or get_trust_engine()

    async def run(
        self, db: AsyncSession, request: EvaluationRequest
    ) -> EvaluationBatchResponse:
        batch_id = uuid.uuid4()
        notes: list[str] = []

        retrieval = await self._retrieval.search(
            db,
            query=request.question,
            document_ids=request.document_ids,
            top_k=request.top_k,
            semantic_weight=request.semantic_weight,
        )
        evidence = retrieval.results
        if not evidence:
            notes.append(
                "No evidence was retrieved. Baselines are expected to score poorly; "
                "TrustRAG should abstain."
            )

        documents = await self._load_document_metadata(
            db, [item.document_id for item in evidence]
        )

        runs: list[EvaluationRunOut] = []
        trustrag_evidence: list[RetrievedChunk] = evidence

        # ------------------------------------------------------------ standalone
        standalone_started = time.perf_counter()
        if self._gemini.configured:
            try:
                standalone_result = await self._gemini.generate(
                    prompt=request.question,
                    system_instruction=STANDALONE_SYSTEM_INSTRUCTION,
                )
                standalone_answer = standalone_result.text
                standalone_model = standalone_result.model
                standalone_degraded = False
            except Exception as exc:  # noqa: BLE001
                logger.warning("Standalone baseline failed: %s", exc)
                standalone_answer = (
                    "Standalone model call failed. The baseline result is unavailable."
                )
                standalone_model = "unavailable"
                standalone_degraded = True
        else:
            standalone_answer = _STANDALONE_OFFLINE
            standalone_model = "unavailable"
            standalone_degraded = True
            notes.append("Standalone baseline is unavailable without a Gemini API key.")

        standalone_latency = (time.perf_counter() - standalone_started) * 1000
        standalone_verification = await self._verify(
            standalone_answer, evidence, request.question
        )
        runs.append(
            self._build_run(
                batch_id=batch_id,
                request=request,
                mode=EvaluationMode.STANDALONE,
                answer=standalone_answer,
                model_used=standalone_model,
                verification=standalone_verification,
                latency_ms=standalone_latency,
                degraded=standalone_degraded,
                evidence=evidence,
                documents=documents,
            )
        )

        # ---------------------------------------------------------- standard RAG
        standard_started = time.perf_counter()
        if self._gemini.configured:
            try:
                standard_result = await self._gemini.generate(
                    prompt=STANDARD_RAG_USER_TEMPLATE.format(
                        evidence=_standard_evidence_block(evidence) or "(no context)",
                        question=request.question,
                    ),
                    system_instruction=STANDARD_RAG_SYSTEM_INSTRUCTION,
                )
                standard_answer = standard_result.text
                standard_model = standard_result.model
                standard_degraded = False
            except Exception as exc:  # noqa: BLE001
                logger.warning("Standard RAG baseline failed: %s", exc)
                standard_answer = _offline_extractive_answer(evidence)
                standard_model = "offline-extractive"
                standard_degraded = True
        else:
            standard_answer = _offline_extractive_answer(evidence)
            standard_model = "offline-extractive"
            standard_degraded = True
            notes.append(
                "Standard RAG fell back to extractive mode; no generative baseline was possible."
            )

        standard_latency = (time.perf_counter() - standard_started) * 1000
        standard_verification = await self._verify(
            standard_answer, evidence, request.question
        )
        runs.append(
            self._build_run(
                batch_id=batch_id,
                request=request,
                mode=EvaluationMode.STANDARD_RAG,
                answer=standard_answer,
                model_used=standard_model,
                verification=standard_verification,
                latency_ms=standard_latency,
                degraded=standard_degraded,
                evidence=evidence,
                documents=documents,
            )
        )

        # --------------------------------------------------------------- TrustRAG
        trustrag_started = time.perf_counter()
        try:
            trustrag_response = await self._rag.ask(
                db,
                GenerateRequest(
                    question=request.question,
                    document_ids=request.document_ids,
                    top_k=request.top_k,
                    semantic_weight=request.semantic_weight,
                    persist=False,
                ),
                persist=False,
            )
            trustrag_answer = trustrag_response.answer
            trustrag_model = trustrag_response.model_used
            trustrag_degraded = trustrag_response.degraded
            trustrag_evidence = trustrag_response.evidence or evidence
        except Exception as exc:  # noqa: BLE001
            logger.warning("TrustRAG pipeline failed during evaluation: %s", exc)
            trustrag_answer = "TrustRAG pipeline failed to produce an answer."
            trustrag_model = "unavailable"
            trustrag_degraded = True
            trustrag_response = None
        trustrag_latency = (time.perf_counter() - trustrag_started) * 1000

        trustrag_verification = await self._verify(
            trustrag_answer, trustrag_evidence, request.question
        )
        runs.append(
            self._build_run(
                batch_id=batch_id,
                request=request,
                mode=EvaluationMode.TRUSTRAG,
                answer=trustrag_answer,
                model_used=trustrag_model,
                verification=trustrag_verification,
                latency_ms=trustrag_latency,
                degraded=trustrag_degraded,
                evidence=trustrag_evidence,
                documents=documents,
                explicit_trust=trustrag_response.trust.score if trustrag_response else None,
            )
        )

        comparison = [
            {
                "mode": run.mode.value,
                "groundedness": run.groundedness,
                "hallucination_rate": run.hallucination_rate,
                "citation_coverage": run.citation_coverage,
                "trust_score": run.trust_score,
                "ioc_recall": run.ioc_recall,
                "latency_ms": run.latency_ms,
                "composite": run.metrics.get("composite_score", 0.0),
                "degraded": run.degraded,
            }
            for run in runs
        ]
        winner = max(
            runs,
            key=lambda run: (
                float(run.metrics.get("composite_score", 0.0)),
                run.mode is EvaluationMode.TRUSTRAG,
            ),
        ).mode.value
        if self._gemini.configured is False:
            notes.append(
                "Gemini is not configured: this run validates the pipeline mechanics, not "
                "absolute model quality. Configure GOOGLE_API_KEY for a meaningful benchmark."
            )

        if request.persist:
            for run in runs:
                db.add(
                    EvaluationRun(
                        id=run.id,
                        batch_id=batch_id,
                        question=run.question,
                        mode=run.mode,
                        answer_text=run.answer_text,
                        model_used=run.model_used,
                        grounded_claims=run.grounded_claims,
                        contradicted_claims=run.contradicted_claims,
                        unresolved_claims=run.unresolved_claims,
                        total_claims=run.total_claims,
                        trust_score=run.trust_score,
                        latency_ms=run.latency_ms,
                        degraded=run.degraded,
                        document_ids=run.document_ids,
                        metrics=run.metrics,
                        created_at=run.created_at,
                    )
                )
            await db.flush()

        return EvaluationBatchResponse(
            batch_id=batch_id,
            question=request.question,
            runs=runs,
            winner=winner,
            comparison=sorted(
                comparison, key=lambda item: float(item["composite"]), reverse=True
            ),
            notes=notes,
        )

    async def _verify(
        self, answer: str, evidence: list[RetrievedChunk], question: str
    ) -> VerificationOutcome:
        return await self._verifier.verify(
            answer=answer,
            evidence=evidence_from_retrieved(evidence),
            question=question,
            persist=False,
        )

    def _build_run(
        self,
        *,
        batch_id: uuid.UUID,
        request: EvaluationRequest,
        mode: EvaluationMode,
        answer: str,
        model_used: str,
        verification: VerificationOutcome,
        latency_ms: float,
        degraded: bool,
        evidence: list[RetrievedChunk],
        documents: list[tuple[Any, str, float, Any]],
        explicit_trust: float | None = None,
    ) -> EvaluationRunOut:
        summary = verification.summary
        coverage = citation_coverage(answer, len(evidence))
        relevance = (
            sum(item.hybrid_score for item in evidence[: min(3, len(evidence))])
            / max(1, min(3, len(evidence)))
        )
        model_confidence = round(0.5 * coverage + 0.5 * relevance, 4)
        trust = self._trust.compute(
            self._trust.combine_document_factors(
                documents,
                relevance=relevance,
                entailment=verification.entailment,
                model_confidence=model_confidence,
            ),
            evidence_count=len(evidence),
            extra_flags=["evaluation_mode", *(["degraded_llm"] if degraded else [])],
        )
        trust_score = explicit_trust if explicit_trust is not None else trust.score

        ioc_recall = self._ioc_recall(answer, request.expected_iocs)
        composite = (
            0.40 * summary.supported_ratio
            + 0.20 * (1.0 - summary.contradicted_ratio)
            + 0.15 * coverage
            + 0.15 * (trust_score / 100.0)
            + 0.10 * (0.0 if degraded else 1.0)
        )
        metrics: dict[str, Any] = {
            "composite_score": round(composite, 4),
            "groundedness": summary.supported_ratio,
            "hallucination_rate": summary.contradicted_ratio,
            "unresolved_ratio": summary.unresolved_ratio,
            "citation_coverage": coverage,
            "ioc_recall": ioc_recall,
            "relevance": round(relevance, 4),
            "entailment": verification.entailment,
            "abstained": summary.abstained,
            "trust_band": trust.band.value,
            "trust_decision": trust.decision,
        }
        return EvaluationRunOut(
            id=uuid.uuid4(),
            batch_id=batch_id,
            question=request.question,
            mode=mode,
            answer_text=answer,
            model_used=model_used,
            grounded_claims=summary.supported,
            contradicted_claims=summary.contradicted,
            unresolved_claims=summary.unresolved,
            total_claims=summary.total,
            groundedness=summary.supported_ratio,
            hallucination_rate=summary.contradicted_ratio,
            citation_coverage=coverage,
            ioc_recall=ioc_recall,
            trust_score=round(trust_score, 2),
            latency_ms=round(latency_ms, 2),
            degraded=degraded,
            document_ids=[str(document_id) for document_id in request.document_ids],
            metrics=metrics,
            created_at=datetime.now(timezone.utc),
        )

    @staticmethod
    def _ioc_recall(answer: str, expected_iocs: list[str]) -> float | None:
        if not expected_iocs:
            return None
        from app.services.ioc_service import refang

        haystack = refang(answer).lower()
        hits = sum(1 for value in expected_iocs if refang(value).strip().lower() in haystack)
        return round(hits / len(expected_iocs), 4)

    async def _load_document_metadata(
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

    async def summary(self, db: AsyncSession) -> EvaluationSummaryResponse:
        rows = (
            await db.execute(
                select(
                    EvaluationRun.mode,
                    func.count(EvaluationRun.id),
                    func.avg(EvaluationRun.grounded_claims * 1.0 / func.nullif(EvaluationRun.total_claims, 0)),
                    func.avg(EvaluationRun.contradicted_claims * 1.0 / func.nullif(EvaluationRun.total_claims, 0)),
                    func.avg(EvaluationRun.trust_score),
                    func.avg(EvaluationRun.latency_ms),
                ).group_by(EvaluationRun.mode)
            )
        ).all()

        average_by_mode = [
            {
                "mode": row[0].value if hasattr(row[0], "value") else str(row[0]),
                "runs": int(row[1]),
                "groundedness": round(float(row[2] or 0.0), 4),
                "hallucination_rate": round(float(row[3] or 0.0), 4),
                "avg_trust_score": round(float(row[4] or 0.0), 2),
                "avg_latency_ms": round(float(row[5] or 0.0), 2),
            }
            for row in rows
        ]

        total_batches = int(
            (
                await db.execute(select(func.count(func.distinct(EvaluationRun.batch_id))))
            ).scalar_one()
        )
        latest_batch_id = (
            await db.execute(
                select(EvaluationRun.batch_id)
                .order_by(EvaluationRun.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        recent_runs: list[EvaluationRunOut] = []
        if latest_batch_id:
            recent = (
                (
                    await db.execute(
                        select(EvaluationRun)
                        .where(EvaluationRun.batch_id == latest_batch_id)
                        .order_by(EvaluationRun.created_at.asc())
                    )
                )
                .scalars()
                .all()
            )
            recent_runs = [self.serialize_run(run) for run in recent]

        return EvaluationSummaryResponse(
            total_batches=total_batches,
            average_by_mode=average_by_mode,
            latest_batch_id=latest_batch_id,
            recent=recent_runs,
        )

    @staticmethod
    def serialize_run(run: EvaluationRun) -> EvaluationRunOut:
        total = max(1, run.total_claims)
        return EvaluationRunOut(
            id=run.id,
            batch_id=run.batch_id,
            question=run.question,
            mode=run.mode,
            answer_text=run.answer_text,
            model_used=run.model_used,
            grounded_claims=run.grounded_claims,
            contradicted_claims=run.contradicted_claims,
            unresolved_claims=run.unresolved_claims,
            total_claims=run.total_claims,
            groundedness=round(run.grounded_claims / total, 4),
            hallucination_rate=round(run.contradicted_claims / total, 4),
            citation_coverage=float(run.metrics.get("citation_coverage", 0.0))
            if run.metrics
            else 0.0,
            ioc_recall=run.metrics.get("ioc_recall") if run.metrics else None,
            trust_score=run.trust_score,
            latency_ms=run.latency_ms,
            degraded=run.degraded,
            document_ids=list(run.document_ids or []),
            metrics=dict(run.metrics or {}),
            created_at=run.created_at,
        )


_evaluation_service: EvaluationService | None = None


def get_evaluation_service() -> EvaluationService:
    global _evaluation_service
    if _evaluation_service is None:
        _evaluation_service = EvaluationService()
    return _evaluation_service
