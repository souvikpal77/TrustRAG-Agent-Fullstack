import type {
  AuditLogListResponse,
  AuditVerifyResponse,
  CandidateDecisionRequest,
  ChunkOut,
  DashboardResponse,
  DocumentDetail,
  DocumentSummary,
  DocumentUpdate,
  DocumentUploadInput,
  DocumentUploadResponse,
  EvaluationBatchResponse,
  EvaluationRequest,
  EvaluationRunListItem,
  EvaluationRunOut,
  EvaluationSummaryResponse,
  GenerateRequest,
  GenerateResponse,
  GenerationDetail,
  GenerationSummary,
  HealthResponse,
  IOCExtractResponse,
  IOCExtractionPersistResponse,
  IOCListResponse,
  IOCStats,
  IOCType,
  MessageResponse,
  MitreCandidateListResponse,
  MitreCandidateOut,
  MitreMapResponse,
  MitreMatrixResponse,
  MitreStatsResponse,
  Paginated,
  RetrievalRequest,
  RetrievalResponse,
  RuntimeMetaResponse,
  TLPLevel,
  TrustScoreRequest,
  TrustScoreResponse,
  TrustThresholds,
  TrustWeights,
  VerifyClaimsRequest,
  VerifyClaimsResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const ACTOR_KEY = "trustrag.actor";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; requestId?: string | null; details?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? "error";
    this.requestId = options.requestId ?? null;
    this.details = options.details;
  }
}

export function getActor(): string {
  try {
    return window.localStorage.getItem(ACTOR_KEY)?.trim() || "analyst";
  } catch {
    return "analyst";
  }
}

export function setActor(actor: string): void {
  try {
    window.localStorage.setItem(ACTOR_KEY, actor.trim() || "analyst");
  } catch {
    // Storage can be unavailable in hardened browsers; the header still defaults.
  }
}

function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, String(entry));
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Actor", getActor());
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? `Network error: ${error.message}`
        : "Network error while contacting the TrustRAG API.",
      { status: 0, code: "network_error", details: error },
    );
  }

  if (!response.ok) {
    let payload: any = null;
    let fallback = response.statusText || `Request failed with status ${response.status}`;
    try {
      payload = await response.json();
    } catch {
      try {
        fallback = (await response.text()) || fallback;
      } catch {
        // Response body is not readable; keep the status text.
      }
    }
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : Array.isArray(payload?.detail)
          ? payload.detail.map((item: any) => item?.msg ?? String(item)).join("; ")
          : fallback;
    throw new ApiError(detail, {
      status: response.status,
      code: payload?.code,
      requestId: payload?.request_id ?? response.headers.get("X-Request-ID"),
      details: payload?.errors ?? payload?.context ?? payload,
    });
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export const api = {
  baseUrl: API_BASE,

  // ------------------------------------------------------------------ system
  health: () => request<HealthResponse>("/api/health"),
  meta: () => request<RuntimeMetaResponse>("/api/meta"),

  // --------------------------------------------------------------- documents
  listDocuments: (params: {
    page?: number;
    page_size?: number;
    q?: string;
    tlp?: TLPLevel | "";
    source_type?: string;
    status?: string;
  }) => request<Paginated<DocumentSummary>>(`/api/documents${buildQuery(params)}`),

  getDocument: (id: string) => request<DocumentDetail>(`/api/documents/${id}`),

  listChunks: (id: string, params: { page?: number; page_size?: number }) =>
    request<Paginated<ChunkOut>>(`/api/documents/${id}/chunks${buildQuery(params)}`),

  uploadDocument: (input: DocumentUploadInput) => {
    const form = new FormData();
    form.append("file", input.file);
    if (input.title?.trim()) form.append("title", input.title.trim());
    form.append("tlp", input.tlp);
    if (input.provenance?.trim()) form.append("provenance", input.provenance.trim());
    form.append("authority_score", String(input.authority_score));
    if (input.published_at) form.append("published_at", input.published_at);
    return request<DocumentUploadResponse>("/api/documents", {
      method: "POST",
      body: form,
    });
  },

  updateDocument: (id: string, payload: DocumentUpdate) =>
    request<DocumentSummary>(`/api/documents/${id}`, {
      method: "PATCH",
      body: jsonBody(payload),
    }),

  deleteDocument: (id: string) =>
    request<MessageResponse>(`/api/documents/${id}`, { method: "DELETE" }),

  // --------------------------------------------------------------- retrieval
  search: (payload: RetrievalRequest) =>
    request<RetrievalResponse>("/api/retrieval/search", {
      method: "POST",
      body: jsonBody(payload),
    }),

  // --------------------------------------------------------------- generation
  generate: (payload: GenerateRequest) =>
    request<GenerateResponse>("/api/gemini/generate", {
      method: "POST",
      body: jsonBody(payload),
    }),

  verifyClaims: (payload: VerifyClaimsRequest) =>
    request<VerifyClaimsResponse>("/api/gemini/verify-claims", {
      method: "POST",
      body: jsonBody(payload),
    }),

  listGenerations: (params: { page?: number; page_size?: number; q?: string }) =>
    request<Paginated<GenerationSummary>>(`/api/gemini/generations${buildQuery(params)}`),

  getGeneration: (id: string) => request<GenerationDetail>(`/api/gemini/generations/${id}`),

  // ------------------------------------------------------------------- trust
  getWeights: () => request<TrustWeights>("/api/trust/weights"),
  getThresholds: () => request<TrustThresholds>("/api/trust/thresholds"),
  scoreTrust: (payload: TrustScoreRequest) =>
    request<TrustScoreResponse>("/api/trust/score", {
      method: "POST",
      body: jsonBody(payload),
    }),

  // -------------------------------------------------------------------- iocs
  listIocs: (params: {
    page?: number;
    page_size?: number;
    type?: IOCType | "";
    q?: string;
    document_id?: string;
  }) => request<IOCListResponse>(`/api/iocs${buildQuery(params)}`),

  iocStats: () => request<IOCStats>("/api/iocs/stats"),

  extractIocs: (text: string) =>
    request<IOCExtractResponse>("/api/iocs/extract", {
      method: "POST",
      body: jsonBody({ text, defang: true }),
    }),

  extractDocumentIocs: (documentId: string) =>
    request<IOCExtractionPersistResponse>(`/api/iocs/documents/${documentId}/extract`, {
      method: "POST",
    }),

  // ------------------------------------------------------------------- mitre
  mitreMatrix: () => request<MitreMatrixResponse>("/api/mitre/matrix"),

  listMitreCandidates: (params: {
    page?: number;
    page_size?: number;
    status?: string;
    document_id?: string;
    technique_id?: string;
  }) => request<MitreCandidateListResponse>(`/api/mitre/candidates${buildQuery(params)}`),

  mapMitre: (payload: { document_id: string; max_candidates?: number; replace_existing?: boolean }) =>
    request<MitreMapResponse>("/api/mitre/map", {
      method: "POST",
      body: jsonBody(payload),
    }),

  decideMitreCandidate: (id: string, payload: CandidateDecisionRequest) =>
    request<MitreCandidateOut>(`/api/mitre/candidates/${id}`, {
      method: "PATCH",
      body: jsonBody(payload),
    }),

  mitreStats: () => request<MitreStatsResponse>("/api/mitre/stats"),

  // ------------------------------------------------------------------- audit
  listAudit: (params: {
    page?: number;
    page_size?: number;
    action?: string;
    entity_type?: string;
    entity_id?: string;
  }) => request<AuditLogListResponse>(`/api/audit/logs${buildQuery(params)}`),

  verifyAudit: () => request<AuditVerifyResponse>("/api/audit/verify"),

  // -------------------------------------------------------------- evaluation
  runEvaluation: (payload: EvaluationRequest) =>
    request<EvaluationBatchResponse>("/api/evaluation/run", {
      method: "POST",
      body: jsonBody(payload),
    }),

  evaluationSummary: () => request<EvaluationSummaryResponse>("/api/evaluation/summary"),

  listEvaluationBatches: (params: { page?: number; page_size?: number }) =>
    request<EvaluationRunListItem[]>(`/api/evaluation/batches${buildQuery(params)}`),

  getEvaluationBatch: (batchId: string) =>
    request<EvaluationRunOut[]>(`/api/evaluation/batches/${batchId}`),

  // --------------------------------------------------------------- dashboard
  dashboard: (days = 14) => request<DashboardResponse>(`/api/dashboard${buildQuery({ days })}`),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const request = error.requestId ? ` (request ${error.requestId.slice(0, 12)})` : "";
    return `${error.message}${request}`;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
}
