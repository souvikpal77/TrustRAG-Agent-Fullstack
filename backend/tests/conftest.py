"""Shared test configuration.

Tests run without PostgreSQL or a Gemini key: pure services are exercised
directly and the audit chain is verified against an in-memory SQLite database.
"""

from __future__ import annotations

import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SEED_MITRE", "false")
os.environ.setdefault("ALLOW_OFFLINE_LLM_FALLBACK", "true")
os.environ.pop("GOOGLE_API_KEY", None)
