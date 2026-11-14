import { AlertTriangle, FlaskConical, ShieldAlert, ShieldCheck } from "lucide-react";

import { cn } from "../lib/format";
import type {
  CandidateStatus,
  EvaluationMode,
  IOCType,
  TLPLevel,
  TrustBand,
  VerificationStatus,
} from "../lib/types";
import {
  CANDIDATE_TONE,
  IOC_TONE,
  MODE_LABEL,
  MODE_TONE,
  RISK_TONE,
  TLP_TONE,
  TRUST_TONE,
  VERIFICATION_TONE,
} from "../lib/ui";
import { Badge } from "./ui";

const TLP_DOT: Record<TLPLevel, string> = {
  WHITE: "#e2e8f0",
  GREEN: "#34d399",
  AMBER: "#fbbf24",
  RED: "#fb7185",
};

export function TLPBadge({ tlp, className }: { tlp: TLPLevel; className?: string }) {
  return (
    <Badge className={cn(TLP_TONE[tlp], className)} dot={TLP_DOT[tlp]}>
      {tlp}
    </Badge>
  );
}

export function VerificationBadge({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  return <Badge className={cn(VERIFICATION_TONE[status], className)}>{status}</Badge>;
}

export function CandidateBadge({
  status,
  className,
}: {
  status: CandidateStatus;
  className?: string;
}) {
  return <Badge className={cn(CANDIDATE_TONE[status], className)}>{status}</Badge>;
}

export function TrustBadge({
  band,
  score,
  className,
}: {
  band: TrustBand;
  score?: number | null;
  className?: string;
}) {
  return (
    <Badge className={cn(TRUST_TONE[band], className)}>
      {band}
      {typeof score === "number" && <span className="font-mono text-[10px] opacity-80">{score.toFixed(1)}</span>}
    </Badge>
  );
}

export function ModeBadge({ mode, className }: { mode: EvaluationMode; className?: string }) {
  return <Badge className={cn(MODE_TONE[mode], className)}>{MODE_LABEL[mode]}</Badge>;
}

export function RiskBadge({ risk, className }: { risk: string; className?: string }) {
  const Icon = risk === "HIGH" ? ShieldAlert : risk === "MEDIUM" ? AlertTriangle : ShieldCheck;
  return (
    <Badge className={cn(RISK_TONE[risk] ?? RISK_TONE.LOW, className)}>
      <Icon size={11} />
      {risk} risk
    </Badge>
  );
}

export function IOCBadge({ type, className }: { type: IOCType; className?: string }) {
  return <Badge className={cn(IOC_TONE[type], className)}>{type}</Badge>;
}

export function DegradedBadge({ degraded }: { degraded: boolean }) {
  if (!degraded) return null;
  return (
    <Badge className="border-signal-review/30 bg-signal-review/10 text-signal-review">
      <FlaskConical size={11} />
      Offline fallback
    </Badge>
  );
}
