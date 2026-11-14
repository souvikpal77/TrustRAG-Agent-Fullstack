import type {
  CandidateStatus,
  EvaluationMode,
  IOCType,
  TLPLevel,
  TrustBand,
  VerificationStatus,
} from "./types";

export const TLP_TONE: Record<TLPLevel, string> = {
  WHITE: "border-white/20 bg-white/10 text-white",
  GREEN: "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
  AMBER: "border-signal-review/30 bg-signal-review/10 text-signal-review",
  RED: "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
};

export const VERIFICATION_TONE: Record<VerificationStatus, string> = {
  SUPPORTED: "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
  CONTRADICTED: "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
  UNRESOLVED: "border-white/10 bg-white/[0.04] text-slate-400",
};

export const VERIFICATION_COLOR: Record<VerificationStatus, string> = {
  SUPPORTED: "#34d399",
  CONTRADICTED: "#fb7185",
  UNRESOLVED: "#94a3b8",
};

export const CANDIDATE_TONE: Record<CandidateStatus, string> = {
  PENDING: "border-signal-review/30 bg-signal-review/10 text-signal-review",
  APPROVED: "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
  REJECTED: "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
};

export const TRUST_TONE: Record<TrustBand, string> = {
  TRUSTED: "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
  REVIEW: "border-signal-review/30 bg-signal-review/10 text-signal-review",
  ABSTAIN: "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
};

export const TRUST_COLOR: Record<TrustBand, string> = {
  TRUSTED: "#34d399",
  REVIEW: "#fbbf24",
  ABSTAIN: "#fb7185",
};

export const IOC_TONE: Record<IOCType, string> = {
  IPV4: "border-brand-400/30 bg-brand-400/10 text-brand-200",
  DOMAIN: "border-signal-violet/30 bg-signal-violet/10 text-signal-violet",
  URL: "border-signal-info/30 bg-signal-info/10 text-signal-info",
  SHA256: "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
  SHA1: "border-signal-review/30 bg-signal-review/10 text-signal-review",
  MD5: "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
};

export const MODE_LABEL: Record<EvaluationMode, string> = {
  STANDALONE: "Standalone LLM",
  STANDARD_RAG: "Standard RAG",
  TRUSTRAG: "TrustRAG-Agent",
};

export const MODE_TONE: Record<EvaluationMode, string> = {
  STANDALONE: "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
  STANDARD_RAG: "border-signal-review/30 bg-signal-review/10 text-signal-review",
  TRUSTRAG: "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
};

export const RISK_TONE: Record<string, string> = {
  LOW: "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
  MEDIUM: "border-signal-review/30 bg-signal-review/10 text-signal-review",
  HIGH: "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
};

export const CHART_PALETTE = [
  "#22d3ee",
  "#818cf8",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#a78bfa",
  "#60a5fa",
  "#f472b6",
];
