"""Executive SOC dashboard endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard_service import build_dashboard

router = APIRouter(tags=["dashboard"])


@router.get(
    "/dashboard",
    response_model=DashboardResponse,
    summary="SOC dashboard aggregate metrics",
)
async def dashboard(
    days: int = Query(default=14, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
) -> DashboardResponse:
    return await build_dashboard(db, days=days)
