"""Cross-dialect UTC timestamp normalisation for ``UTCDateTime``."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.types import UTCDateTime
from app.models.audit import AuditLog
from app.services.audit_service import record_event


class _Dialect:
    def __init__(self, name: str) -> None:
        self.name = name


def test_bind_converts_aware_values_to_naive_utc_on_sqlite() -> None:
    column = UTCDateTime()
    source = datetime(2026, 5, 1, 18, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))

    bound = column.process_bind_param(source, _Dialect("sqlite"))

    assert bound == datetime(2026, 5, 1, 13, 0)
    assert bound is not None and bound.tzinfo is None
    assert column.process_bind_param(None, _Dialect("sqlite")) is None


def test_bind_keeps_timezone_aware_values_on_postgresql() -> None:
    column = UTCDateTime()
    source = datetime(2026, 5, 1, 18, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))

    bound = column.process_bind_param(source, _Dialect("postgresql"))

    assert bound == source
    assert bound is not None and bound.tzinfo is timezone.utc


def test_result_is_always_utc_aware() -> None:
    column = UTCDateTime()

    naive = column.process_result_value(datetime(2026, 5, 1, 13, 0), _Dialect("sqlite"))
    assert naive == datetime(2026, 5, 1, 13, 0, tzinfo=timezone.utc)
    assert naive is not None and naive.tzinfo is timezone.utc

    shifted = column.process_result_value(
        datetime(2026, 5, 1, 18, 30, tzinfo=timezone(timedelta(hours=5, minutes=30))),
        _Dialect("postgresql"),
    )
    assert shifted == datetime(2026, 5, 1, 13, 0, tzinfo=timezone.utc)
    assert shifted is not None and shifted.tzinfo is timezone.utc
    assert column.process_result_value(None, _Dialect("sqlite")) is None


async def test_sqlite_round_trip_returns_aware_utc() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(AuditLog.__table__.create)

        async with factory() as session:
            entry = await record_event(
                session,
                actor="analyst",
                action="document.upload",
                entity_type="document",
                entity_id="doc-1",
                summary="Uploaded advisory",
            )
            await session.commit()
            entry_id = entry.id

        async with factory() as session:
            row = await session.get(AuditLog, entry_id)
            assert row is not None
            assert row.created_at.tzinfo is timezone.utc
            assert row.created_at.utcoffset() == timedelta(0)
    finally:
        await engine.dispose()
