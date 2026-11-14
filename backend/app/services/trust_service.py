"""Multi-factor weighted trust scoring with safety abstention gates."""

from __future__ import annotations

import math
from datetime import datetime, timezone

from app.core.config import Settings, settings as default_settings
from app.models.enums import InjectionRisk, SourceType, TrustBand
from app.schemas.trust import TrustComponent, TrustFactors, TrustScoreResponse, TrustWeights

_COMPONENT_META: dict[str, tuple[str, str]] = {
    "provenance": (
        "Provenance",
        "Reliability of the collection source and declared chain of custody.",
    ),
    "authority": (
        "Authority",
        "Assessed credibility of the publishing organisation / document.",
    ),
    "relevance": (
        "Relevance",
        "Hybrid retrieval strength connecting evidence to the question.",
    ),
    "entailment": (
        "Entailment",
        "Degree to which atomic claims are grounded in retrieved evidence.",
    ),
    "freshness": (
        "Freshness",
        "Recency of the CTI with a 180-day exponential half-life.",
    ),
    "model_confidence": (
        "Model confidence",
        "Coverage and consistency signal from the generation step.",
    ),
}

_PROVENANCE_BASE: dict[SourceType, float] = {
    SourceType.PDF: 0.72,
    SourceType.MARKDOWN: 0.68,
    SourceType.TXT: 0.58,
}


def freshness_factor(published_at: datetime | None, *, now: datetime | None = None) -> float:
    if published_at is None:
        return 0.45
    reference = now or datetime.now(timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (reference - published_at).total_seconds() / 86400)
    return round(max(0.05, min(1.0, 0.5 ** (age_days / 180.0))), 4)


def provenance_factor(source_type: SourceType, provenance: str | None) -> float:
    base = _PROVENANCE_BASE.get(source_type, 0.55)
    if provenance and provenance.strip().lower() not in {"", "unspecified", "unknown", "n/a"}:
        base = min(1.0, base + 0.15)
    return round(base, 4)


class TrustEngine:
    def __init__(self, config: Settings | None = None) -> None:
        self._settings = config or default_settings

    def default_weights(self) -> TrustWeights:
        return TrustWeights(**self._settings.default_trust_weights)

    def compute(
        self,
        factors: TrustFactors,
        weights: TrustWeights | None = None,
        *,
        evidence_count: int = 1,
        injection_risk: InjectionRisk = InjectionRisk.LOW,
        extra_flags: list[str] | None = None,
    ) -> TrustScoreResponse:
        weights = weights or self.default_weights()
        weight_map = weights.as_dict()
        factor_map = factors.model_dump()
        total_weight = sum(weight_map.values()) or 1.0
        normalised_weights = {
            key: round(value / total_weight, 4) for key, value in weight_map.items()
        }

        components: list[TrustComponent] = []
        weighted_sum = 0.0
        for key, raw_value in factor_map.items():
            label, explanation = _COMPONENT_META[key]
            normalised_weight = normalised_weights[key]
            contribution = raw_value * normalised_weight
            weighted_sum += contribution
            components.append(
                TrustComponent(
                    key=key,
                    label=label,
                    weight=normalised_weight,
                    raw_value=round(raw_value, 4),
                    contribution=round(contribution, 4),
                    explanation=explanation,
                )
            )

        score = round(max(0.0, min(100.0, weighted_sum * 100)), 2)
        flags = list(extra_flags or [])

        # -------------------------------------------------- safety gates
        if evidence_count <= 0:
            score = 0.0
            flags.append("no_evidence")
        if injection_risk is InjectionRisk.HIGH:
            score = min(score, self._settings.trust_review_threshold - 1.0)
            flags.append("prompt_injection_high")
        elif injection_risk is InjectionRisk.MEDIUM:
            flags.append("prompt_injection_medium")
            score = min(score, 89.0)
        if factors.entailment < 0.3:
            flags.append("low_entailment")
        if factors.relevance < 0.2:
            flags.append("weak_retrieval")
        if factors.model_confidence < 0.3:
            flags.append("low_model_confidence")

        score = round(max(0.0, min(100.0, score)), 2)
        if evidence_count <= 0 or score < self._settings.trust_abstain_threshold:
            band = TrustBand.ABSTAIN
            decision = "ABSTAIN"
        elif score < self._settings.trust_review_threshold:
            band = TrustBand.REVIEW
            decision = "HUMAN_REVIEW"
        else:
            band = TrustBand.TRUSTED
            decision = "ANSWER"

        if evidence_count <= 0:
            explanation = "No supporting evidence was retrieved, so the system abstains."
        elif band is TrustBand.ABSTAIN:
            explanation = (
                "Weighted trust fell below the abstention threshold; the answer must not be "
                "used operationally without independent corroboration."
            )
        elif band is TrustBand.REVIEW:
            explanation = (
                "Evidence is partially supportive but requires analyst review before the "
                "assessment is actioned."
            )
        else:
            explanation = (
                "Evidence-grounded answer cleared the trust threshold with no critical "
                "safety flags."
            )

        return TrustScoreResponse(
            score=score,
            band=band,
            decision=decision,  # type: ignore[arg-type]
            abstain=band is TrustBand.ABSTAIN,
            components=components,
            weights=normalised_weights,
            thresholds={
                "abstain": self._settings.trust_abstain_threshold,
                "review": self._settings.trust_review_threshold,
            },
            safety_flags=flags,
            explanation=explanation,
            factors={key: round(value, 4) for key, value in factor_map.items()},
        )

    def combine_document_factors(
        self,
        documents: list[tuple[SourceType, str, float, datetime | None]],
        *,
        relevance: float,
        entailment: float,
        model_confidence: float,
    ) -> TrustFactors:
        """Build factors from retrieved document metadata."""
        if not documents:
            return TrustFactors(
                provenance=0.0,
                authority=0.0,
                relevance=relevance,
                entailment=entailment,
                freshness=0.0,
                model_confidence=model_confidence,
            )
        provenance = sum(provenance_factor(source_type, provenance) for source_type, provenance, _, _ in documents) / len(documents)
        authority = sum(max(0.0, min(1.0, authority)) for _, _, authority, _ in documents) / len(documents)
        freshness = sum(freshness_factor(published) for _, _, _, published in documents) / len(documents)
        return TrustFactors(
            provenance=round(provenance, 4),
            authority=round(authority, 4),
            relevance=round(max(0.0, min(1.0, relevance)), 4),
            entailment=round(max(0.0, min(1.0, entailment)), 4),
            freshness=round(freshness, 4),
            model_confidence=round(max(0.0, min(1.0, model_confidence)), 4),
        )


_trust_engine: TrustEngine | None = None


def get_trust_engine() -> TrustEngine:
    global _trust_engine
    if _trust_engine is None:
        _trust_engine = TrustEngine()
    return _trust_engine


def geometric_mean(values: list[float]) -> float:
    positive = [max(value, 1e-6) for value in values]
    if not positive:
        return 0.0
    return math.exp(sum(math.log(value) for value in positive) / len(positive))
