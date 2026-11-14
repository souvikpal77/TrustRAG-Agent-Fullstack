"""SQLAlchemy async engine / session factory and FastAPI dependency."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# ``settings.database_url`` is normalised to an async scheme by config.py
# (postgres:// -> postgresql+asyncpg://, sqlite:// -> sqlite+aiosqlite://), so
# create_async_engine always resolves an async driver.
_db_url = make_url(settings.database_url)
_engine_kwargs: dict[str, object] = {
    "echo": settings.db_echo,
    "pool_pre_ping": True,
    "pool_recycle": 1800,
}
if _db_url.get_backend_name() != "sqlite":
    # SQLite (used by the test suite) does not support QueuePool sizing options.
    _engine_kwargs["pool_size"] = settings.db_pool_size
    _engine_kwargs["max_overflow"] = settings.db_max_overflow

engine = create_async_engine(settings.database_url, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped session, rolling back on unhandled errors."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    await engine.dispose()
