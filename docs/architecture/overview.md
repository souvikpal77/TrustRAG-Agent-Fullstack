# TrustRAG-Agent — Architecture Overview

> This document describes the system **as implemented**. It is not a redesign.
> The repository is a working, deployed application; changes are expected to be
> incremental and backward compatible.

## 1. Problem statement

Cyber-threat-intelligence (CTI) analysts read long, heterogeneous reporting
(PDF, TXT, Markdown) and must turn it into defensible answers. A plain LLM will
answer fluently from memory, which is unacceptable for operational CTI because
it cannot show provenance or admit uncertainty.

TrustRAG-Agent answers questions **only from ingested evidence** and then:

1. shows the exact evidence chunks behind every answer,
2. decomposes the answer into atomic claims and verifies each one,
3. scores the answer on a multi-factor trust model,
4. abstains when evidence is insufficient,
5. records every analyst action in a tamper-evident audit chain,
6. benchmarks three modes (standalone LLM, standard RAG, TrustRAG).

## 2. Target users and core workflows

| User | Workflow |
| --- | --- |
| CTI analyst | Ingest reporting → search → ask → inspect evidence/claims/trust → act or abstain |
| Detection engineer | Review IOC inventory and ATT&CK candidates → approve/reject mappings |
| SOC lead | Dashboard metrics, evaluation benchmarks, audit-chain verification |
| Reviewer / auditor | Confirm claim-level support and immutable audit history |

Core workflows map to the UI routes:

| Route | Workflow |
| --- | --- |
| `/` | SOC dashboard (corpus, trust bands, IOC mix, ATT&CK coverage) |
| `/documents` | Upload, filter, inspect chunks, edit TLP/provenance/authority |
| `/retrieval` | Hybrid search lab with TLP gating |
| `/ask` | Grounded generation, claim verification, trust breakdown |
| `/iocs` | Indicator inventory, extraction, stats |
| `/mitre` | ATT&CK matrix and analyst validation queue |
| `/evaluation` | Three-way benchmark runs and comparison |
| `/audit` | Audit log and hash-chain verification |
| `/system` | Runtime configuration (non-secret), health, trust weights |

## 3. Requirements

### Functional (implemented)

- Ingest PDF/TXT/Markdown with duplicate detection (SHA-256) and TLP labels.
- Section-aware chunking with page references and persisted embeddings.
- Hybrid retrieval: BM25 + cosine similarity over dual vectors, TLP ceiling.
- Evidence-grounded generation through Gemini with an offline extractive fallback.
- Claim extraction and per-claim verification (supported / contradicted / unresolved).
- Six-factor trust scoring with abstain/review thresholds.
- Prompt-injection heuristics and evidence sanitisation.
- IOC extraction (defanged output) and persistence.
- MITRE ATT&CK catalog seeding, candidate mapping, analyst decisions.
- Hash-chained, append-only audit log with verification endpoint.
- Three-way evaluation centre with persisted batches.
- Dashboard aggregates and system metadata.

### Non-functional (implemented)

- Async FastAPI + SQLAlchemy 2.0 + asyncpg end to end.
- Pydantic v2 request/response contracts; OpenAPI at `/api/openapi.json`.
- Centralised exception handling with a stable error envelope and request IDs.
- Structured request logging; no secrets in responses or logs.
- Configurable CORS for localhost and Vercel production/preview origins.
- Upload size limits, filename sanitisation, parameterised queries.
- Alembic is the only schema authority.
- Local-first development; Docker optional.

### Deliberately out of scope

- User accounts, RBAC, and multi-tenant isolation (single-analyst workspace,
  actor identity carried in `X-Actor`).
- A trained ML model. The AI subsystem is an **inference-time RAG pipeline**
  over a hosted LLM plus a deterministic local embedder; there is no training
  data, checkpoint, or fine-tuning workflow to manage.
- Background job queue. Evaluation runs are bounded and executed inline; adding
  a queue without a measured need would add infrastructure the project does not
  require.

## 4. System components

```
┌──────────────────────────────────────────────────────────────────┐
│ React 18 + TypeScript + Vite + Tailwind                           │
│ Pages → hooks (useResource) → typed API client (fetch)            │
└───────────────────────────┬──────────────────────────────────────┘
                            │ /api (Vite dev proxy, nginx, or Vercel rewrite)
┌───────────────────────────▼──────────────────────────────────────┐
│ FastAPI (app/main.py)                                             │
│  middleware: request ID, timing, CORS, exception handlers         │
│  routers: health, documents, retrieval, gemini, trust, iocs,      │
│           mitre, audit, evaluation, dashboard                     │
│  services: ingestion, chunking, embeddings, retrieval, rag,       │
│            claim, trust, injection, ioc, mitre, audit, evaluation │
│  models/schemas: SQLAlchemy ORM + Pydantic contracts              │
└───────────┬───────────────────────────────────┬──────────────────┘
            │ asyncpg                           │ google-genai (server only)
┌───────────▼──────────────┐        ┌───────────▼──────────────────┐
│ PostgreSQL               │        │ Gemini API                   │
│ 10 tables, Alembic       │        │ generation + optional        │
│ JSONB vectors/metadata   │        │ embeddings                   │
└──────────────────────────┘        └──────────────────────────────┘
```

### Layer responsibilities (as implemented)

| Layer | Location | Responsibility |
| --- | --- | --- |
| Routers | `backend/app/api/routers/` | HTTP shape, status codes, dependency injection, service calls |
| Dependencies | `backend/app/api/deps.py` | Shared pagination/actor/session wiring |
| Schemas | `backend/app/schemas/` | Pydantic request/response contracts |
| Services | `backend/app/services/` | Business logic and orchestration |
| Models | `backend/app/models/` | SQLAlchemy entities and relationships |
| DB core | `backend/app/db/` | Declarative base, UTC type, JSON variant, async engine/session |
| Core | `backend/app/core/` | Settings, exceptions, logging |
| Frontend pages | `frontend/src/pages/` | Route-level composition and workflow state |
| Frontend hooks | `frontend/src/hooks/` | Reusable data-loading/debounce primitives |
| Frontend client | `frontend/src/lib/api.ts` | Typed HTTP calls, error normalisation, timeouts |
| UI primitives | `frontend/src/components/ui.tsx` | Panels, tables, badges, dialogs, toasts |

### Reference structure mapping

The prompt's reference architecture is a menu, not a mandate. Where a
responsibility exists, this repository expresses it in an equivalent location:

| Reference location | Implemented as |
| --- | --- |
| `frontend/src/api/`, `services/` | `frontend/src/lib/api.ts` (typed client, one module) |
| `frontend/src/types/` | `frontend/src/lib/types.ts` |
| `frontend/src/utils/`, `constants/` | `frontend/src/lib/format.ts`, `frontend/src/lib/ui.ts` |
| `frontend/src/routes/` | `frontend/src/App.tsx` (nine routes) |
| `frontend/src/components/layout/`, `ui/` | `components/Layout.tsx`, `components/ui.tsx`, `components/badges.tsx`, `components/charts.tsx` |
| `backend/app/repositories/` | Queries owned by the corresponding service (see rationale below) |
| `ai_service/` | `backend/app/services/` (RAG, embeddings, retrieval, claims, trust) |
| `database/schema/` | `docs/database/schema.md` + `database/README.md`; Alembic is authoritative |
| `scripts/` | Documented commands in README and `docs/deployment/`; no wrappers needed |
| `frontend/tests/` | `frontend/tests/` (Vitest + RTL), configured by `vitest.config.ts` |

### Why there is no `repositories/` package

Persistence is concentrated in a small number of services that own their
queries. Introducing a repository wrapper for every entity would add indirection
without reducing duplication at this size. The boundary that matters — routers
never execute SQL — is enforced today. If query complexity grows, extract
repositories per aggregate behind the existing service methods; no API contract
changes are required.

### Why there is no separate `ai_service/`

The "AI" here is a retrieval-and-verification pipeline, not a trained model
artifact:

- embeddings come from a deterministic local hashing embedder or a hosted
  embedding endpoint;
- generation and claim verification call a hosted LLM with explicit prompts;
- trust scoring is deterministic arithmetic.

Running that as a second network service would add a hop, a second deployment,
and credential sprawl with no isolation benefit. The pipeline is instead a
self-contained module boundary: `services/{embeddings,retrieval,rag_service,
claim_service,trust_service,injection,prompts}.py`. Each has pure functions and
injectable dependencies that are unit-tested without network access. If a
trained model is added later, it belongs in a new `ai_service/` with its own
versioned artifacts and this backend calls it through a thin integration
client.

## 5. Request flows

### Ingest

```
POST /api/documents (multipart)
  → validate size/type → SHA-256 duplicate check
  → extract text (pypdf or plain text)
  → section-aware chunking (size/overlap/minimum)
  → embed chunks (hashing or Gemini)
  → persist Document + Chunks (single transaction)
  → extract IOCs → audit event
```

### Ask

```
POST /api/gemini/generate
  → hybrid retrieval (BM25 + cosine, TLP ceiling)
  → injection assessment over question + evidence
  → sanitise evidence → prompt with <UNTRUSTED_CTI_EVIDENCE>
  → Gemini generate (model fallback chain, timeout, retries)
  → citation coverage + quick entailment + model confidence
  → trust score → persist Generation
  → response: answer, evidence, injection, trust, warnings
```

### Verify

```
POST /api/gemini/verify-claims
  → load generation + evidence snapshot
  → split answer into atomic claims
  → per-claim entailment check (LLM, lexical fallback)
  → persist Claims with status/confidence/rationale
  → recompute trust with verified entailment
```

## 6. Configuration and secrets

All configuration is environment-based (`backend/app/core/config.py`).

- `DATABASE_URL` is normalised to `postgresql+asyncpg://` for `postgres://`,
  `postgresql://`, and `postgresql+psycopg2://` inputs.
- `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) is server-side only. It is never
  returned by `/api/meta` and never embedded in the frontend bundle.
- `VITE_API_BASE_URL` stays empty in production so the browser calls
  same-origin `/api`, which Vercel rewrites to Render.
- CORS accepts explicit origins plus `CORS_ORIGIN_REGEX` for Vercel domains.

## 7. Reliability decisions

| Decision | Reason |
| --- | --- |
| Health poller: 5 s timeout, 2-strike offline, recheck on focus/visibility | A single slow probe should not flip the UI offline |
| Offline extractive fallback | Keeps the product honest and usable without an API key |
| `INSUFFICIENT_EVIDENCE` abstention | Correct behaviour when retrieval finds nothing |
| Startup pre-warm of DB pool and Gemini client | Avoids a slow first health probe / blocked event loop |
| Alembic before Uvicorn in the container | Schema is ready before traffic arrives |
| Free-tier Render cold starts documented | Vercel can time out before Render wakes; mitigated by an uptime monitor |

## 8. Known limitations

- Single-workspace trust model: `X-Actor` is self-declared, not authenticated.
- No rate limiting; the API is intended for a controlled analyst deployment.
- Evaluation runs execute inline and can take tens of seconds with a live LLM.
- Embeddings are stored as JSONB, so similarity is computed in the application
  after a bounded candidate fetch. This is appropriate for the current corpus
  size; `pgvector` is the upgrade path when the corpus grows.
- In-memory BM25 is rebuilt per query; fine for thousands of chunks, not for
  millions.
- Render free tier sleeps after inactivity; first request may exceed Vercel's
  proxy timeout.
