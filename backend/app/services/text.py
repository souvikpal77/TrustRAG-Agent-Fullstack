"""Text normalisation, tokenisation and lightweight lexical utilities."""

from __future__ import annotations

import math
import re
from collections import Counter

_TOKEN_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_\-\.:/@#]{0,63}")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])|(?<=[;])\s+(?=[A-Z])")
_WHITESPACE_RE = re.compile(r"[ \t]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")

STOPWORDS: frozenset[str] = frozenset(
    """
    a an and are as at be been being but by can could did do does for from had has
    have he her him his how i if in into is it its itself may might more most must
    not of on or our out over own same she should so some such than that the their
    them then there these they this those through to too under until up very was we
    were what when where which while who whom why will with would you your
    """.split()
)


def normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WHITESPACE_RE.sub(" ", text)
    return _MULTI_NEWLINE_RE.sub("\n\n", text).strip()


def tokenize(text: str, *, remove_stopwords: bool = True) -> list[str]:
    """Lowercase tokeniser that preserves CTI artefacts (IPs, hashes, CVE IDs)."""
    tokens = [match.group(0).lower().strip(".,;:!?()[]{}<>\"'") for match in _TOKEN_RE.finditer(text)]
    cleaned = [token for token in tokens if token]
    if remove_stopwords:
        return [token for token in cleaned if token not in STOPWORDS]
    return cleaned


def term_counts(tokens: list[str]) -> Counter[str]:
    return Counter(tokens)


def split_sentences(text: str) -> list[str]:
    normalised = normalize_whitespace(text)
    if not normalised:
        return []
    parts = _SENTENCE_SPLIT_RE.split(normalised)
    return [part.strip() for part in parts if part.strip()]


def estimate_tokens(text: str) -> int:
    # ~4 characters per token is a good operational estimate for English CTI text.
    return max(1, math.ceil(len(text) / 4))


def lexical_overlap(query: str, document: str) -> float:
    """Jaccard-style overlap used as a fast entailment / relevance heuristic."""
    query_terms = set(tokenize(query))
    if not query_terms:
        return 0.0
    document_terms = set(tokenize(document))
    if not document_terms:
        return 0.0
    intersection = query_terms & document_terms
    # Recall-weighted: what fraction of the query is present in the document.
    recall = len(intersection) / len(query_terms)
    precision = len(intersection) / min(len(document_terms), len(query_terms) * 4)
    return max(0.0, min(1.0, 0.75 * recall + 0.25 * precision))


def truncate(text: str, limit: int = 280) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "…"


def extract_context(text: str, start: int, end: int, radius: int = 120) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    snippet = text[left:right].replace("\n", " ").strip()
    return ("…" if left > 0 else "") + snippet + ("…" if right < len(text) else "")
