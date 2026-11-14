// Shared API contracts. Keep these in sync with backend/app/schemas/*.

export type TLPLevel = "WHITE" | "GREEN" | "AMBER" | "RED";
export type SourceType = "PDF" | "TXT" | "MARKDOWN";
export type DocumentStatus = "PROCESSED" | "FAILED";
export type IOCType = "IPV4" | "DOMAIN" | "URL" | "SHA256" | "SHA1" | "MD5";
export type VerificationStatus = "SUPPORTED" | "CONTRADICTED" | "UNRESOLVED";
export type CandidateStatus = "PENDING" | "APPROVED" | "REJECTED";
export type EvaluationMode = "STANDALONE" | "STANDARD_RAG" | "TRUSTRAG";
export type InjectionRisk = "LOW" | "MEDIUM" | "HIGH";
export type TrustBand = "ABSTAIN" | "REVIEW" | "TRUSTED";
export type TrustDecision = "ANSWER" | "HUMAN_REVIEW" | "ABSTAIN";

export interface MessageResponse {
  message: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface HealthResponse {
  status: string;
  database: string;
  version: string;
  environment: string;
  gemini_configured: boolean;
  offline_fallback: boolean;
}

export interface RuntimeMetaResponse {
  app_name: string;
  version: string;
  environment: string;
  gemini_configured: boolean;
  gemini_models: string[];
  embedding_provider: string;
  chunking: { chunk_size: number; chunk_overlap: number; min_chunk_size: number };
  retrieval: {
    default_top_k: number;
    semantic_weight: number;
    bm25_k1: number;
    bm25_b: number;
  };
  trust: {
    weights: TrustWeights;
    abstain_threshold: number;
    review_threshold: number;
    support_threshold: number;
  };
  mitre_techniques: number;
}

// ------------------------------------------------------------------ documents
export interface DocumentSummary {
  id: string;
  title: string;
  filename: string;
  original_filename: string;
  content_type: string;
  source_type: SourceType;
  tlp: TLPLevel;
  sha256: string;
  size_bytes: number;
  page_count: number;
  char_count: number;
  provenance: string;
  authority_score: number;
  published_at: string | null;
  status: DocumentStatus;
  error_message: string | null;
  chunk_count: number;
  ioc_count: number;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ChunkOut {
  id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  char_count: number;
  token_estimate: number;
  section_header: string | null;
  page_start: number;
  page_end: number;
}

export interface DocumentDetail extends DocumentSummary {
  raw_text: string;
  chunks: ChunkOut[];
}

export interface DocumentUploadResponse {
  document: DocumentSummary;
  chunks_created: number;
  iocs_extracted: number;
  mitre_candidates: number;
}

export interface DocumentUpdate {
  title?: string;
  tlp?: TLPLevel;
  provenance?: string;
  authority_score?: number;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DocumentUploadInput {
  file: File;
  title?: string;
  tlp: TLPLevel;
  provenance?: string;
  authority_score: number;
  published_at?: string;
}

// ------------------------------------------------------------------ retrieval
export interface RetrievalRequest {
  query: string;
  document_ids?: string[];
  top_k?: number;
  semantic_weight?: number;
  tlp_max?: TLPLevel | null;
  min_score?: number;
}

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  document_title: string;
  tlp: TLPLevel;
  section_header: string | null;
  page_start: number;
  page_end: number;
  text: string;
  bm25_score: number;
  semantic_score: number;
  hybrid_score: number;
  document_authority: number;
  rank: number;
}

export interface RetrievalResponse {
  query: string;
  semantic_weight: number;
  keyword_weight: number;
  candidate_chunks: number;
  matched_terms: string[];
  results: RetrievedChunk[];
  elapsed_ms: number;
}

// ---------------------------------------------------------------------- trust
export interface TrustFactors {
  provenance: number;
  authority: number;
  relevance: number;
  entailment: number;
  freshness: number;
  model_confidence: number;
}

export interface TrustWeights extends TrustFactors {}

export interface TrustComponent {
  key: string;
  label: string;
  weight: number;
  raw_value: number;
  contribution: number;
  explanation: string;
}

export interface TrustScoreResponse {
  score: number;
  band: TrustBand;
  decision: TrustDecision;
  abstain: boolean;
  components: TrustComponent[];
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  safety_flags: string[];
  explanation: string;
  factors: Record<string, number>;
}

export interface TrustThresholds {
  abstain: number;
  review: number;
}

export interface TrustScoreRequest {
  generation_id?: string;
  factors?: TrustFactors;
  weights?: TrustWeights;
}

// ------------------------------------------------------------------- injection
export interface InjectionMatch {
  pattern: string;
  label: string;
  location: "QUESTION" | "EVIDENCE";
  excerpt: string;
}

export interface InjectionAssessment {
  risk: InjectionRisk;
  score: number;
  matches: InjectionMatch[];
  sanitized: boolean;
}

// ------------------------------------------------------------------- generate
export interface GenerateRequest {
  question: string;
  document_ids?: string[];
  top_k?: number;
  semantic_weight?: number;
  tlp_max?: TLPLevel | null;
  persist?: boolean;
  model?: string | null;
}

export interface GenerateResponse {
  generation_id: string | null;
  question: string;
  answer: string;
  model_used: string;
  degraded: boolean;
  latency_ms: number;
  evidence: RetrievedChunk[];
  injection: InjectionAssessment;
  trust: TrustScoreResponse;
  citation_coverage: number;
  warnings: string[];
}

// --------------------------------------------------------------------- claims
export interface ClaimOut {
  id: string | null;
  claim_index: number;
  claim_text: string;
  status: VerificationStatus;
  confidence: number;
  entailment_score: number;
  rationale: string;
  evidence_chunk_ids: string[];
}

export interface VerificationSummary {
  total: number;
  supported: number;
  contradicted: number;
  unresolved: number;
  supported_ratio: number;
  contradicted_ratio: number;
  unresolved_ratio: number;
  verification_ratio: number;
  abstained: boolean;
  abstention_reason: string | null;
}

export interface VerifyClaimsRequest {
  generation_id?: string | null;
  answer?: string | null;
  question?: string | null;
  evidence_chunk_ids?: string[];
  document_ids?: string[];
  persist?: boolean;
}

export interface VerifyClaimsResponse {
  generation_id: string | null;
  claims: ClaimOut[];
  summary: VerificationSummary;
  trust: TrustScoreResponse | null;
  model_used: string;
  degraded: boolean;
  elapsed_ms: number;
}

export interface GenerationSummary {
  id: string;
  question: string;
  answer_text: string;
  model_used: string;
  degraded: boolean;
  injection_risk: string;
  trust_score: number | null;
  latency_ms: number;
  evidence_count: number;
  claims_total: number;
  claims_supported: number;
  claims_contradicted: number;
  claims_unresolved: number;
  created_at: string;
}

export interface GenerationDetail extends GenerationSummary {
  claims: ClaimOut[];
  evidence: RetrievedChunk[];
  trust: TrustScoreResponse | null;
  warnings: string[];
}

// ------------------------------------------------------------------------ iocs
export interface IOCOut {
  id: string;
  value: string;
  normalized_value: string;
  defanged: string;
  ioc_type: IOCType;
  document_id: string | null;
  document_title: string | null;
  confidence: number;
  context: string;
  created_at: string;
}

export interface IOCStats {
  total: number;
  by_type: Record<string, number>;
  documents_with_iocs: number;
}

export interface IOCListResponse extends Paginated<IOCOut> {
  stats: IOCStats;
}

export interface ExtractedIOC {
  value: string;
  normalized_value: string;
  defanged: string;
  ioc_type: IOCType;
  confidence: number;
  context: string;
}

export interface IOCExtractResponse {
  count: number;
  items: ExtractedIOC[];
}

export interface IOCExtractionPersistResponse {
  document_id: string | null;
  created: number;
  updated: number;
  items: ExtractedIOC[];
}

// ----------------------------------------------------------------------- mitre
export interface TechniqueOut {
  technique_id: string;
  name: string;
  tactic_id: string;
  tactic_name: string;
  description: string;
  is_subtechnique: boolean;
  parent_technique_id: string | null;
  platforms: string[];
  keywords: string[];
  url: string;
}

export interface TacticOut {
  tactic_id: string;
  name: string;
  short_name: string;
  order: number;
  technique_count: number;
}

export interface MitreMatrixResponse {
  tactics: TacticOut[];
  techniques: TechniqueOut[];
  total_techniques: number;
  total_tactics: number;
}

export interface MitreCandidateOut {
  id: string;
  document_id: string;
  document_title: string;
  technique_id: string;
  technique_name: string;
  tactic_id: string;
  tactic_name: string;
  confidence: number;
  rationale: string;
  evidence_snippet: string;
  status: CandidateStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface MitreCandidateListResponse extends Paginated<MitreCandidateOut> {}

export interface CandidateDecisionRequest {
  status: CandidateStatus;
  reviewed_by?: string;
  note?: string | null;
}

export interface MitreMapRequest {
  document_id: string;
  max_candidates?: number;
  replace_existing?: boolean;
}

export interface MitreMapResponse {
  document_id: string;
  created: number;
  candidates: MitreCandidateOut[];
  degraded: boolean;
}

export interface MitreStatsResponse {
  pending: number;
  approved: number;
  rejected: number;
  top_techniques: { technique_id: string; name: string; count: number }[];
}

// ----------------------------------------------------------------------- audit
export interface AuditLogOut {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
}

export interface AuditLogListResponse extends Paginated<AuditLogOut> {}

export interface AuditVerifyResponse {
  valid: boolean;
  entries: number;
  broken_at: number | null;
  message: string;
  head_hash: string | null;
}

// ------------------------------------------------------------------ evaluation
export interface EvaluationRequest {
  question: string;
  document_ids?: string[];
  top_k?: number;
  semantic_weight?: number;
  expected_iocs?: string[];
  persist?: boolean;
}

export interface EvaluationRunOut {
  id: string;
  batch_id: string;
  question: string;
  mode: EvaluationMode;
  answer_text: string;
  model_used: string;
  grounded_claims: number;
  contradicted_claims: number;
  unresolved_claims: number;
  total_claims: number;
  groundedness: number;
  hallucination_rate: number;
  citation_coverage: number;
  ioc_recall: number | null;
  trust_score: number | null;
  latency_ms: number;
  degraded: boolean;
  document_ids: string[];
  metrics: Record<string, unknown>;
  created_at: string;
}

export interface EvaluationBatchResponse {
  batch_id: string;
  question: string;
  runs: EvaluationRunOut[];
  winner: string;
  comparison: {
    mode: EvaluationMode;
    groundedness: number;
    hallucination_rate: number;
    citation_coverage: number;
    trust_score: number | null;
    ioc_recall: number | null;
    latency_ms: number;
    composite: number;
    degraded: boolean;
  }[];
  notes: string[];
}

export interface EvaluationSummaryResponse {
  total_batches: number;
  average_by_mode: {
    mode: EvaluationMode;
    runs: number;
    groundedness: number;
    hallucination_rate: number;
    avg_trust_score: number;
    avg_latency_ms: number;
  }[];
  latest_batch_id: string | null;
  recent: EvaluationRunOut[];
}

export interface EvaluationRunListItem {
  batch_id: string;
  question: string;
  created_at: string;
  runs: number;
  best_mode: string;
}

// ------------------------------------------------------------------- dashboard
export interface DashboardKpis {
  documents: number;
  chunks: number;
  iocs: number;
  generations: number;
  claims: number;
  pending_mitre: number;
  approved_mitre: number;
  avg_trust_score: number;
  abstention_rate: number;
  avg_latency_ms: number;
}

export interface VerificationBreakdown {
  supported: number;
  contradicted: number;
  unresolved: number;
  total: number;
  supported_ratio: number;
  contradicted_ratio: number;
  unresolved_ratio: number;
}

export interface DistributionBucket {
  label: string;
  value: number;
  percentage: number;
}

export interface TrendPoint {
  date: string;
  documents: number;
  generations: number;
}

export interface TechniqueCount {
  technique_id: string;
  name: string;
  count: number;
  tactic: string;
}

export interface DashboardResponse {
  kpis: DashboardKpis;
  verification: VerificationBreakdown;
  trust_distribution: DistributionBucket[];
  ioc_distribution: DistributionBucket[];
  tlp_distribution: DistributionBucket[];
  ingestion_trend: TrendPoint[];
  recent_audit: AuditLogOut[];
  top_techniques: TechniqueCount[];
  latest_evaluation: EvaluationRunOut[];
  latest_batch_id: string | null;
  generated_at: string;
}
