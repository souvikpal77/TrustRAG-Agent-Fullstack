"""Tamper-evident audit trail with a SHA-256 hash chain."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog

logger = logging.getLogger(__name__)

GENESIS_HASH = "0" * 64


def _canonical_payload(
    *,
    prev_hash: str,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str | None,
    summary: str,
    details: dict[str, Any],
    created_at: datetime,
) -> str:
    # Some drivers (notably SQLite) return naive datetimes. Treat naive values as
    # UTC instead of local time so the hash stays stable across round trips.
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    else:
        created_at = created_at.astimezone(timezone.utc)
    payload = {
        "prev_hash": prev_hash,
        "actor": actor,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "summary": summary,
        "details": details,
        "created_at": created_at.isoformat(),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def compute_entry_hash(
    *,
    prev_hash: str,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str | None,
    summary: str,
    details: dict[str, Any],
    created_at: datetime,
) -> str:
    payload = _canonical_payload(
        prev_hash=prev_hash,
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        details=details,
        created_at=created_at,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def record_event(
    db: AsyncSession,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    summary: str = "",
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Append an immutable event. Caller owns commit/rollback."""
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        # Serialise chain appends within the current transaction.
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('trustrag_audit_chain'))"))

    last_hash = (
        await db.execute(select(AuditLog.entry_hash).order_by(AuditLog.id.desc()).limit(1))
    ).scalar_one_or_none() or GENESIS_HASH

    created_at = datetime.now(timezone.utc)
    safe_details = details or {}
    entry_hash = compute_entry_hash(
        prev_hash=last_hash,
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        details=safe_details,
        created_at=created_at,
    )
    entry = AuditLog(
        actor=actor[:128],
        action=action[:128],
        entity_type=entity_type[:64],
        entity_id=str(entity_id)[:128] if entity_id is not None else None,
        summary=summary[:4000],
        details=safe_details,
        prev_hash=last_hash,
        entry_hash=entry_hash,
        created_at=created_at,
    )
    db.add(entry)
    await db.flush()
    return entry


async def verify_chain(db: AsyncSession) -> tuple[bool, int, int | None, str, str | None]:
    """Recompute the chain and report the first broken entry, if any."""
    entries = (
        await db.execute(select(AuditLog).order_by(AuditLog.id.asc()))
    ).scalars().all()
    previous = GENESIS_HASH
    for entry in entries:
        expected = compute_entry_hash(
            prev_hash=previous,
            actor=entry.actor,
            action=entry.action,
            entity_type=entry.entity_type,
            entity_id=entry.entity_id,
            summary=entry.summary,
            details=entry.details or {},
            created_at=entry.created_at,
        )
        if entry.prev_hash != previous or entry.entry_hash != expected:
            return (
                False,
                len(entries),
                entry.id,
                f"Hash chain integrity failure at audit entry {entry.id}.",
                entries[-1].entry_hash if entries else None,
            )
        previous = entry.entry_hash
    return (
        True,
        len(entries),
        None,
        "Audit chain verified: every entry is linked and unmodified.",
        previous if entries else None,
    )


async def count_events(db: AsyncSession) -> int:
    return int((await db.execute(select(func.count(AuditLog.id)))).scalar_one())


def actor_from_header(value: str | None) -> str:
    return (value or "system").strip()[:128] or "system"
