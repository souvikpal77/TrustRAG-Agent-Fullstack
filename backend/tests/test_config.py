"""Database URL normalisation for async SQLAlchemy drivers."""

from __future__ import annotations

import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Render / Heroku style URLs must resolve to the asyncpg driver.
        (
            "postgres://user:pass@host:5432/db",
            "postgresql+asyncpg://user:pass@host:5432/db",
        ),
        (
            "postgresql://user:pass@host:5432/db",
            "postgresql+asyncpg://user:pass@host:5432/db",
        ),
        (
            "postgresql+psycopg2://user:pass@host:5432/db",
            "postgresql+asyncpg://user:pass@host:5432/db",
        ),
        # Already-correct URLs are unchanged.
        (
            "postgresql+asyncpg://user:pass@host:5432/db",
            "postgresql+asyncpg://user:pass@host:5432/db",
        ),
        # SQLite shorthand gains the aiosqlite driver.
        ("sqlite:///./local.db", "sqlite+aiosqlite:///./local.db"),
        (
            "sqlite+aiosqlite:///:memory:",
            "sqlite+aiosqlite:///:memory:",
        ),
    ],
)
def test_database_url_uses_async_driver(raw: str, expected: str) -> None:
    assert Settings(database_url=raw).database_url == expected


def test_database_url_trims_surrounding_whitespace() -> None:
    settings = Settings(database_url="  postgres://user:pass@host/db\n")
    assert settings.database_url == "postgresql+asyncpg://user:pass@host/db"
