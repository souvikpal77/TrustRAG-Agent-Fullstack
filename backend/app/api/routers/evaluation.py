"""Three-way evaluation centre endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, PaginationParams
from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.evaluation import EvaluationRun
from app.schemas.evaluation import (
    EvaluationBatchResponse,
    EvaluationRequest,
    EvaluationRunOut,
    EvaluationRunListItem,
    EvaluationSummaryResponse,
)
from app.services.audit_service import record_event
from app.services.evaluation_service import get_evaluation_service

router = APIRouter(prefix="/evaluation", tags=["evaluation"])


@router.post(
    "/run",
    response_model=EvaluationBatchResponse,
    summary="Run the 3-way benchmark (Standalone vs Standard RAG vs TrustRAG)",
)
async def run_evaluation(
    payload: EvaluationRequest, actor: Actor, db: AsyncSession = Depends(get_db)
) -> EvaluationBatchResponse:
    result = await get_evaluation_service().run(db, payload)
    await record_event(
        db,
        actor=actor,
        action="evaluation.completed",
        entity_type="evaluation_batch",
        entity_id=str(result.batch_id),
        summary=f"3-way evaluation completed; winner={result.winner}",
        details={
            "question": payload.question,
            "winner": result.winner,
            "modes": [run.mode.value for run in result.runs],
            "document_ids": [str(document_id) for document_id in payload.document_ids],
        },
    )
    await db.commit()
    return result


@router.get(
    "/summary",
    response_model=EvaluationSummaryResponse,
    summary="Aggregate evaluation metrics by mode",
)
async def summary(db: AsyncSession = Depends(get_db)) -> EvaluationSummaryResponse:
    return await get_evaluation_service().summary(db)


@router.get(
    "/batches",
    response_model=list[EvaluationRunListItem],
    summary="Recent evaluation batches",
)
async def list_batches(
    pagination: PaginationParams, db: AsyncSession = Depends(get_db)
) -> list[EvaluationRunListItem]:
    batches = (
        await db.execute(
            select(
                EvaluationRun.batch_id,
                func.min(EvaluationRun.created_at),
                func.max(EvaluationRun.question),
                func.count(EvaluationRun.id),
            )
            .group_by(EvaluationRun.batch_id)
            .order_by(func.min(EvaluationRun.created_at).desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    ).all()

    items: list[EvaluationRunListItem] = []
    for batch_id, created_at, question, count in batches:
        runs = (
            (
                await db.execute(
                    select(EvaluationRun).where(EvaluationRun.batch_id == batch_id)
                )
            )
            .scalars()
            .all()
        )
        best = max(
            runs,
            key=lambda run: float((run.metrics or {}).get("composite_score", 0.0)),
            default=None,
        )
        items.append(
            EvaluationRunListItem(
                batch_id=batch_id,
                question=question,
                created_at=created_at,
                runs=int(count),
                best_mode=best.mode.value if best else "UNKNOWN",
            )
        )
    return items


@router.get(
    "/batches/{batch_id}",
    response_model=list[EvaluationRunOut],
    summary="Runs belonging to one evaluation batch",
)
async def get_batch(
    batch_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> list[EvaluationRunOut]:
    runs = (
        (
            await db.execute(
                select(EvaluationRun)
                .where(EvaluationRun.batch_id == batch_id)
                .order_by(EvaluationRun.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    if not runs:
        raise NotFoundError("Evaluation batch not found.")
    service = get_evaluation_service()
    return [service.serialize_run(run) for run in runs]
