"""Cross-dialect column types.

* ``JSONVariant`` -- JSONB on PostgreSQL, plain JSON elsewhere (unit tests on SQLite).
* ``UTCDateTime`` -- timezone-aware UTC on every backend.

SQLite has no native timezone support: values are stored as naive UTC and would
otherwise surface as naive ``datetime`` objects, while PostgreSQL returns aware
ones. ``UTCDateTime`` normalises both directions so API responses and the audit
hash chain behave identically regardless of the database in use.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB

# JSONB on PostgreSQL, plain JSON elsewhere (used by unit tests on SQLite).
JSONVariant = JSON().with_variant(JSONB(), "postgresql")


class UTCDateTime(TypeDecorator[datetime]):
    """``TIMESTAMP WITH TIME ZONE`` that always yields aware UTC datetimes.

    On SQLite the value is converted to UTC and stored without ``tzinfo``;
    on read it is re-stamped as UTC. On PostgreSQL the native ``timestamptz``
    type already preserves the instant, so values only need normalising to UTC.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(
        self, value: datetime | None, dialect: Any
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        value = value.astimezone(timezone.utc)
        if dialect.name == "sqlite":
            # SQLite's DATETIME has no timezone storage; persist naive UTC.
            return value.replace(tzinfo=None)
        return value

    def process_result_value(
        self, value: datetime | None, dialect: Any
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
