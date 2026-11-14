"""MITRE ATT&CK catalog seeding and explainable technique mapping.

The catalogue is an authentic curated subset of the MITRE ATT&CK Enterprise
matrix. Mapping is deterministic and explainable; every proposed technique is
created as a PENDING candidate that a human analyst must approve or reject.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document import Chunk, Document
from app.models.mitre import MitreCandidate, MitreTactic, MitreTechnique
from app.schemas.mitre import (
    MitreCandidateOut,
    MitreMatrixResponse,
    TacticOut,
    TechniqueOut,
)
from app.services.text import extract_context

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "mitre_enterprise.json"


@lru_cache
def load_catalog() -> dict:
    with _DATA_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


async def seed_catalog(db: AsyncSession) -> int:
    """Idempotently seed tactics and techniques. Returns technique count."""
    existing_techniques = int(
        (await db.execute(select(func.count(MitreTechnique.technique_id)))).scalar_one()
    )
    catalog = load_catalog()
    tactic_ids = {item["tactic_id"] for item in catalog["tactics"]}

    existing_tactics = {
        tactic.tactic_id: tactic
        for tactic in (await db.execute(select(MitreTactic))).scalars().all()
    }
    for item in catalog["tactics"]:
        if item["tactic_id"] in existing_tactics:
            continue
        db.add(
            MitreTactic(
                tactic_id=item["tactic_id"],
                name=item["name"],
                short_name=item["short_name"],
                description=item.get("description", ""),
                order=item.get("order", 0),
            )
        )
    await db.flush()

    tactics = {
        tactic.tactic_id: tactic
        for tactic in (await db.execute(select(MitreTactic))).scalars().all()
    }

    if existing_techniques == 0:
        existing_ids: set[str] = set()
    else:
        existing_ids = set(
            (await db.execute(select(MitreTechnique.technique_id))).scalars().all()
        )

    added = 0
    for item in catalog["techniques"]:
        if item["technique_id"] in existing_ids:
            continue
        tactic_id = item.get("tactic")
        if tactic_id not in tactic_ids:
            continue
        db.add(
            MitreTechnique(
                technique_id=item["technique_id"],
                name=item["name"],
                tactic_id=tactics[tactic_id].id,
                description=item.get("description", ""),
                parent_technique_id=item.get("parent"),
                is_subtechnique=bool(item.get("is_subtechnique", False)),
                platforms=item.get("platforms", []),
                keywords=[keyword.lower() for keyword in item.get("keywords", [])],
                url=f"https://attack.mitre.org/techniques/{item['technique_id'].replace('.', '/')}/",
            )
        )
        added += 1
    if added:
        await db.flush()
    return int(
        (await db.execute(select(func.count(MitreTechnique.technique_id)))).scalar_one()
    )


async def list_matrix(db: AsyncSession) -> MitreMatrixResponse:
    tactics = (
        (await db.execute(select(MitreTactic).order_by(MitreTactic.order))).scalars().all()
    )
    techniques = (
        (
            await db.execute(
                select(MitreTechnique)
                .options(selectinload(MitreTechnique.tactic))
                .order_by(MitreTechnique.technique_id)
            )
        )
        .scalars()
        .all()
    )
    out_techniques = [
        TechniqueOut(
            technique_id=technique.technique_id,
            name=technique.name,
            tactic_id=technique.tactic.tactic_id,
            tactic_name=technique.tactic.name,
            description=technique.description,
            is_subtechnique=technique.is_subtechnique,
            parent_technique_id=technique.parent_technique_id,
            platforms=list(technique.platforms or []),
            keywords=list(technique.keywords or []),
            url=technique.url,
        )
        for technique in techniques
    ]
    counts: dict[str, int] = {}
    for technique in techniques:
        counts[technique.tactic.tactic_id] = counts.get(technique.tactic.tactic_id, 0) + 1
    out_tactics = [
        TacticOut(
            tactic_id=tactic.tactic_id,
            name=tactic.name,
            short_name=tactic.short_name,
            order=tactic.order,
            technique_count=counts.get(tactic.tactic_id, 0),
        )
        for tactic in tactics
    ]
    return MitreMatrixResponse(
        tactics=out_tactics,
        techniques=out_techniques,
        total_techniques=len(techniques),
        total_tactics=len(tactics),
    )


def _keyword_hits(text: str, keyword: str) -> list[int]:
    pattern = r"(?<![a-z0-9])" + re.escape(keyword.lower()) + r"(?![a-z0-9])"
    return [match.start() for match in re.finditer(pattern, text)]


def _score_technique(
    text: str, text_lower: str, technique: MitreTechnique
) -> tuple[float, list[str], str, int]:
    weighted_hits = 0.0
    matched_keywords: list[str] = []
    first_position: int | None = None

    for keyword in technique.keywords or []:
        positions = _keyword_hits(text_lower, keyword)
        if not positions:
            continue
        specificity = 1.0 + 0.35 * (len(keyword.split()) - 1)
        occurrences = min(len(positions), 3)
        weighted_hits += occurrences * specificity
        matched_keywords.append(keyword)
        if first_position is None or positions[0] < first_position:
            first_position = positions[0]

    # Direct ATT&CK ID mentions are strong analyst signals.
    if technique.technique_id.lower() in text_lower:
        weighted_hits += 2.0
        matched_keywords.append(technique.technique_id)
        position = text_lower.find(technique.technique_id.lower())
        first_position = position if first_position is None else min(first_position, position)

    if weighted_hits <= 0 or first_position is None:
        return 0.0, [], "", 0

    distinct = len(set(matched_keywords))
    confidence = min(0.96, 0.16 + 0.14 * weighted_hits + 0.035 * distinct)
    snippet = extract_context(text, first_position, first_position + 40, radius=160)
    rationale = (
        f"Matched {distinct} ATT&CK indicator term(s): "
        + ", ".join(sorted(set(matched_keywords))[:6])
    )
    return confidence, matched_keywords, rationale + f" | {snippet}", snippet.count(" ")


async def map_document(
    db: AsyncSession,
    document: Document,
    chunks: list[Chunk] | None = None,
    *,
    max_candidates: int = 8,
    replace_existing: bool = False,
) -> list[MitreCandidate]:
    """Score the document against the ATT&CK catalog and stage candidates."""
    if chunks is None:
        chunks = (
            (await db.execute(select(Chunk).where(Chunk.document_id == document.id))).scalars().all()
        )
    text = document.raw_text or "\n".join(chunk.text for chunk in chunks)
    text = text[:500_000]
    text_lower = text.lower()

    techniques = (
        (
            await db.execute(
                select(MitreTechnique).options(selectinload(MitreTechnique.tactic))
            )
        )
        .scalars()
        .all()
    )

    existing = {
        candidate.technique_id: candidate
        for candidate in (
            await db.execute(
                select(MitreCandidate)
                .options(
                    selectinload(MitreCandidate.technique).selectinload(MitreTechnique.tactic),
                    selectinload(MitreCandidate.document),
                )
                .where(MitreCandidate.document_id == document.id)
            )
        )
        .scalars()
        .all()
    }
    if replace_existing:
        await db.execute(delete(MitreCandidate).where(MitreCandidate.document_id == document.id))
        existing = {}

    scored: list[tuple[float, MitreTechnique, str]] = []
    for technique in techniques:
        confidence, _, rationale, _ = _score_technique(text, text_lower, technique)
        if confidence < 0.32:
            continue
        scored.append((confidence, technique, rationale))
    scored.sort(key=lambda item: item[0], reverse=True)

    results: list[MitreCandidate] = []
    for confidence, technique, rationale in scored[:max_candidates]:
        candidate = existing.get(technique.technique_id)
        if candidate is not None:
            results.append(candidate)
            continue
        snippet = rationale.split("|")[-1].strip() if "|" in rationale else ""
        candidate = MitreCandidate(
            document_id=document.id,
            technique_id=technique.technique_id,
            confidence=round(confidence, 4),
            rationale=rationale.split("|")[0].strip(),
            evidence_snippet=snippet[:2000],
            document=document,
            technique=technique,
        )
        db.add(candidate)
        results.append(candidate)
    if results:
        await db.flush()
    return results


def serialize_candidate(candidate: MitreCandidate) -> MitreCandidateOut:
    technique = candidate.technique
    tactic = technique.tactic
    document = candidate.document
    return MitreCandidateOut(
        id=candidate.id,
        document_id=candidate.document_id,
        document_title=document.title if document is not None else "Unknown document",
        technique_id=technique.technique_id,
        technique_name=technique.name,
        tactic_id=tactic.tactic_id if tactic else "",
        tactic_name=tactic.name if tactic else "",
        confidence=round(candidate.confidence, 4),
        rationale=candidate.rationale,
        evidence_snippet=candidate.evidence_snippet,
        status=candidate.status,
        reviewed_by=candidate.reviewed_by,
        reviewed_at=candidate.reviewed_at,
        created_at=candidate.created_at,
    )


def _rounded(value: float) -> float:
    return round(value, 4)


def expected_confidence_floor() -> float:
    return _rounded(1 - math.exp(-1.0))
