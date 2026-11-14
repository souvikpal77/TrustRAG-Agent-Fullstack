"""SOC dashboard aggregation queries."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.answer import Claim, Generation
from app.models.audit import AuditLog
from app.models.document import Chunk, Document
from app.models.enums import CandidateStatus, EvaluationMode, IOCType, TLPLevel, VerificationStatus
from app.models.evaluation import EvaluationRun
from app.models.ioc import IOC
from app.models.mitre import MitreCandidate, MitreTactic, MitreTechnique
from app.schemas.audit import AuditLogOut
from app.schemas.dashboard import (
    DashboardKpis,
    DashboardResponse,
    DistributionBucket,
    TechniqueCount,
    TrendPoint,
    VerificationBreakdown,
)
from app.services.evaluation_service import EvaluationService


def _bucket(label: str, value: int, total: int) -> DistributionBucket:
    return DistributionBucket(
        label=label,
        value=value,
        percentage=round((value / total) * 100, 2) if total else 0.0,
    )


async def build_dashboard(db: AsyncSession, *, days: int = 14) -> DashboardResponse:
    document_count = int((await db.execute(select(func.count(Document.id)))).scalar_one())
    chunk_count = int((await db.execute(select(func.count(Chunk.id)))).scalar_one())
    ioc_count = int((await db.execute(select(func.count(IOC.id)))).scalar_one())
    generation_count = int((await db.execute(select(func.count(Generation.id)))).scalar_one())
    claim_count = int((await db.execute(select(func.count(Claim.id)))).scalar_one())

    candidate_counts = {
        status.value: int(count)
        for status, count in (
            await db.execute(
                select(MitreCandidate.status, func.count(MitreCandidate.id)).group_by(
                    MitreCandidate.status
                )
            )
        ).all()
    }

    avg_trust = (
        await db.execute(select(func.avg(Generation.trust_score)))
    ).scalar_one()
    avg_latency = (
        await db.execute(select(func.avg(Generation.latency_ms)))
    ).scalar_one()
    scored_generations = int(
        (
            await db.execute(
                select(func.count(Generation.id)).where(Generation.trust_score.is_not(None))
            )
        ).scalar_one()
    )
    abstained = int(
        (
            await db.execute(
                select(func.count(Generation.id)).where(
                    Generation.trust_score < settings.trust_abstain_threshold
                )
            )
        ).scalar_one()
    )

    verification_rows = (
        await db.execute(
            select(Claim.verification_status, func.count(Claim.id)).group_by(
                Claim.verification_status
            )
        )
    ).all()
    verification_counts = {status.value: int(count) for status, count in verification_rows}
    supported = verification_counts.get(VerificationStatus.SUPPORTED.value, 0)
    contradicted = verification_counts.get(VerificationStatus.CONTRADICTED.value, 0)
    unresolved = verification_counts.get(VerificationStatus.UNRESOLVED.value, 0)
    total_claims = supported + contradicted + unresolved

    verification = VerificationBreakdown(
        supported=supported,
        contradicted=contradicted,
        unresolved=unresolved,
        total=total_claims,
        supported_ratio=round(supported / total_claims, 4) if total_claims else 0.0,
        contradicted_ratio=round(contradicted / total_claims, 4) if total_claims else 0.0,
        unresolved_ratio=round(unresolved / total_claims, 4) if total_claims else 0.0,
    )

    ioc_rows = (
        await db.execute(select(IOC.ioc_type, func.count(IOC.id)).group_by(IOC.ioc_type))
    ).all()
    ioc_total = sum(int(count) for _, count in ioc_rows)
    ioc_distribution = sorted(
        [
            _bucket(ioc_type.value, int(count), ioc_total)
            for ioc_type, count in ioc_rows
        ],
        key=lambda bucket: bucket.value,
        reverse=True,
    )
    if ioc_total == 0:
        ioc_distribution = [
            _bucket(ioc_type.value, 0, 0) for ioc_type in IOCType
        ]

    tlp_rows = (
        await db.execute(select(Document.tlp, func.count(Document.id)).group_by(Document.tlp))
    ).all()
    tlp_counts = {tlp.value: int(count) for tlp, count in tlp_rows}
    tlp_total = sum(tlp_counts.values())
    tlp_distribution = [
        _bucket(level.value, tlp_counts.get(level.value, 0), tlp_total) for level in TLPLevel
    ]

    trust_label = case(
        (Generation.trust_score < settings.trust_abstain_threshold, "ABSTAIN"),
        (Generation.trust_score < settings.trust_review_threshold, "REVIEW"),
        else_="TRUSTED",
    )
    trust_rows = (
        await db.execute(
            select(trust_label, func.count(Generation.id))
            .where(Generation.trust_score.is_not(None))
            .group_by(trust_label)
        )
    ).all()
    trust_counts = {label: int(count) for label, count in trust_rows}
    trust_total = sum(trust_counts.values())
    trust_distribution = [
        _bucket(label, trust_counts.get(label, 0), trust_total)
        for label in ("ABSTAIN", "REVIEW", "TRUSTED")
    ]

    since = datetime.now(timezone.utc) - timedelta(days=days)
    document_trend = {
        str(row[0]): int(row[1])
        for row in (
            await db.execute(
                select(func.date(Document.created_at), func.count(Document.id))
                .where(Document.created_at >= since)
                .group_by(func.date(Document.created_at))
            )
        ).all()
    }
    generation_trend = {
        str(row[0]): int(row[1])
        for row in (
            await db.execute(
                select(func.date(Generation.created_at), func.count(Generation.id))
                .where(Generation.created_at >= since)
                .group_by(func.date(Generation.created_at))
            )
        ).all()
    }
    today = datetime.now(timezone.utc).date()
    ingestion_trend = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        ingestion_trend.append(
            TrendPoint(
                date=key,
                documents=document_trend.get(key, 0),
                generations=generation_trend.get(key, 0),
            )
        )

    recent_entries = (
        (
            await db.execute(
                select(AuditLog).order_by(AuditLog.id.desc()).limit(8)
            )
        )
        .scalars()
        .all()
    )

    technique_rows = (
        await db.execute(
            select(
                MitreTechnique.technique_id,
                MitreTechnique.name,
                MitreTactic.name,
                func.count(MitreCandidate.id).label("count"),
            )
            .join(MitreCandidate, MitreCandidate.technique_id == MitreTechnique.technique_id)
            .join(MitreTactic, MitreTechnique.tactic_id == MitreTactic.id)
            .group_by(MitreTechnique.technique_id, MitreTechnique.name, MitreTactic.name)
            .order_by(func.count(MitreCandidate.id).desc())
            .limit(6)
        )
    ).all()
    top_techniques = [
        TechniqueCount(
            technique_id=row[0], name=row[1], tactic=row[2], count=int(row[3])
        )
        for row in technique_rows
    ]

    latest_batch_id = (
        await db.execute(
            select(EvaluationRun.batch_id)
            .order_by(EvaluationRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    latest_evaluation = []
    if latest_batch_id:
        runs = (
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
        latest_evaluation = [EvaluationService.serialize_run(run) for run in runs]

    return DashboardResponse(
        kpis=DashboardKpis(
            documents=document_count,
            chunks=chunk_count,
            iocs=ioc_count,
            generations=generation_count,
            claims=claim_count,
            pending_mitre=candidate_counts.get(CandidateStatus.PENDING.value, 0),
            approved_mitre=candidate_counts.get(CandidateStatus.APPROVED.value, 0),
            avg_trust_score=round(float(avg_trust or 0.0), 2),
            abstention_rate=round(abstained / scored_generations, 4)
            if scored_generations
            else 0.0,
            avg_latency_ms=round(float(avg_latency or 0.0), 2),
        ),
        verification=verification,
        trust_distribution=trust_distribution,
        ioc_distribution=ioc_distribution,
        tlp_distribution=tlp_distribution,
        ingestion_trend=ingestion_trend,
        recent_audit=[AuditLogOut.model_validate(entry) for entry in recent_entries],
        top_techniques=top_techniques,
        latest_evaluation=latest_evaluation,
        latest_batch_id=latest_batch_id,
        generated_at=datetime.now(timezone.utc),
    )
