# Database Schema

PostgreSQL is the system of record. **Alembic is the only schema authority**;
the ORM models must match the migrations. `database/` contains documentation
only — there is no second migration mechanism.

- Migration: `backend/alembic/versions/0001_initial_schema.py`
- ORM models: `backend/app/models/`
- Declarative base and naming conventions: `backend/app/db/base.py`
- Engine/session: `backend/app/db/session.py`

## Entity relationship overview

```
documents 1 ──< chunks
documents 1 ──< iocs >── 0..1 chunks
documents 1 ──< mitre_candidates >── 1 mitre_techniques >── 1 mitre_tactics
generations 1 ──< claims
evaluation_runs        (independent, grouped by batch_id)
audit_logs             (append-only hash chain, no FKs by design)
```

## Tables

### `documents`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `title` | varchar(512) | not null |
| `filename` | varchar(512) | stored name |
| `original_filename` | varchar(512) | client name |
| `content_type` | varchar(128) | MIME type |
| `source_type` | varchar(16) | `PDF`, `TXT`, `MARKDOWN` |
| `tlp` | varchar(16) | `WHITE`, `GREEN`, `AMBER`, `RED` |
| `sha256` | varchar(64) | **unique**, duplicate detection |
| `size_bytes` | bigint | |
| `page_count` | integer | |
| `char_count` | integer | |
| `raw_text` | text | extracted text |
| `provenance` | varchar(512) | declared chain of custody |
| `authority_score` | double | 0–1 analyst assessment |
| `published_at` | timestamptz | nullable |
| `status` | varchar(16) | `PROCESSED`, `FAILED` |
| `error_message` | text | nullable |
| `doc_metadata` | jsonb | extensible metadata |
| `created_at`, `updated_at` | timestamptz | UTC |

Indexes: `ix_documents_sha256` (unique), `ix_documents_created_at`,
`ix_documents_tlp_created`, `ix_documents_status_created`.

### `chunks`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `document_id` | UUID | FK → `documents.id` `ON DELETE CASCADE` |
| `chunk_index` | integer | ordering within document |
| `text` | text | |
| `char_count` | integer | |
| `token_estimate` | integer | |
| `section_header` | varchar(512) | nullable |
| `page_start`, `page_end` | integer | source page range |
| `embedding` | jsonb | L2-normalised float array |
| `created_at` | timestamptz | UTC |

Constraints/indexes: `uq_chunks_document_index` (`document_id`,
`chunk_index`), `ix_chunks_document_id`, `ix_chunks_created_at`,
`ix_chunks_document_page`.

### `generations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `question` | text | |
| `answer_text` | text | |
| `model_used` | varchar(128) | includes `offline-extractive`/`abstention` |
| `retrieval_strategy` | varchar(64) | default `hybrid-dual-vector` |
| `degraded` | boolean | true when fallback was used |
| `injection_risk` | varchar(16) | `LOW`/`MEDIUM`/`HIGH` |
| `evidence_chunk_ids` | jsonb | cited chunk IDs |
| `evidence_snapshot` | jsonb | immutable copy of retrieved evidence |
| `document_ids` | jsonb | distinct source documents |
| `trust_score` | double | nullable (unverified) |
| `trust_breakdown` | jsonb | factors, weights, flags |
| `latency_ms` | double | |
| `created_at` | timestamptz | UTC |

Indexes: `ix_generations_created_at`, `ix_generations_created_trust`.

The evidence snapshot is intentional denormalisation: an answer must remain
auditable even if the source document is later edited or deleted.

### `claims`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `generation_id` | UUID | FK → `generations.id` `ON DELETE CASCADE` |
| `claim_index` | integer | ordering |
| `claim_text` | text | atomic proposition |
| `verification_status` | varchar(20) | `SUPPORTED`, `CONTRADICTED`, `UNRESOLVED` |
| `confidence` | double | 0–1 |
| `entailment_score` | double | 0–1 |
| `rationale` | text | model/heuristic explanation |
| `evidence_chunk_ids` | jsonb | |
| `verification_meta` | jsonb | method, thresholds, raw scores |
| `created_at` | timestamptz | UTC |

Indexes: `ix_claims_generation_id`, `ix_claims_created_at`,
`ix_claims_generation_status`, `ix_claims_status_created`.

### `iocs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `value` | varchar(2048) | original |
| `normalized_value` | varchar(2048) | canonical form |
| `defanged` | varchar(2048) | safe display form |
| `ioc_type` | varchar(16) | `IPV4`, `DOMAIN`, `URL`, `SHA256`, `SHA1`, `MD5` |
| `document_id` | UUID | FK → `documents.id` `ON DELETE CASCADE`, nullable |
| `chunk_id` | UUID | FK → `chunks.id` `ON DELETE SET NULL`, nullable |
| `confidence` | double | |
| `context` | text | surrounding text |
| `created_at` | timestamptz | UTC |

Constraints/indexes: `uq_iocs_value_type_document`, `ix_iocs_normalized_value`,
`ix_iocs_document_id`, `ix_iocs_chunk_id`, `ix_iocs_created_at`,
`ix_iocs_type_value`, `ix_iocs_created_type`.

### `mitre_tactics`

`id` (UUID PK), `tactic_id` (unique), `name`, `short_name` (unique),
`description`, `order`.

### `mitre_techniques`

`technique_id` (varchar PK), `name`, `tactic_id` (FK → tactics, `RESTRICT`),
`description`, `parent_technique_id` (self-FK, `SET NULL`), `is_subtechnique`,
`platforms` (jsonb), `keywords` (jsonb), `url`.

Indexes: `ix_mitre_techniques_tactic`, `ix_mitre_techniques_parent`.

### `mitre_candidates`

`id` (UUID PK), `document_id` (FK → documents, `CASCADE`),
`technique_id` (FK → techniques, `CASCADE`), `confidence`, `rationale`,
`evidence_snippet`, `status` (`PENDING`/`APPROVED`/`REJECTED`), `reviewed_by`,
`reviewed_at`, `created_at`.

Constraints/indexes: `uq_mitre_candidates_doc_tech`,
`ix_mitre_candidates_status_confidence`, plus single-column indexes used by
filters.

### `audit_logs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK, monotonic order |
| `actor` | varchar(128) | from `X-Actor` |
| `action` | varchar(128) | e.g. `document.upload` |
| `entity_type` | varchar(64) | |
| `entity_id` | varchar(128) | nullable |
| `summary` | text | human-readable |
| `details` | jsonb | structured payload (no secrets) |
| `prev_hash` | varchar(64) | previous entry hash |
| `entry_hash` | varchar(64) | **unique**, hash of this entry |
| `created_at` | timestamptz | UTC |

Indexes: `ix_audit_logs_created_at`, `ix_audit_logs_action_created`,
`ix_audit_logs_entity`. The application never updates or deletes rows.

### `evaluation_runs`

`id` (UUID PK), `batch_id` (UUID), `question` (text), `mode`
(`STANDALONE`/`STANDARD_RAG`/`TRUSTRAG`), `answer_text`, `model_used`,
`grounded_claims`, `contradicted_claims`, `unresolved_claims`, `total_claims`,
`trust_score`, `latency_ms`, `degraded`, `document_ids` (jsonb), `metrics`
(jsonb), `created_at`.

Indexes: `ix_evaluation_runs_batch_id`, `ix_evaluation_runs_created_at`,
`ix_evaluation_runs_batch_mode`, `ix_evaluation_runs_created_mode`.

## Data types and conventions

- UUID primary keys for domain entities; bigserial for append-only audit rows.
- `timestamptz` everywhere, written in UTC. `UTCDateTime` normalises SQLite
  datetimes for tests so behaviour is identical locally and in production.
- `JSONVariant` maps to `JSONB` on PostgreSQL and `JSON` on SQLite.
- Enums are stored as constrained strings (`native_enum=False`) so adding a
  value is a code change plus data migration, not a PostgreSQL type alteration.
- All queries are parameterised through SQLAlchemy.

## Transactions and access patterns

| Operation | Transaction boundary |
| --- | --- |
| Upload | Document + chunks + IOCs committed together |
| Generate | Generation row flushed; committed by the router dependency |
| Verify claims | Claims + updated trust committed together |
| MITRE decision | Candidate update + audit event together |
| Evaluation batch | All mode runs for a batch committed together |
| Delete document | Single statement; FKs cascade |

High-frequency reads are covered by composite indexes on
`(tlp, created_at)`, `(status, created_at)`, `(created_at, trust_score)`,
`(status, confidence)`, and `(action, created_at)`.

## Migration and rollback

```bash
cd backend
alembic upgrade head          # apply
alembic current               # show current revision
alembic downgrade -1          # roll back one revision
alembic downgrade base        # empty schema (destructive)
alembic revision --autogenerate -m "describe change"
```

Rules for changes:

1. Never edit an applied migration in production; add a new revision.
2. Additive changes first (nullable columns, new tables), backfill, then add
   constraints in a later revision.
3. Every revision must implement a working `downgrade()`.
4. `AUTO_CREATE_SCHEMA` is `false` in production; only tests/local bootstrap may
   enable it.
5. Never drop or reset production data without explicit approval.

## Seeds

- MITRE ATT&CK Enterprise catalog: `backend/app/data/mitre_enterprise.json`,
  loaded idempotently at startup when `SEED_MITRE=true`.
- No synthetic documents, answers, or analytics are seeded. Dashboards and
  evaluation pages show real rows only, including genuine empty states.
