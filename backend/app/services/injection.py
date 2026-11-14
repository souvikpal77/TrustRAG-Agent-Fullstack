"""Prompt-injection heuristics and untrusted-evidence sanitiser."""

from __future__ import annotations

import re

from app.models.enums import InjectionRisk
from app.schemas.gemini import InjectionAssessment, InjectionMatch
from app.services.text import truncate

_ZERO_WIDTH = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")
_DELIMITER_TAG = re.compile(r"</?\s*UNTRUSTED_CTI_EVIDENCE\s*>", re.IGNORECASE)
_BASE64_BLOB = re.compile(r"[A-Za-z0-9+/]{140,}={0,2}")

_PATTERNS: tuple[tuple[re.Pattern[str], str, float], ...] = (
    (re.compile(r"\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?", re.I), "instruction override", 0.42),
    (re.compile(r"\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|system)\s+", re.I), "instruction override", 0.38),
    (re.compile(r"\bforget\s+(?:everything|all|your)\b", re.I), "memory reset attempt", 0.32),
    (re.compile(r"\b(?:you\s+are|act|behave)\s+(?:now\s+)?as\s+(?:a|an|the)\b", re.I), "role hijack", 0.22),
    (re.compile(r"\bpretend\s+(?:to\s+be|you\s+are)\b", re.I), "role hijack", 0.22),
    (re.compile(r"\b(?:system|developer|hidden)\s+(?:prompt|message|instructions?)\b", re.I), "system prompt probing", 0.34),
    (re.compile(r"\b(?:reveal|show|print|repeat|leak)\b.{0,40}\b(?:system\s+prompt|instructions?|api\s*key|secret|token)\b", re.I), "secret exfiltration", 0.45),
    (re.compile(r"\b(?:exfiltrate|send|post|upload)\b.{0,60}\b(?:to|at)\s+https?://", re.I), "data exfiltration", 0.4),
    (re.compile(r"\bnew\s+instructions?\s*[:：]", re.I), "instruction injection", 0.3),
    (re.compile(r"\boverride\s+(?:the\s+)?(?:system|safety|instructions?)\b", re.I), "safety override", 0.35),
    (re.compile(r"<\|?\s*(?:im_start|im_end|system|assistant)\s*\|?>", re.I), "chat role marker", 0.4),
    (re.compile(r"\[\s*/?\s*(?:INST|SYS)\s*\]|<<\s*/?\s*SYS\s*>>", re.I), "chat role marker", 0.4),
    (re.compile(r"</?\s*UNTRUSTED_CTI_EVIDENCE\s*>", re.I), "evidence delimiter spoof", 0.55),
    (re.compile(r"\b(?:do\s+not|don't)\s+(?:cite|quote|mention|use)\s+(?:the\s+)?(?:evidence|sources?|citations?)\b", re.I), "citation suppression", 0.32),
    (re.compile(r"\b(?:tool|function)\s+call\b", re.I), "tool invocation attempt", 0.2),
    (re.compile(r"\bBEGIN\s+(?:SYSTEM|ADMIN|TRUSTED)\b", re.I), "fake trust marker", 0.4),
)

_RISK_ORDER = {InjectionRisk.LOW: 0, InjectionRisk.MEDIUM: 1, InjectionRisk.HIGH: 2}


def _scan(text: str, location: str) -> tuple[list[InjectionMatch], float]:
    matches: list[InjectionMatch] = []
    score = 0.0
    for pattern, label, weight in _PATTERNS:
        for match in pattern.finditer(text):
            score += weight
            matches.append(
                InjectionMatch(
                    pattern=pattern.pattern,
                    label=label,
                    location=location,  # type: ignore[arg-type]
                    excerpt=truncate(text[max(0, match.start() - 40) : match.end() + 40], 200),
                )
            )
    if _BASE64_BLOB.search(text):
        score += 0.16
        matches.append(
            InjectionMatch(
                pattern=_BASE64_BLOB.pattern,
                label="encoded payload",
                location=location,  # type: ignore[arg-type]
                excerpt="[long base64-like blob detected]",
            )
        )
    if _ZERO_WIDTH.search(text):
        score += 0.2
        matches.append(
            InjectionMatch(
                pattern="zero-width characters",
                label="obfuscation",
                location=location,  # type: ignore[arg-type]
                excerpt="[zero-width characters detected]",
            )
        )
    return matches, min(score, 1.0)


def assess_injection(question: str, evidence_texts: list[str]) -> InjectionAssessment:
    question_matches, question_score = _scan(question, "QUESTION")
    evidence_blob = "\n".join(evidence_texts)
    evidence_matches, evidence_score = _scan(evidence_blob, "EVIDENCE")

    combined_score = min(1.0, max(question_score, evidence_score, 0.7 * (question_score + evidence_score)))
    if combined_score >= 0.6:
        risk = InjectionRisk.HIGH
    elif combined_score >= 0.25:
        risk = InjectionRisk.MEDIUM
    else:
        risk = InjectionRisk.LOW

    return InjectionAssessment(
        risk=risk,
        score=round(combined_score, 4),
        matches=question_matches + evidence_matches,
        sanitized=bool(_DELIMITER_TAG.search(evidence_blob) or _ZERO_WIDTH.search(evidence_blob)),
    )


def merge_injection(left: InjectionAssessment, right: InjectionAssessment) -> InjectionAssessment:
    risk = left.risk if _RISK_ORDER[left.risk] >= _RISK_ORDER[right.risk] else right.risk
    matches = left.matches + right.matches
    score = max(left.score, right.score)
    return InjectionAssessment(
        risk=risk, score=score, matches=matches, sanitized=left.sanitized or right.sanitized
    )


def sanitize_untrusted_text(text: str) -> tuple[str, bool]:
    """Neutralise delimiter spoofing and invisible characters in evidence."""
    sanitized = _DELIMITER_TAG.sub("[delimiter-tag-removed]", text)
    sanitized = _ZERO_WIDTH.sub("", sanitized)
    changed = sanitized != text
    # Collapse runaway newlines that could visually hide instructions.
    sanitized = re.sub(r"\n{4,}", "\n\n\n", sanitized)
    return sanitized, changed


def escape_for_prompt(text: str, *, max_chars: int = 6000) -> str:
    """Make evidence safe to interpolate inside a strict delimiter block."""
    sanitized, _ = sanitize_untrusted_text(text)
    return sanitized[:max_chars]
