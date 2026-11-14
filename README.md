# TrustRAG-Agent

**Evidence-grounded cyber threat intelligence (CTI) RAG with claim verification, multi-factor trust scoring, IOC extraction, MITRE ATT&CK validation, and a three-way evaluation centre.**

TrustRAG-Agent is built for SOC and CTI analysts who cannot afford confident-sounding answers that are not supported by the source material. Every generated answer is retrieved from an ingested evidence corpus, decomposed into atomic claims, verified against the retrieved text, and scored across six trust dimensions. When the evidence is weak, the system is designed to **abstain instead of guessing**.

---

## Contents

- [Why this exists](#why-this-exists)
- [Architecture](#architecture)
- [Feature overview](#feature-overview)
- [Repository layout](#repository-layout)
- [Quickstart with Docker Compose](#quickstart-with-docker-compose)
- [Local development](#local-development)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [Trust model](#trust-model)
- [Evidence grounding and prompt-injection defence](#evidence-grounding-and-prompt-injection-defence)
- [Evaluation centre](#evaluation-centre)
- [Testing](#testing)
- [Security notes](#security-notes)
- [Limitations and non-goals](#limitations-and-non-goals)
- [Troubleshooting](#troubleshooting)

---

## Why this exists

Conventional RAG pipelines optimise for answer fluency. CTI work requires something stricter:

- **Grounded** — every material sentence must cite retrieved evidence.
- **Verifiable** — claims are checked as `SUPPORTED`, `CONTRADICTED`, or `UNRESOLVED`, not merely "similar".
- **Trust-aware** — provenance, authority, relevance, entailment, freshness, and model confidence are scored explicitly.
- **Abstention-first** — low trust, missing evidence, or high prompt-injection risk forces `ABSTAIN` or human review.
- **Auditable** — document ingestion, verification, IOC extraction, ATT&CK decisions, and evaluations land in a hash-chained audit log.

TrustRAG-Agent implements that workflow end to end: FastAPI + PostgreSQL backend, React analyst console, and an evaluation harness that compares **Standalone LLM**, **Standard RAG**, and **TrustRAG-Agent** on the same questions.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                        React + TypeScript + Vite                      │
│  Dashboard · Corpus · Retrieval Lab · Ask TrustRAG · IOCs · ATT&CK    │
│  Evaluation Centre · Audit Chain · System                             │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  /api (nginx proxy / Vite dev proxy)
┌───────────────────────────────▼───────────────────────────────────────┐
│                            FastAPI backend                            │
│                                                                       │
│  Ingestion ──► section-aware chunker ──► embeddings ──► PostgreSQL    │
│      │              │                         │                       │
│      │              └── IOC extraction        └── hybrid retrieval    │
│      │              └── ATT&CK candidate mapping                      │
│      │                                                                │
│  /generate ──► TLP-gated hybrid search ──► injection scan ──► Gemini  │
│      │                                                                │
│      ├──► claim decomposition ──► strict entailment verification      │
│      ├──► six-factor trust engine ──► ANSWER / REVIEW / ABSTAIN       │
│      └──► hash-chained audit event                                    │
│                                                                       │
│  /evaluation/run ──► Standalone LLM vs Standard RAG vs TrustRAG       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │ PostgreSQL 16         │
                    │ documents / chunks    │
                    │ claims / IOCs / ATT&CK│
                    │ generations / evals   │
                    │ append-only audit log │
                    └───────────────────────┘
```

### Backend modules

- `app/api/routers/` — thin HTTP layer with dependency-injected sessions and actors.
- `app/services/` — ingestion, chunking, embeddings, BM25 + semantic retrieval, Gemini client, RAG orchestration, claim verification, trust engine, IOC extraction, MITRE mapping, evaluation, dashboard aggregation, audit chain.
- `app/models/` — SQLAlchemy 2 declarative models with foreign keys and indexes.
- `app/schemas/` — Pydantic request/response contracts.
- `alembic/` — async Alembic environment and the initial PostgreSQL migration.

---

## Feature overview

| Area | What is implemented |
| --- | --- |
| **Ingestion** | PDF (`pypdf`/`pdfplumber`), TXT, Markdown; SHA-256 content hashing; TLP WHITE/GREEN/AMBER/RED; provenance and authority metadata; duplicate detection by digest |
| **Chunking** | Section-header detection (Markdown, numbered, ALL-CAPS, known CTI headings), breadcrumb headers, page references, sliding windows with configurable overlap |
| **Retrieval** | Dual-vector hybrid search: Okapi BM25 keyword scoring + cosine semantic similarity; configurable blend; TLP clearance ceiling; document scoping; page/section-aware evidence |
| **Generation** | Google Gemini via the official `google-genai` SDK; ordered multi-model fallback; strict `<UNTRUSTED_CTI_EVIDENCE>` boundaries; citation markers `[E1]`, `[E2]`; `INSUFFICIENT_EVIDENCE` fallback |
| **Verification** | Atomic claim decomposition; three-state entailment (`SUPPORTED` / `CONTRADICTED` / `UNRESOLVED`); conservative thresholds; weak model labels downgraded to `UNRESOLVED`; contradiction requires aligned evidence |
| **Trust** | Six weighted factors; interactive weights; safety gates for no evidence and prompt injection; abstain/review thresholds; component-level explainability |
| **IOCs** | IPv4, domain, URL, MD5, SHA-1, SHA-256; refanging input; safe defanging on display; confidence and context snippets; persistence and stats |
| **MITRE ATT&CK** | Curated authentic Enterprise matrix (14 tactics, 149 techniques); deterministic explainable mapping; every candidate starts `PENDING` and requires analyst approval or rejection |
| **Audit** | Append-only SHA-256 hash chain; PostgreSQL advisory lock for serialised appends; chain verification endpoint; tamper detection |
| **Evaluation** | Same question across Standalone LLM, Standard RAG, and TrustRAG-Agent; groundedness, citation coverage, verification ratio, trust score, abstention, latency, and cost proxies |
| **Dashboard** | Verification ratios, trust distribution, IOC distribution, TLP mix, top ATT&CK techniques, recent activity, and KPI cards |

---

## Repository layout

```
trustrag-agent/
├── backend/
│   ├── alembic/                  # async migration environment
│   │   └── versions/0001_initial_schema.py
│   ├── app/
│   │   ├── api/routers/          # REST endpoints
│   │   ├── core/                 # settings, logging, exceptions
│   │   ├── data/                 # MITRE ATT&CK catalogue JSON
│   │   ├── db/                   # engine, session, declarative base
│   │   ├── models/               # SQLAlchemy ORM models
│   │   ├── schemas/              # Pydantic contracts
│   │   ├── services/             # business logic
│   │   └── main.py               # FastAPI app, middleware, lifespan
│   ├── tests/                    # pytest suite (no PostgreSQL required)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── pytest.ini
├── frontend/
│   ├── src/
│   │   ├── components/           # layout, UI primitives, charts, badges
│   │   ├── hooks/                # typed resource loader
│   │   ├── lib/                  # API client, types, formatting, tones
│   │   └── pages/                # nine analyst workspaces
│   ├── Dockerfile
│   ├── nginx.conf
│   └── vite.config.ts
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Quickstart with Docker Compose

### Prerequisites

- Docker Engine 24+ with Compose v2
- A Google Gemini API key for live generation (optional for offline UI evaluation)

### 1. Configure the environment

```bash
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY, plus a strong POSTGRES_PASSWORD.
```

Secrets stay server-side. The frontend never receives `GOOGLE_API_KEY` or `DATABASE_URL`.

### 2. Start the stack

```bash
docker compose up --build
```

Services:

| Service | URL | Notes |
| --- | --- | --- |
| Frontend | <http://localhost:8080> | nginx SPA + `/api` reverse proxy |
| Backend API | <http://localhost:8000> | FastAPI |
| OpenAPI docs | <http://localhost:8000/docs> | Swagger UI |
| PostgreSQL | `localhost:5432` | named volume `trustrag_pgdata` |

The backend container runs `alembic upgrade head` on startup, then seeds the MITRE catalogue. The frontend waits for a healthy backend.

### 3. First run

1. Open <http://localhost:8080>.
2. Set the acting analyst in the sidebar. This is sent as the `X-Actor` header and recorded in audit events.
3. Go to **CTI Corpus**, upload a PDF/TXT/Markdown advisory, and confirm the chunk/IOC/ATT&CK counts.
4. Go to **Ask TrustRAG**, ask a question answerable from that document, and inspect:
   - cited evidence with page/section references,
   - claim-by-claim verification,
   - trust components and safety flags,
   - the final `ANSWER` / `HUMAN_REVIEW` / `ABSTAIN` decision.
5. Review extracted indicators under **Indicators** and approve/reject ATT&CK candidates under **ATT&CK Mapping**.

To stop:

```bash
docker compose down
```

To remove the database volume as well:

```bash
docker compose down -v
```

---

## Local development

### Backend

Requirements: Python 3.11+ (3.12 recommended).

```bash
cd backend
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

Configuration is loaded automatically by `pydantic-settings` from `backend/.env` (when running from `backend/`) or a repository-root `.env`. Environment variables always win. Start from the template:

```bash
# from the repository root
cp .env.example .env
```

#### Option A - SQLite (zero install, fastest local start)

No database server required. Set these values in `.env`; tables are created at startup:

```dotenv
DATABASE_URL=sqlite+aiosqlite:///./trustrag_dev.db
AUTO_CREATE_SCHEMA=true
```

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

#### Option B - PostgreSQL (matches production)

Requirements: PostgreSQL 16 running locally.

```dotenv
DATABASE_URL=postgresql+asyncpg://trustrag:trustrag_dev_password@localhost:5432/trustrag
AUTO_CREATE_SCHEMA=false
```

```bash
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`AUTO_CREATE_SCHEMA=true` is a development convenience; prefer migrations everywhere else.

Health check: `curl http://127.0.0.1:8000/api/health` (or the alias `http://127.0.0.1:8000/health`). Both return the same JSON.

### Frontend

Requirements: Node.js 20+ and npm.

```bash
cd frontend
npm install
npm run dev
```

Vite serves <http://localhost:5173>. It proxies `/api` to `VITE_PROXY_TARGET` (default `http://127.0.0.1:8000`). Set a different target in `frontend/.env` if the backend runs elsewhere:

```dotenv
VITE_PROXY_TARGET=http://127.0.0.1:8000
```

Production build:

```bash
npm run build
npm run preview
```

`npm run build` runs `tsc --noEmit` first, then emits `dist/`.

---

## Configuration

All settings are read from environment variables or a `.env` file (`backend/.env` when running from `backend/`, or a repository-root `.env`). See [`.env.example`](.env.example) for the full template.

### Runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | `development`, `production`, or `test` |
| `DEBUG` | `false` | Verbose diagnostics |
| `LOG_LEVEL` | `INFO` | Python log level |
| `CORS_ORIGINS` | localhost dev origins | Comma-separated allowed browser origins |

### Database

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://…/trustrag` | Async SQLAlchemy URL |
| `DB_POOL_SIZE` | `10` | Connection pool size |
| `DB_MAX_OVERFLOW` | `20` | Pool overflow |
| `DB_ECHO` | `false` | SQL echo logging |
| `AUTO_CREATE_SCHEMA` | `false` | Create tables from metadata at boot (dev only) |

### Gemini

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_API_KEY` | empty | Enables live Gemini generation, verification, and embeddings |
| `GEMINI_MODELS` | `gemini-3.8-flash,…` | Ordered fallback chain |
| `GEMINI_TEMPERATURE` | `0.2` | Generation temperature |
| `GEMINI_MAX_OUTPUT_TOKENS` | `2048` | Output cap |
| `GEMINI_TIMEOUT_SECONDS` | `30` | Per-request timeout |
| `GEMINI_MAX_RETRIES` | `2` | Retry attempts per model |
| `ALLOW_OFFLINE_LLM_FALLBACK` | `true` | Enable clearly labelled extractive fallback when Gemini is unavailable |

### Embeddings and retrieval

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBEDDING_PROVIDER` | `hashing` | `hashing` (offline) or `gemini` |
| `EMBEDDING_DIMENSIONS` | `384` | Vector dimensions |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Used when provider is `gemini` |
| `RETRIEVAL_DEFAULT_TOP_K` | `8` | Default evidence count |
| `RETRIEVAL_SEMANTIC_WEIGHT` | `0.6` | Semantic share of the hybrid score |
| `RETRIEVAL_BM25_K1` / `_B` | `1.5` / `0.75` | BM25 parameters |
| `RETRIEVAL_MAX_CANDIDATES` | `20000` | Candidate cap before ranking |

> The default `hashing` provider is a deterministic local feature-hashing embedder. It keeps ingestion and tests fully offline, but it is **not** a neural semantic model. For production semantic quality, set `EMBEDDING_PROVIDER=gemini` and provide `GOOGLE_API_KEY`.

### Chunking, trust, and limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` / `CHUNK_MIN_SIZE` | `1400` / `220` / `200` | Sliding window characters |
| `TRUST_WEIGHT_*` | see `.env.example` | Six default trust weights |
| `TRUST_ABSTAIN_THRESHOLD` | `40` | Below this score: `ABSTAIN` |
| `TRUST_REVIEW_THRESHOLD` | `65` | Between thresholds: `HUMAN_REVIEW` |
| `ENTAILMENT_SUPPORT_THRESHOLD` | `0.55` | Minimum alignment for `SUPPORTED` |
| `ENTAILMENT_CONTRADICTION_THRESHOLD` | `0.45` | Minimum alignment for `CONTRADICTED` |
| `MAX_CLAIMS_PER_ANSWER` | `15` | Claim decomposition cap |
| `MAX_UPLOAD_MB` | `25` | Upload size limit |
| `SEED_MITRE` | `true` | Seed the ATT&CK catalogue at startup |

---

## API overview

Base prefix: `/api`. Every response carries `X-Request-ID`. Mutating analyst actions accept an `X-Actor` header (default `analyst`).

### System

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, database status, Gemini/fallback flags |
| `GET` | `/health` | Root-level alias for `/api/health` (identical JSON) |
| `GET` | `/api/ready` | Readiness probe |
| `GET` | `/api/meta` | Non-secret runtime configuration |
| `GET` | `/api/dashboard?days=14` | Aggregated SOC metrics |

### Documents

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/documents` | Multipart upload and ingest |
| `GET` | `/api/documents` | Paginated/filterable corpus list |
| `GET` | `/api/documents/{id}` | Document detail |
| `GET` | `/api/documents/{id}/chunks` | Chunk list with page references |
| `PATCH` | `/api/documents/{id}` | Update title, TLP, provenance, authority, metadata |
| `DELETE` | `/api/documents/{id}` | Delete document and dependent rows |

Upload example:

```bash
curl -X POST http://localhost:8000/api/documents \
  -H "X-Actor: analyst" \
  -F "file=@advisory.pdf" \
  -F "title=APT-Example Advisory" \
  -F "tlp=AMBER" \
  -F "provenance=CISA AA26-001" \
  -F "authority_score=0.9"
```

### Retrieval, generation, and verification

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/retrieval/search` | Hybrid BM25 + semantic search with TLP gating |
| `POST` | `/api/gemini/generate` | Grounded answer + evidence + injection + trust |
| `POST` | `/api/gemini/verify-claims` | Decompose and verify claims |
| `GET` | `/api/gemini/generations` | Generation history |
| `GET` | `/api/gemini/generations/{id}` | Full generation detail |

Generation example:

```bash
curl -X POST http://localhost:8000/api/gemini/generate \
  -H "Content-Type: application/json" \
  -H "X-Actor: analyst" \
  -d '{
    "question": "Which initial access technique did APT-Example use?",
    "top_k": 8,
    "semantic_weight": 0.6,
    "tlp_max": "AMBER"
  }'
```

Verification example:

```bash
curl -X POST http://localhost:8000/api/gemini/verify-claims \
  -H "Content-Type: application/json" \
  -H "X-Actor: analyst" \
  -d '{
    "generation_id": "00000000-0000-0000-0000-000000000000",
    "persist": true
  }'
```

### Trust, IOCs, ATT&CK, audit, evaluation

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/trust/weights` | Default trust weights |
| `GET` | `/api/trust/thresholds` | Abstain/review/support thresholds |
| `POST` | `/api/trust/score` | Score ad-hoc factors or a persisted generation |
| `GET` | `/api/iocs` | Paginated indicator list |
| `GET` | `/api/iocs/stats` | IOC type distribution |
| `POST` | `/api/iocs/extract` | Extract IOCs from text |
| `POST` | `/api/iocs/documents/{id}/extract` | Re-extract and persist document IOCs |
| `GET` | `/api/mitre/matrix` | ATT&CK tactics and techniques |
| `GET` | `/api/mitre/candidates` | Pending/approved/rejected candidates |
| `POST` | `/api/mitre/map` | Map a document to candidate techniques |
| `PATCH` | `/api/mitre/candidates/{id}` | Analyst approve/reject decision |
| `GET` | `/api/mitre/stats` | Validation statistics |
| `GET` | `/api/audit/logs` | Immutable audit events |
| `GET` | `/api/audit/verify` | Recompute and verify the hash chain |
| `POST` | `/api/evaluation/run` | Run the three-way benchmark |
| `GET` | `/api/evaluation/summary` | Aggregate metrics by mode |
| `GET` | `/api/evaluation/batches` | Recent evaluation batches |
| `GET` | `/api/evaluation/batches/{id}` | One evaluation batch |

Interactive documentation is available at `/docs` and `/redoc`. The OpenAPI document is served from `/api/openapi.json` and deliberately contains no secrets.

---

## Trust model

Each answer is scored 0–100 from six normalised factors:

| Factor | Meaning |
| --- | --- |
| **Provenance** | Reliability of the source format and declared chain of custody |
| **Authority** | Analyst-assessed credibility of the publisher/document |
| **Relevance** | Strength of the hybrid retrieval match |
| **Entailment** | Degree to which atomic claims are supported by evidence |
| **Freshness** | Recency of the CTI, with a 180-day exponential half-life |
| **Model confidence** | Coverage/consistency signal from the generation step |

Weights are normalised to sum to 1. The API and UI expose the default weights, allow interactive re-weighting, and return every component's raw value, normalised weight, and contribution.

### Safety gates

- `evidence_count <= 0` → score forced to **0**, decision **ABSTAIN**, flag `no_evidence`.
- **HIGH** prompt-injection risk → score capped below the review threshold, flag `prompt_injection_high`.
- **MEDIUM** prompt-injection risk → score capped at 89, flag `prompt_injection_medium`.
- Low entailment, weak retrieval, and low model confidence add explicit flags.

### Decisions

| Band | Score | Decision |
| --- | --- | --- |
| `TRUSTED` | `>= 65` (default) | `ANSWER` |
| `REVIEW` | `40–64.99` | `HUMAN_REVIEW` |
| `ABSTAIN` | `< 40` or no evidence | `ABSTAIN` |

Thresholds are configurable server-side. Abstention is a feature, not an error: it is the correct result when the evidence cannot support an operational claim.

---

## Evidence grounding and prompt-injection defence

- Evidence is wrapped in strict `<UNTRUSTED_CTI_EVIDENCE>` delimiters in every RAG and verification prompt.
- Delimiter spoofing, zero-width characters, chat role markers, instruction overrides, system-prompt probing, secret exfiltration, citation suppression, and tool-invocation attempts are detected by heuristics.
- Evidence is sanitised before interpolation (`sanitize_untrusted_text`, `escape_for_prompt`) and capped by length.
- The system prompt explicitly states that evidence is data, never instructions, and requires `INSUFFICIENT_EVIDENCE` when support is missing.
- Claim verification is conservative even when the model is not:
  - `SUPPORTED` is granted only above the entailment support threshold.
  - Weak model labels are downgraded to `UNRESOLVED`.
  - `CONTRADICTED` requires sufficient alignment/evidence; unsupported contradictions fall back to `UNRESOLVED`.
- Injection risk feeds directly into the trust engine, so a poisoned document cannot silently produce a high-trust answer.

---

## Evaluation centre

The Evaluation Centre runs the same question through three modes and persists comparable results:

1. **Standalone LLM** — no retrieval; tests parametric knowledge and hallucination risk.
2. **Standard RAG** — retrieval plus a conventional context prompt; no claim verification or trust gates.
3. **TrustRAG-Agent** — TLP-gated hybrid retrieval, injection checks, claim verification, and multi-factor trust scoring with abstention.

Recorded metrics include groundedness, citation coverage, supported/contradicted/unresolved ratios, trust score, trust decision, latency, token/cost proxies, and a per-batch winner. Aggregate summaries are available per mode so grounding strategies can be compared over time.

The evaluation is an **operational comparison harness**, not a peer-reviewed benchmark. Results depend on the corpus, question set, model versions, and thresholds.

---

## Testing

The backend suite is independent of PostgreSQL and Gemini:

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

Coverage includes:

- section-aware chunking, page references, overlap, and hard splitting,
- IOC extraction, refanging/defanging, deduplication, and false-positive filtering,
- prompt-injection detection, sanitisation, merge semantics, and prompt contracts,
- trust scoring, normalised weights, freshness decay, safety gates, and band decisions,
- hybrid retrieval primitives and TLP clearance ordering,
- append-only audit chain verification, tamper detection, and deletion detection (using in-memory SQLite),
- MITRE catalogue integrity (14 tactics, 149 techniques, unique IDs, tactic coverage),
- OpenAPI route contract and secret-leak checks.

Frontend verification:

```bash
cd frontend
npm run typecheck
npm run build
```

---

## Security notes

- **Secrets are server-side only.** `GOOGLE_API_KEY` and `DATABASE_URL` are read by FastAPI, never bundled into the frontend. nginx and Vite proxy `/api` so the browser has no direct backend secret.
- **Prompt injection is treated as untrusted input.** Evidence is delimited, sanitised, scanned, and factored into trust.
- **TLP gating is enforced during retrieval.** A request's `tlp_max` ceiling prevents higher-classification chunks from entering the evidence set.
- **The audit log is append-only by application design.** Each row hashes the previous row; PostgreSQL advisory locking serialises concurrent appends; `/api/audit/verify` recomputes the chain.
- **Uploads are bounded** by `MAX_UPLOAD_MB` and parsed from memory; only PDF/TXT/Markdown are accepted.
- **Errors use a stable envelope** with request IDs; internal stack traces are not returned to clients.
- **CORS is explicitly configured.** Replace the development origins before production.
- **The API currently has no end-user authentication.** `X-Actor` is attribution, not authorization. Put the stack behind an identity-aware proxy or add OIDC/auth before exposing it.

For production:

1. Use a strong `POSTGRES_PASSWORD` and a managed secret store.
2. Set `ENVIRONMENT=production`, `DEBUG=false`, `ALLOW_OFFLINE_LLM_FALLBACK=false`.
3. Run Alembic migrations as a deployment step; keep `AUTO_CREATE_SCHEMA=false`.
4. Terminate TLS in front of nginx and restrict `CORS_ORIGINS`.
5. Add authentication/authorization and per-analyst rate limits.
6. Back up PostgreSQL and export/verify the audit chain regularly.

---

## Limitations and non-goals

- **No authentication or RBAC** is included. The `X-Actor` header is self-asserted and must sit behind a trusted identity layer.
- **TLP gating is application-level.** It is not a substitute for network segmentation or database row-level security.
- **The default embedder is feature hashing, not a neural model.** Semantic retrieval quality improves materially with `EMBEDDING_PROVIDER=gemini`.
- **Offline fallback is degraded by design.** It produces extractive, clearly labelled answers for local smoke testing; it is not equivalent to Gemini generation and should be disabled in production.
- **Claim verification depends on the model's decomposition and entailment quality.** Conservative thresholds reduce false support but can increase `UNRESOLVED`.
- **Trust scores are decision support, not ground truth.** They encode configured heuristics and analyst-assessed metadata, not a certified risk model.
- **The ATT&CK catalogue is a curated authentic subset** of the Enterprise matrix (14 tactics, 149 techniques), not a live sync of every ATT&CK release.
- **The audit chain detects tampering within the application's own writes.** It cannot protect against an attacker with full database and application control; external anchoring/WORM storage would be required for stronger guarantees.
- **IOC extraction is regex-based.** It covers IPv4/domain/URL/MD5/SHA-1/SHA-256; it does not parse CVE-to-exploit graphs, email indicators, or YARA rules.
- **Evaluation is not a formal benchmark.** It compares strategies on the supplied corpus and question set.
- **No background job queue.** Ingestion and evaluation run synchronously in the request; very large corpora should be moved to a worker model.
- **No live feeds or external enrichment.** Threat-intel feeds, WHOIS, passive DNS, and sandbox lookups are out of scope.

---

## Troubleshooting

### Backend starts but `/api/ready` is degraded

Check PostgreSQL connectivity and that migrations have run:

```bash
docker compose logs db backend
docker compose exec backend alembic current
```

### MITRE matrix is empty

The startup seed logs an error and lets the API run in a degraded state. Confirm `SEED_MITRE=true`, migrations are applied, and the backend can write to PostgreSQL. Re-run the backend after fixing the database.

### `Gemini not configured` in the footer

`GOOGLE_API_KEY` is unset or blank. Live generation/verification requires a key. Ingestion, retrieval, IOC extraction, ATT&CK mapping, audit, and dashboard views work without it; generation uses the offline fallback when enabled.

### Frontend shows `API offline`

- Confirm the backend is on port 8000.
- In development, verify `VITE_PROXY_TARGET`.
- In Docker, confirm the frontend and backend containers are healthy and on the same Compose network.

### Upload rejected

Check the file extension (`.pdf`, `.txt`, `.md`, `.markdown`), the `MAX_UPLOAD_MB` limit, and whether the same SHA-256 digest has already been ingested.

### Audit verification fails

A failure means an audit row was modified, deleted, or reordered. The response identifies the first broken entry ID. Preserve the database and investigate before continuing; do not silently delete audit rows.

---

## License

No license file is included in this repository. Add one before distributing or deploying outside your organisation.
