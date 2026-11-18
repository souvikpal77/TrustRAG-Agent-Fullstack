# Database Assets

This directory documents the PostgreSQL layer. **It is not a migration system.**

- The authoritative schema is defined by Alembic in
  `backend/alembic/versions/`.
- ORM models live in `backend/app/models/`.
- A full table, constraint, index, and relationship reference is in
  [`docs/database/schema.md`](../docs/database/schema.md).
- Seeds are code/data assets, not SQL dumps:
  - `backend/app/data/mitre_enterprise.json` (ATT&CK catalog, seeded at startup)
  - no synthetic documents, answers, or analytics are seeded.

## Common commands

```bash
cd backend

alembic upgrade head
alembic current
alembic revision --autogenerate -m "describe change"
alembic downgrade -1
```

## Rules

1. Never edit an already-applied migration; add a new revision.
2. Every revision implements a real `downgrade()`.
3. Additive changes first, then backfill, then constraints.
4. Do not create a parallel SQL schema here that can drift from Alembic.
5. Never drop, reset, or overwrite production data without explicit approval.

Connection strings are environment-only (`DATABASE_URL`). Plain
`postgres://`/`postgresql://` URLs are normalised to
`postgresql+asyncpg://` by `backend/app/core/config.py`.
