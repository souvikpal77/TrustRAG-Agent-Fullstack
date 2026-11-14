"""Multi-factor trust scoring and safety abstention gates."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.config import Settings
from app.models.enums import InjectionRisk, SourceType, TrustBand
from app.schemas.trust import TrustFactors, TrustWeights
from app.services.trust_service import TrustEngine, freshness_factor, geometric_mean, provenance_factor


def _engine() -> TrustEngine:
    return TrustEngine(Settings(_env_file=None))


def test_high_quality_evidence_is_trusted() -> None:
    result = _engine().compute(
        TrustFactors(
            provenance=0.9,
            authority=0.9,
            relevance=0.9,
            entailment=0.9,
            freshness=0.9,
            model_confidence=0.9,
        )
    )
    assert result.score >= 85
    assert result.band is TrustBand.TRUSTED
    assert result.decision == "ANSWER"
    assert result.abstain is False
    assert result.safety_flags == []


def test_no_evidence_forces_abstention_and_zero_score() -> None:
    result = _engine().compute(
        TrustFactors(provenance=1, authority=1, relevance=1, entailment=1, freshness=1, model_confidence=1),
        evidence_count=0,
    )
    assert result.score == 0.0
    assert result.band is TrustBand.ABSTAIN
    assert result.decision == "ABSTAIN"
    assert result.abstain is True
    assert "no_evidence" in result.safety_flags


def test_low_trust_below_abstain_threshold() -> None:
    result = _engine().compute(
        TrustFactors(provenance=0.1, authority=0.1, relevance=0.1, entailment=0.1, freshness=0.1, model_confidence=0.1)
    )
    assert result.score < 40
    assert result.band is TrustBand.ABSTAIN
    assert "low_entailment" in result.safety_flags
    assert "weak_retrieval" in result.safety_flags


def test_review_band_between_thresholds() -> None:
    result = _engine().compute(
        TrustFactors(provenance=0.6, authority=0.6, relevance=0.55, entailment=0.55, freshness=0.5, model_confidence=0.6)
    )
    assert 40 <= result.score < 65
    assert result.band is TrustBand.REVIEW
    assert result.decision == "HUMAN_REVIEW"


def test_high_prompt_injection_caps_trust_below_review() -> None:
    result = _engine().compute(
        TrustFactors(provenance=1, authority=1, relevance=1, entailment=1, freshness=1, model_confidence=1),
        injection_risk=InjectionRisk.HIGH,
    )
    assert result.score < 65
    assert result.band is TrustBand.REVIEW
    assert "prompt_injection_high" in result.safety_flags


def test_medium_injection_caps_score_at_89() -> None:
    result = _engine().compute(
        TrustFactors(provenance=1, authority=1, relevance=1, entailment=1, freshness=1, model_confidence=1),
        injection_risk=InjectionRisk.MEDIUM,
    )
    assert result.score <= 89.0
    assert "prompt_injection_medium" in result.safety_flags


def test_weights_are_normalised_to_one() -> None:
    result = _engine().compute(
        TrustFactors(provenance=1, authority=1, relevance=1, entailment=1, freshness=1, model_confidence=1),
        TrustWeights(provenance=0, authority=0, relevance=0, entailment=1, freshness=0, model_confidence=0),
    )
    assert abs(sum(result.weights.values()) - 1.0) < 1e-6
    assert result.weights["entailment"] == 1.0
    assert result.score == 100.0


def test_freshness_uses_180_day_half_life() -> None:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert freshness_factor(now, now=now) == 1.0
    assert freshness_factor(now - timedelta(days=180), now=now) == 0.5
    assert freshness_factor(now - timedelta(days=360), now=now) == 0.25
    assert freshness_factor(None) == 0.45
    # Future timestamps are clamped to full freshness.
    assert freshness_factor(now + timedelta(days=30), now=now) == 1.0


def test_provenance_rewards_declared_source() -> None:
    assert provenance_factor(SourceType.PDF, None) == 0.72
    assert provenance_factor(SourceType.PDF, "CISA advisory") == 0.87
    assert provenance_factor(SourceType.TXT, "unknown") == 0.58
    assert provenance_factor(SourceType.MARKDOWN, "vendor blog") == 0.83


def test_combine_document_factors_averages_metadata() -> None:
    published = datetime.now(timezone.utc) - timedelta(days=10)
    factors = _engine().combine_document_factors(
        [(SourceType.PDF, "CISA", 0.9, published), (SourceType.TXT, None, 0.5, None)],
        relevance=0.8,
        entailment=0.7,
        model_confidence=0.6,
    )
    assert factors.provenance == round((0.87 + 0.58) / 2, 4)
    assert factors.authority == 0.7
    assert factors.relevance == 0.8
    assert factors.entailment == 0.7
    assert factors.model_confidence == 0.6


def test_geometric_mean_is_penalised_by_weak_signals() -> None:
    assert geometric_mean([1.0, 1.0]) == 1.0
    assert geometric_mean([1.0, 0.25]) == 0.5
    assert geometric_mean([]) == 0.0
