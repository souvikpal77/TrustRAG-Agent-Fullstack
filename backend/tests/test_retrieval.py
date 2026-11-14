"""Hybrid retrieval primitives and TLP gating."""

from __future__ import annotations

import pytest

from app.models.enums import TLPLevel
from app.services.retrieval import BM25Index, _min_max, allowed_tlp_levels


def test_tlp_clearance_is_ordered() -> None:
    assert allowed_tlp_levels(TLPLevel.WHITE) == [TLPLevel.WHITE]
    assert allowed_tlp_levels(TLPLevel.GREEN) == [TLPLevel.WHITE, TLPLevel.GREEN]
    assert allowed_tlp_levels(TLPLevel.AMBER) == [TLPLevel.WHITE, TLPLevel.GREEN, TLPLevel.AMBER]
    assert allowed_tlp_levels(TLPLevel.RED) == [
        TLPLevel.WHITE,
        TLPLevel.GREEN,
        TLPLevel.AMBER,
        TLPLevel.RED,
    ]
    assert set(allowed_tlp_levels(None)) == set(TLPLevel)


def test_bm25_ranks_matching_document_highest() -> None:
    documents = [
        ["apt", "loader", "powershell"],
        ["apt", "loader", "powershell", "scheduled", "task", "persistence"],
        ["unrelated", "weather", "report"],
    ]
    index = BM25Index(documents)
    scores = index.score(["apt", "loader", "scheduled", "persistence"])

    assert scores[1] == max(scores)
    assert scores[2] == 0.0
    assert scores[1] > scores[0] > 0.0


def test_bm25_handles_empty_query_and_empty_corpus() -> None:
    assert BM25Index([["a", "b"]]).score([]) == [0.0]
    assert BM25Index([]).score(["apt"]) == []


def test_bm25_top_terms_prefers_rare_tokens() -> None:
    index = BM25Index(
        [
            ["apt", "common"],
            ["apt", "common"],
            ["apt", "rare"],
        ]
    )
    top = index.top_terms(["apt", "common", "rare"], limit=2)
    assert "rare" in top
    assert top[0] == "rare"


def test_min_max_normalisation() -> None:
    assert _min_max([0.0, 5.0, 10.0]) == [0.0, 0.5, 1.0]
    assert _min_max([2.0, 2.0]) == [0.0, 0.0]
    assert _min_max([]) == []


def test_retrieval_semantic_weight_validation() -> None:
    from app.core.config import Settings

    with pytest.raises(ValueError):
        Settings(_env_file=None, retrieval_semantic_weight=1.5)
