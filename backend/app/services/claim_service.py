"""Atomic claim decomposition and strict three-state entailment verification."""

from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings as default_settings
from app.models.answer import Claim, Generation
from app.models.enums import InjectionRisk, VerificationStatus
from app.schemas.gemini import ClaimOut, VerificationSummary
from app.schemas.retrieval import RetrievedChunk
from app.services.embeddings import EmbeddingService, get_embedding_service
from app.services.gemini_service import GeminiService, get_gemini_service
from app.services.injection import escape_for_prompt
from app.services.prompts import (
    CLAIM_DECOMPOSITION_SYSTEM,
    CLAIM_VERIFICATION_SYSTEM,
    CLAIM_VERIFICATION_USER_TEMPLATE,
)
from app.services.text import lexical_overlap, split_sentences
from app.services.trust_service import TrustEngine, get_trust_engine

logger = logging.getLogger(__name__)

_MARKER_RE = re.compile(r"\[E(\d+)\]")
_NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
_HASH_RE = re.compile(r"\b[a-fA-F0-9]{32,64}\b")
_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


class _RawClaim(BaseModel):
    text: str = Field(min_length=3, max_length=1200)
    evidence_markers: list[str] = Field(default_factory=list)


class _Decomposition(BaseModel):
    claims: list[_RawClaim] = Field(default_factory=list, max_length=40)


class _RawVerification(BaseModel):
    claim_index: int
    label: Literal["SUPPORTED", "CONTRADICTED", "UNRESOLVED"]
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = ""
    evidence_markers: list[str] = Field(default_factory=list)


class _VerificationList(BaseModel):
    results: list[_RawVerification] = Field(default_factory=list)


@dataclass(slots=True)
class EvidenceItem:
    chunk_id: str
    marker: str
    text: str
    document_id: str | None = None
    document_title: str = "Unknown document"


@dataclass(slots=True)
class VerificationOutcome:
    claims: list[ClaimOut]
    summary: VerificationSummary
    model_used: str
    degraded: bool
    entailment: float
    injection_risk: InjectionRisk = InjectionRisk.LOW
    evidence_items: list[EvidenceItem] = field(default_factory=list)


def evidence_from_retrieved(evidence: list[RetrievedChunk]) -> list[EvidenceItem]:
    return [
        EvidenceItem(
            chunk_id=str(item.chunk_id),
            marker=f"E{item.rank}",
            text=item.text,
            document_id=str(item.document_id),
            document_title=item.document_title,
        )
        for item in evidence
    ]


def evidence_from_snapshot(snapshot: list[dict]) -> list[EvidenceItem]:
    items: list[EvidenceItem] = []
    for index, raw in enumerate(snapshot, start=1):
        items.append(
            EvidenceItem(
                chunk_id=str(raw.get("chunk_id", "")),
                marker=f"E{raw.get('rank', index)}",
                text=str(raw.get("text", "")),
                document_id=str(raw.get("document_id")) if raw.get("document_id") else None,
                document_title=str(raw.get("document_title", "Unknown document")),
            )
        )
    return items


def _heuristic_claims(answer: str, limit: int) -> list[str]:
    claims: list[str] = []
    seen: set[str] = set()
    for sentence in split_sentences(answer):
        cleaned = sentence.strip(" -•\t")
        if len(cleaned) < 25 or len(cleaned) > 1200:
            continue
        upper = cleaned.upper()
        if upper.startswith(("INSUFFICIENT_EVIDENCE", "OFFLINE EXTRACTIVE", "ANALYST NOTE")):
            continue
        if cleaned.endswith("?"):
            continue
        # Require a factual signal: numbers, indicators, or declarative verbs.
        has_signal = bool(
            re.search(r"\d", cleaned)
            or re.search(
                r"\b(is|are|was|were|has|have|had|uses|used|observed|targets|targeted|"
                r"deployed|exploited|communicates|hosted|resolves|delivers|contains|"
                r"identified|attributed|associated)\b",
                cleaned,
                re.IGNORECASE,
            )
        )
        if not has_signal:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        claims.append(cleaned)
        if len(claims) >= limit:
            break
    return claims


class ClaimVerifier:
    def __init__(
        self,
        config: Settings | None = None,
        gemini: GeminiService | None = None,
        embedder: EmbeddingService | None = None,
        trust: TrustEngine | None = None,
    ) -> None:
        self._settings = config or default_settings
        self._gemini = gemini or get_gemini_service()
        self._embedder = embedder or get_embedding_service()
        self._trust = trust or get_trust_engine()

    async def decompose(
        self, answer: str, *, model_override: str | None = None
    ) -> tuple[list[tuple[str, list[str]]], str, bool]:
        """Return (claims with markers, model_used, degraded)."""
        limit = self._settings.max_claims_per_answer
        if self._gemini.configured:
            try:
                result = await self._gemini.generate(
                    prompt=answer[:12000],
                    system_instruction=CLAIM_DECOMPOSITION_SYSTEM.format(max_claims=limit),
                    temperature=0.0,
                    response_schema=_Decomposition,
                    model_override=model_override,
                )
                parsed = _Decomposition.model_validate(result.parsed or {})
                claims: list[tuple[str, list[str]]] = []
                seen: set[str] = set()
                for item in parsed.claims:
                    text = item.text.strip()
                    if len(text) < 5 or text.lower() in seen:
                        continue
                    seen.add(text.lower())
                    markers = [
                        marker.upper().strip("[]")
                        for marker in item.evidence_markers
                        if marker
                    ]
                    claims.append((text, markers))
                    if len(claims) >= limit:
                        break
                return claims, result.model, False
            except Exception as exc:  # noqa: BLE001
                logger.warning("Claim decomposition via Gemini failed: %s", exc)

        return [(claim, []) for claim in _heuristic_claims(answer, limit)], "heuristic", True

    async def _model_verify(
        self,
        evidence: list[EvidenceItem],
        claim_texts: list[str],
        *,
        model_override: str | None,
    ) -> tuple[dict[int, _RawVerification], str, bool]:
        if not self._gemini.configured or not claim_texts:
            return {}, "heuristic", True
        evidence_block = "\n\n".join(
            f"[{item.marker}] {item.document_title}\n{escape_for_prompt(item.text, max_chars=4000)}"
            for item in evidence
        )
        numbered = "\n".join(
            f"{index}. {text}" for index, text in enumerate(claim_texts)
        )
        prompt = CLAIM_VERIFICATION_USER_TEMPLATE.format(
            evidence=evidence_block, claims=numbered
        )
        try:
            result = await self._gemini.generate(
                prompt=prompt,
                system_instruction=CLAIM_VERIFICATION_SYSTEM,
                temperature=0.0,
                response_schema=_VerificationList,
                model_override=model_override,
            )
            parsed = _VerificationList.model_validate(result.parsed or {})
            return (
                {item.claim_index: item for item in parsed.results},
                result.model,
                False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Model claim verification failed: %s", exc)
            return {}, "heuristic", True

    async def verify(
        self,
        *,
        answer: str,
        evidence: list[EvidenceItem],
        question: str = "",
        generation: Generation | None = None,
        persist: bool = True,
        model_override: str | None = None,
    ) -> VerificationOutcome:
        started = time.perf_counter()
        raw_claims, decomposition_model, decomposition_degraded = await self.decompose(
            answer, model_override=model_override
        )
        if not raw_claims:
            return VerificationOutcome(
                claims=[],
                summary=VerificationSummary(
                    total=0,
                    supported=0,
                    contradicted=0,
                    unresolved=0,
                    supported_ratio=0.0,
                    contradicted_ratio=0.0,
                    unresolved_ratio=0.0,
                    verification_ratio=0.0,
                    abstained=True,
                    abstention_reason="No atomic factual claims were identified.",
                ),
                model_used=decomposition_model,
                degraded=decomposition_degraded,
                entailment=0.0,
                evidence_items=evidence,
            )

        claim_texts = [claim for claim, _ in raw_claims]
        marker_map = {
            index: [marker for marker in markers if marker.startswith("E")]
            for index, (_, markers) in enumerate(raw_claims)
        }

        model_results, verification_model, verify_degraded = await self._model_verify(
            evidence, claim_texts, model_override=model_override
        )

        evidence_texts = [item.text for item in evidence]
        claim_vectors = await self._embedder.embed_texts(claim_texts)
        evidence_vectors = await self._embedder.embed_texts(evidence_texts) if evidence_texts else []

        all_evidence_ids = {item.chunk_id for item in evidence}
        marker_to_item = {item.marker: item for item in evidence}
        evidence_position = {item.chunk_id: position for position, item in enumerate(evidence)}

        out_claims: list[ClaimOut] = []
        for index, claim_text in enumerate(claim_texts):
            cited_markers = marker_map.get(index, [])
            candidate_items = [
                marker_to_item[marker]
                for marker in cited_markers
                if marker in marker_to_item
            ] or evidence

            support_scores: list[tuple[float, EvidenceItem]] = []
            for item in candidate_items:
                position = evidence_position.get(item.chunk_id)
                lexical = lexical_overlap(claim_text, item.text)
                semantic = (
                    self._embedder.cosine(claim_vectors[index], evidence_vectors[position])
                    if position is not None and position < len(evidence_vectors)
                    else 0.0
                )
                support_scores.append((0.65 * lexical + 0.35 * semantic, item))
            support_scores.sort(key=lambda pair: pair[0], reverse=True)
            best_score, best_item = support_scores[0] if support_scores else (0.0, None)

            model_item = model_results.get(index)
            contradiction_hint, conflict_detail = self._contradiction_hint(claim_text, best_item)

            if model_item is not None:
                label = model_item.label
                confidence = model_item.confidence
                rationale = model_item.rationale or "Model entailment assessment."
            else:
                label = "UNRESOLVED"
                confidence = max(0.0, min(1.0, 1.0 - best_score))
                rationale = "Deterministic lexical/semantic entailment assessment."

            if label == "SUPPORTED" and best_score < self._settings.entailment_support_threshold:
                label = "UNRESOLVED"
                rationale = (
                    f"Abstained: best evidence alignment {best_score:.2f} is below the "
                    f"support threshold {self._settings.entailment_support_threshold:.2f}. "
                    f"{rationale}"
                )
            elif label == "CONTRADICTED" and best_score < self._settings.entailment_contradiction_threshold:
                label = "UNRESOLVED"
                rationale = (
                    f"Contradiction not accepted: evidence alignment {best_score:.2f} is too weak "
                    f"to establish a direct conflict. {rationale}"
                )
            elif label == "UNRESOLVED" and best_score >= self._settings.entailment_support_threshold:
                rationale = (
                    f"Evidence is relevant (alignment {best_score:.2f}) but does not establish "
                    f"strict entailment. {rationale}"
                )

            if label == "CONTRADICTED" and not contradiction_hint and model_item is None:
                label = "UNRESOLVED"

            if label == "UNRESOLVED" and model_item is None and contradiction_hint and best_score >= 0.5:
                label = "CONTRADICTED"
                confidence = max(confidence, min(0.85, 0.45 + best_score * 0.4))
                rationale = f"{rationale} {conflict_detail}".strip()

            status = VerificationStatus(label)
            if status is VerificationStatus.SUPPORTED:
                confidence = max(confidence, min(0.98, 0.45 + 0.53 * best_score))
            elif status is VerificationStatus.CONTRADICTED:
                confidence = max(confidence, 0.6)
            else:
                confidence = min(0.6, max(0.05, 1.0 - best_score))

            evidence_ids = [best_item.chunk_id] if best_item and best_item.chunk_id in all_evidence_ids else []
            out_claims.append(
                ClaimOut(
                    id=None,
                    claim_index=index,
                    claim_text=claim_text,
                    status=status,
                    confidence=round(float(confidence), 4),
                    entailment_score=round(float(best_score), 4),
                    rationale=rationale.strip(),
                    evidence_chunk_ids=evidence_ids,
                )
            )

        total = len(out_claims)
        supported = sum(1 for claim in out_claims if claim.status is VerificationStatus.SUPPORTED)
        contradicted = sum(
            1 for claim in out_claims if claim.status is VerificationStatus.CONTRADICTED
        )
        unresolved = total - supported - contradicted
        supported_ratio = round(supported / total, 4) if total else 0.0
        contradicted_ratio = round(contradicted / total, 4) if total else 0.0
        unresolved_ratio = round(unresolved / total, 4) if total else 0.0
        abstained = total == 0 or supported == 0 or supported_ratio < 0.5
        abstention_reason = None
        if abstained:
            if total == 0:
                abstention_reason = "No atomic factual claims were identified."
            elif supported == 0:
                abstention_reason = "No claim could be entailed by the retrieved evidence."
            else:
                abstention_reason = (
                    "Fewer than half of the atomic claims are supported; the answer is not "
                    "safe to action without human review."
                )

        entailment_mean = round(
            sum(claim.entailment_score for claim in out_claims) / max(1, total), 4
        )
        summary = VerificationSummary(
            total=total,
            supported=supported,
            contradicted=contradicted,
            unresolved=unresolved,
            supported_ratio=supported_ratio,
            contradicted_ratio=contradicted_ratio,
            unresolved_ratio=unresolved_ratio,
            verification_ratio=supported_ratio,
            abstained=abstained,
            abstention_reason=abstention_reason,
        )

        if persist and generation is not None:
            generation.claims.clear()
            for claim in out_claims:
                claim.id = uuid.uuid4()
                generation.claims.append(
                    Claim(
                        id=claim.id,
                        generation_id=generation.id,
                        claim_index=claim.claim_index,
                        claim_text=claim.claim_text,
                        verification_status=claim.status,
                        confidence=claim.confidence,
                        entailment_score=claim.entailment_score,
                        rationale=claim.rationale,
                        evidence_chunk_ids=[str(chunk_id) for chunk_id in claim.evidence_chunk_ids],
                        verification_meta={
                            "model": verification_model,
                            "decomposition_model": decomposition_model,
                        },
                    )
                )

        logger.debug(
            "Claim verification finished in %.2f ms (model=%s)",
            (time.perf_counter() - started) * 1000,
            verification_model,
        )
        return VerificationOutcome(
            claims=out_claims,
            summary=summary,
            model_used=verification_model,
            degraded=decomposition_degraded or verify_degraded,
            entailment=entailment_mean,
            evidence_items=evidence,
        )


    def _contradiction_hint(
        self, claim: str, evidence: EvidenceItem | None
    ) -> tuple[bool, str]:
        if evidence is None:
            return False, ""
        claim_tokens = set(_IP_RE.findall(claim)) | set(_HASH_RE.findall(claim)) | set(
            _NUMBER_RE.findall(claim)
        )
        if not claim_tokens:
            return False, ""
        evidence_blob = evidence.text.replace("[.]", ".")
        present = {token for token in claim_tokens if token in evidence_blob}
        if present:
            return False, ""
        evidence_tokens = set(_IP_RE.findall(evidence_blob)) | set(
            _HASH_RE.findall(evidence_blob)
        )
        if evidence_tokens:
            return (
                True,
                "Deterministic check found indicator values in the claim that are absent from "
                "the evidence, which contains conflicting indicators.",
            )
        return False, ""


_claim_verifier: ClaimVerifier | None = None


def get_claim_verifier() -> ClaimVerifier:
    global _claim_verifier
    if _claim_verifier is None:
        _claim_verifier = ClaimVerifier()
    return _claim_verifier
