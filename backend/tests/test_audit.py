"""Append-only SHA-256 audit chain behaviour."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models.audit import AuditLog
from app.services.audit_service import GENESIS_HASH, compute_entry_hash, record_event, verify_chain


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as connection:
        await connection.run_sync(AuditLog.__table__.create)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def test_chain_links_entries_and_verifies() -> None:
    engine, factory = await _session_factory()
    try:
        async with factory() as session:
            first = await record_event(
                session,
                actor="analyst",
                action="document.upload",
                entity_type="document",
                entity_id="doc-1",
                summary="Uploaded advisory",
                details={"sha256": "a" * 64, "size": 1234},
            )
            await session.commit()

            second = await record_event(
                session,
                actor="analyst",
                action="claim.verify",
                entity_type="generation",
                entity_id="gen-1",
                summary="Verified claims",
                details={"supported": 2},
            )
            await session.commit()

        async with factory() as session:
            third = await record_event(
                session,
                actor="reviewer",
                action="mitre.approve",
                entity_type="candidate",
                entity_id="cand-1",
                summary="Approved T1059",
            )
            await session.commit()

            ok, count, broken_id, message, head = await verify_chain(session)
            assert ok is True
            assert count == 3
            assert broken_id is None
            assert head == third.entry_hash
            assert "verified" in message.lower()

            rows = (await _load_rows(session))
            assert rows[0].prev_hash == GENESIS_HASH
            assert rows[1].prev_hash == rows[0].entry_hash
            assert rows[2].prev_hash == rows[1].entry_hash
            assert len({row.entry_hash for row in rows}) == 3
    finally:
        await engine.dispose()


async def _load_rows(session) -> list[AuditLog]:
    from sqlalchemy import select

    return list((await session.execute(select(AuditLog).order_by(AuditLog.id))).scalars().all())


async def test_tampering_with_payload_breaks_verification() -> None:
    engine, factory = await _session_factory()
    try:
        async with factory() as session:
            entry = await record_event(
                session,
                actor="analyst",
                action="document.delete",
                entity_type="document",
                entity_id="doc-9",
                summary="Deleted document",
                details={"reason": "duplicate"},
            )
            await session.commit()
            entry_id = entry.id

        async with factory() as session:
            row = await session.get(AuditLog, entry_id)
            assert row is not None
            row.summary = "Deleted document (edited)"
            await session.commit()

        async with factory() as session:
            ok, count, broken_id, message, _ = await verify_chain(session)
            assert ok is False
            assert count == 1
            assert broken_id == entry_id
            assert "integrity failure" in message.lower()
    finally:
        await engine.dispose()


async def test_deleting_middle_entry_breaks_the_chain() -> None:
    engine, factory = await _session_factory()
    try:
        async with factory() as session:
            for index in range(3):
                await record_event(
                    session,
                    actor="analyst",
                    action="audit.test",
                    entity_type="test",
                    entity_id=str(index),
                    summary=f"event {index}",
                )
            await session.commit()

        async with factory() as session:
            rows = await _load_rows(session)
            await session.delete(rows[1])
            await session.commit()

        async with factory() as session:
            ok, count, broken_id, _, _ = await verify_chain(session)
            assert ok is False
            assert count == 2
            assert broken_id == rows[2].id
    finally:
        await engine.dispose()


def test_hash_is_deterministic_and_sensitive_to_every_field() -> None:
    from datetime import datetime, timezone

    created = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    base = dict(
        prev_hash=GENESIS_HASH,
        actor="analyst",
        action="document.upload",
        entity_type="document",
        entity_id="doc-1",
        summary="Uploaded",
        details={"a": 1},
        created_at=created,
    )
    digest = compute_entry_hash(**base)
    assert digest == compute_entry_hash(**base)
    assert len(digest) == 64

    changed = dict(base, summary="Uploaded (changed)")
    assert compute_entry_hash(**changed) != digest
    assert compute_entry_hash(**dict(base, prev_hash="f" * 64)) != digest
