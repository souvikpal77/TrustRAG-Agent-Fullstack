# API Reference

Interactive docs: `/docs` (Swagger UI) and `/redoc`.
Machine-readable contract: `/api/openapi.json`.

## Conventions

| Item | Value |
| --- | --- |
| Base prefix | `/api` |
| Content type | `application/json` (uploads: `multipart/form-data`) |
| Actor header | `X-Actor: <name>` on mutating analyst actions (default `analyst`) |
| Request correlation | `X-Request-ID` accepted and always returned |
| Timestamps | ISO-8601 UTC |
| Pagination | `page` (1-based) and `page_size` (bounded server-side) |
| Filtering/sorting | Query parameters per endpoint; documented in OpenAPI |

### Versioning note

The prompt's reference architecture suggests `/api/v1`. This project already
ships `/api` and the deployed frontend, nginx config, Vercel rewrite, and
external callers depend on it. Renaming the prefix would be a breaking change
with no functional benefit, so `/api` is retained as the stable contract.
A future version can be added additively at `/api/v2` while `/api` remains an
alias during a deprecation window.

### Error envelope

All handled errors return the same shape:

```json
{
  "detail": "Human-readable message",
  "code": "validation_error | http_error | internal_error | <domain_code>",
  "request_id": "…",
  "context": {},
  "errors": []
}
```

`context` and `errors` appear only where relevant. A 500 never includes a
stack trace, SQL, credentials, or upstream response bodies.

### Health and metadata

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, database status, version, Gemini/fallback flags |
| `GET` | `/health` | Root alias of `/api/health` (hidden from schema) |
| `GET` | `/api/ready` | Readiness probe (database only) |
| `GET` | `/api/meta` | Non-secret runtime configuration |
| `GET` | `/api/dashboard?days=14` | Aggregated SOC metrics (1–90 days) |

## Documents

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/api/documents` | multipart: `file`, `title?`, `tlp`, `provenance?`, `authority_score`, `published_at?` | `DocumentUploadResponse` |
| `GET` | `/api/documents` | `page`, `page_size`, `q`, `tlp`, `source_type`, `status` | `Paginated<DocumentSummary>` |
| `GET` | `/api/documents/{id}` | — | `DocumentDetail` |
| `GET` | `/api/documents/{id}/chunks` | `page`, `page_size` | `Paginated<ChunkOut>` |
| `PATCH` | `/api/documents/{id}` | `DocumentUpdate` (title, tlp, provenance, authority, metadata, published_at) | `DocumentSummary` |
| `DELETE` | `/api/documents/{id}` | — | `MessageResponse` |

Upload constraints: PDF/TXT/Markdown, maximum `MAX_UPLOAD_MB` (default 25),
SHA-256 duplicates rejected with `409`, invalid files rejected with `4xx`.
Deleting a document cascades to chunks, IOCs, and MITRE candidates.

## Retrieval

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/api/retrieval/search` | `RetrievalRequest` (`query`, `top_k?`, `semantic_weight?`, `tlp_max?`, `document_ids?`, `min_score?`, `expand_query?`) | `RetrievalResponse` |

Returns ranked chunks with `bm25_score`, `semantic_score`, `hybrid_score`,
document authority, section header, and page range. Documents above the TLP
ceiling are excluded before scoring.

## Generation and verification

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/api/gemini/generate` | `GenerateRequest` (`question`, `top_k?`, `semantic_weight?`, `tlp_max?`, `document_ids?`, `persist?`, `model?`) | `GenerateResponse` |
| `POST` | `/api/gemini/verify-claims` | `VerifyClaimsRequest` (`generation_id?`, `answer?`, `evidence_chunk_ids?`, `persist?`) | `VerifyClaimsResponse` |
| `GET` | `/api/gemini/generations` | `page`, `page_size`, `q` | `Paginated<GenerationSummary>` |
| `GET` | `/api/gemini/generations/{id}` | — | `GenerationDetail` |

`GenerateResponse` includes: answer, model used, `degraded`, latency, evidence
list, injection assessment, trust score/breakdown, citation coverage, warnings,
and `generation_id` when persisted. With no API key the service returns a
labelled offline extractive answer and `degraded: true`; it does not pretend a
model produced it.

## Trust

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/trust/weights` | — | `TrustWeights` |
| `GET` | `/api/trust/thresholds` | — | `TrustThresholds` |
| `POST` | `/api/trust/score` | `TrustScoreRequest` (factors and/or `generation_id`) | `TrustScoreResponse` |

Scoring is deterministic. `evidence_count <= 0` forces score `0` and `ABSTAIN`.
High injection risk caps the score below the review threshold.

## IOCs

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/iocs` | `page`, `page_size`, `type`, `q`, `document_id` | `IOCListResponse` |
| `GET` | `/api/iocs/stats` | — | `IOCStats` |
| `POST` | `/api/iocs/extract` | `{ "text": "...", "defang": true }` | `IOCExtractResponse` |
| `POST` | `/api/iocs/documents/{id}/extract` | — | `IOCExtractionPersistResponse` |

Extraction is deterministic (regex/validation) and always returns defanged
values. Re-extraction is idempotent per document via a unique constraint.

## MITRE ATT&CK

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/mitre/matrix` | — | `MitreMatrixResponse` |
| `GET` | `/api/mitre/candidates` | `page`, `page_size`, `status`, `document_id`, `technique_id` | `MitreCandidateListResponse` |
| `POST` | `/api/mitre/map` | `{ document_id, max_candidates?, replace_existing? }` | `MitreMapResponse` |
| `PATCH` | `/api/mitre/candidates/{id}` | `CandidateDecisionRequest` (`status`, `reviewed_by?`, `note?`) | `MitreCandidateOut` |
| `GET` | `/api/mitre/stats` | — | `MitreStatsResponse` |

The catalog is seeded at startup from `backend/app/data/mitre_enterprise.json`.
Candidates are suggestions until an analyst approves or rejects them.

## Audit

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/api/audit/logs` | `page`, `page_size`, `action`, `entity_type`, `entity_id` | `AuditLogListResponse` |
| `GET` | `/api/audit/verify` | — | `AuditVerifyResponse` |

Rows are append-only. Each entry hashes the previous entry hash, so any
mutation or deletion is detectable by `verify`.

## Evaluation

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/api/evaluation/run` | `EvaluationRequest` (`question`, `document_ids?`, `top_k?`, `semantic_weight?`, `expected_iocs?`, `persist?`) | `EvaluationBatchResponse` |
| `GET` | `/api/evaluation/summary` | — | `EvaluationSummaryResponse` |
| `GET` | `/api/evaluation/batches` | `page`, `page_size` | `EvaluationRunListItem[]` |
| `GET` | `/api/evaluation/batches/{batch_id}` | — | `EvaluationRunOut[]` |

Modes: `STANDALONE`, `STANDARD_RAG`, `TRUSTRAG`; every run evaluates all three
for the same question. Metrics are computed from real runs and persisted; the
UI never fabricates comparison data.

## HTTP status usage

| Status | Meaning |
| --- | --- |
| `200` | Success |
| `201` | Resource created (upload) |
| `204` | Not used; deletes return `200` with a `MessageResponse` |
| `400` | Invalid operation for the current state |
| `404` | Resource not found |
| `409` | Duplicate or conflicting state |
| `413` | Upload exceeds size limit |
| `422` | Pydantic validation failure |
| `502`/`503` | Upstream model or dependency unavailable |
