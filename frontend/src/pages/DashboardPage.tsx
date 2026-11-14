import {
  AlertTriangle,
  ArrowUpRight,
  Crosshair,
  Database,
  FileText,
  FlaskConical,
  Gauge,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { BarList, DonutChart, TrendChart } from "../components/charts";
import { ModeBadge, TLPBadge, TrustBadge, VerificationBadge } from "../components/badges";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Panel,
  StatCard,
  Tabs,
} from "../components/ui";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/api";
import {
  cn,
  formatNumber,
  formatRatio,
  formatScore,
  timeAgo,
  truncate,
} from "../lib/format";
import { CHART_PALETTE, VERIFICATION_COLOR } from "../lib/ui";

const RANGE_OPTIONS = [
  { id: "7", label: "7 days" },
  { id: "14", label: "14 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
] as const;

const TRUST_COLORS: Record<string, string> = {
  TRUSTED: "#34d399",
  REVIEW: "#fbbf24",
  ABSTAIN: "#fb7185",
};

const TLP_COLORS: Record<string, string> = {
  WHITE: "#e2e8f0",
  GREEN: "#34d399",
  AMBER: "#fbbf24",
  RED: "#fb7185",
};

const IOC_COLORS: Record<string, string> = {
  IPV4: "#22d3ee",
  DOMAIN: "#a78bfa",
  URL: "#60a5fa",
  SHA256: "#34d399",
  SHA1: "#fbbf24",
  MD5: "#fb7185",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{children}</span>;
}

export default function DashboardPage() {
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["id"]>("14");
  const { data, loading, error, reload } = useResource(
    () => api.dashboard(Number(range)),
    [range],
  );

  if (loading && !data) {
    return (
      <Panel title="Loading SOC dashboard" icon={Gauge}>
        <LoadingBlock label="Aggregating evidence, trust and verification metrics…" />
      </Panel>
    );
  }

  if (error && !data) {
    return <ErrorBanner message={error} onRetry={() => void reload()} />;
  }

  if (!data) return null;

  const { kpis, verification, trust_distribution, ioc_distribution, tlp_distribution } = data;
  const verificationSegments = [
    { label: "Supported", value: verification.supported, color: VERIFICATION_COLOR.SUPPORTED },
    { label: "Contradicted", value: verification.contradicted, color: VERIFICATION_COLOR.CONTRADICTED },
    { label: "Unresolved", value: verification.unresolved, color: VERIFICATION_COLOR.UNRESOLVED },
  ];

  const trustItems = trust_distribution.map((bucket) => ({
    ...bucket,
    color: TRUST_COLORS[bucket.label] ?? "#22d3ee",
  }));

  const iocSegments = ioc_distribution
    .filter((bucket) => bucket.value > 0)
    .map((bucket, index) => ({
      label: bucket.label,
      value: bucket.value,
      color: IOC_COLORS[bucket.label] ?? CHART_PALETTE[index % CHART_PALETTE.length],
    }));

  const topTechniqueItems = data.top_techniques.map((technique) => ({
    label: `${technique.technique_id} · ${technique.name}`,
    value: technique.count,
    color: "#818cf8",
  }));

  const latestWinner = [...data.latest_evaluation].sort((a, b) => b.groundedness - a.groundedness)[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">
            Operations overview
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">
            Evidence coverage and answer trust posture
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every answer is grounded in the ingested corpus, decomposed into atomic claims and gated by a
            weighted trust score with explicit abstention.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            tabs={RANGE_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
            active={range}
            onChange={setRange}
          />
          <button type="button" className="btn-secondary" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Documents"
          value={formatNumber(kpis.documents)}
          hint={`${formatNumber(kpis.chunks)} chunks indexed`}
          icon={FileText}
          tone="brand"
        />
        <StatCard
          label="Generations"
          value={formatNumber(kpis.generations)}
          hint={`${formatNumber(kpis.claims)} claims verified`}
          icon={Sparkles}
          tone="violet"
        />
        <StatCard
          label="Indicators"
          value={formatNumber(kpis.iocs)}
          hint="Defanged IOCs in corpus"
          icon={Crosshair}
          tone="brand"
        />
        <StatCard
          label="Avg trust"
          value={formatScore(kpis.avg_trust_score)}
          hint={`${formatRatio(kpis.abstention_rate)} abstention rate`}
          icon={Gauge}
          tone={kpis.avg_trust_score >= 65 ? "success" : kpis.avg_trust_score >= 40 ? "warning" : "danger"}
        />
        <StatCard
          label="ATT&CK pending"
          value={formatNumber(kpis.pending_mitre)}
          hint={`${formatNumber(kpis.approved_mitre)} analyst-approved`}
          icon={ShieldCheck}
          tone={kpis.pending_mitre > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Avg latency"
          value={`${formatNumber(Math.round(kpis.avg_latency_ms))} ms`}
          hint="Generation round-trip"
          icon={Timer}
          tone="neutral"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Claim verification"
          subtitle="Three-state labels across all persisted claims"
          icon={Layers}
          actions={<Badge className="border-white/10 bg-white/[0.04] text-slate-400">{formatNumber(verification.total)} claims</Badge>}
        >
          {verification.total === 0 ? (
            <EmptyState
              title="No claims yet"
              description="Ask a question with persistence enabled and verify its claims to populate this breakdown."
              icon={ShieldCheck}
            />
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <DonutChart
                segments={verificationSegments}
                centerLabel="claims"
                centerValue={formatNumber(verification.total)}
              />
              <div className="w-full space-y-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <VerificationBadge status="SUPPORTED" />
                  <span className="font-mono text-xs text-slate-400">
                    {formatNumber(verification.supported)} · {formatRatio(verification.supported_ratio)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <VerificationBadge status="CONTRADICTED" />
                  <span className="font-mono text-xs text-slate-400">
                    {formatNumber(verification.contradicted)} · {formatRatio(verification.contradicted_ratio)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <VerificationBadge status="UNRESOLVED" />
                  <span className="font-mono text-xs text-slate-400">
                    {formatNumber(verification.unresolved)} · {formatRatio(verification.unresolved_ratio)}
                  </span>
                </div>
                <div className="border-t border-white/[0.05] pt-3 text-[11px] leading-relaxed text-slate-500">
                  A claim is only marked supported above the entailment threshold. Weak model labels are
                  downgraded to unresolved instead of being trusted.
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Trust distribution" subtitle="Persisted generation scores by band" icon={Gauge}>
          {trustItems.every((item) => item.value === 0) ? (
            <EmptyState title="No scored generations" description="Trust bands appear after the first persisted answer." icon={Gauge} />
          ) : (
            <div className="space-y-5">
              <BarList items={trustItems} total={trustItems.reduce((sum, item) => sum + item.value, 0)} />
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
                Bands: <span className="text-signal-contradicted">ABSTAIN</span> below the abstain threshold,{" "}
                <span className="text-signal-review">REVIEW</span> until human sign-off,{" "}
                <span className="text-signal-supported">TRUSTED</span> for operationally usable answers.
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Indicator mix" subtitle="Extracted IOC types" icon={Crosshair}>
          {iocSegments.length === 0 ? (
            <EmptyState title="No indicators extracted" description="Upload a CTI report containing network or file indicators." icon={Crosshair} />
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <DonutChart segments={iocSegments} centerLabel="IOCs" centerValue={formatNumber(kpis.iocs)} size={158} />
              <div className="w-full space-y-2.5">
                {iocSegments.map((segment) => (
                  <div key={segment.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                      <span className="truncate text-slate-400">{segment.label}</span>
                    </span>
                    <span className="font-mono text-slate-400">{formatNumber(segment.value)}</span>
                  </div>
                ))}
                <Link to="/iocs" className="btn-ghost mt-1 w-full justify-between px-2 py-1.5 text-[11px]">
                  Open indicator repository <ArrowUpRight size={12} />
                </Link>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel
          title="Ingestion and generation activity"
          subtitle={`Last ${range} days`}
          icon={Database}
          actions={
            <div className="flex items-center gap-3 text-[10.5px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-4 rounded-full bg-brand-400" /> Docs
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-4 rounded-full bg-signal-violet" /> Generations
              </span>
            </div>
          }
        >
          <TrendChart points={data.ingestion_trend} height={210} />
        </Panel>

        <Panel title="TLP handling" subtitle="Document sensitivity distribution" icon={ShieldCheck}>
          <BarList
            items={tlp_distribution.map((bucket) => ({
              ...bucket,
              color: TLP_COLORS[bucket.label] ?? "#22d3ee",
            }))}
            total={tlp_distribution.reduce((sum, bucket) => sum + bucket.value, 0)}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {tlp_distribution.map((bucket) => (
              <span key={bucket.label} className="chip px-2 py-1 text-[11px]">
                <TLPBadge tlp={bucket.label as "WHITE" | "GREEN" | "AMBER" | "RED"} />
                <span className="font-mono text-slate-400">{formatNumber(bucket.value)}</span>
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Retrieval honours TLP clearance: a query can only surface documents at or below the requested
            sharing level.
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Top ATT&CK candidates" subtitle="Techniques mapped from corpus evidence" icon={ShieldCheck}>
          {topTechniqueItems.length === 0 ? (
            <EmptyState title="No ATT&CK candidates" description="Run ATT&CK mapping from the corpus view." icon={ShieldCheck} />
          ) : (
            <BarList items={topTechniqueItems} />
          )}
        </Panel>

        <Panel
          title="Latest evaluation"
          subtitle="Standalone LLM vs Standard RAG vs TrustRAG-Agent"
          icon={FlaskConical}
          actions={
            <Link to="/evaluation" className="btn-ghost px-2 py-1 text-[11px]">
              Open centre <ArrowUpRight size={12} />
            </Link>
          }
        >
          {data.latest_evaluation.length === 0 ? (
            <EmptyState
              title="No evaluation batches"
              description="Run a three-way benchmark to compare groundedness and hallucination rates."
              icon={FlaskConical}
            />
          ) : (
            <div className="space-y-3">
              {latestWinner && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-signal-supported/20 bg-signal-supported/[0.06] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-signal-supported">
                    <Sparkles size={14} />
                    Best groundedness
                  </div>
                  <ModeBadge mode={latestWinner.mode} />
                </div>
              )}
              <div className="space-y-2">
                {data.latest_evaluation.map((run) => (
                  <div key={run.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <ModeBadge mode={run.mode} />
                      <span className="font-mono text-[11px] text-slate-400">
                        {formatRatio(run.groundedness, 0)} grounded
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px] text-slate-500">
                      <span>Halluc. <span className="font-mono text-slate-300">{formatRatio(run.hallucination_rate, 0)}</span></span>
                      <span>Trust <span className="font-mono text-slate-300">{run.trust_score != null ? formatScore(run.trust_score) : "—"}</span></span>
                      <span>Latency <span className="font-mono text-slate-300">{formatNumber(Math.round(run.latency_ms))} ms</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title="Recent audit events"
          subtitle="Append-only, hash-chained trail"
          icon={Database}
          actions={
            <Link to="/audit" className="btn-ghost px-2 py-1 text-[11px]">
              View chain <ArrowUpRight size={12} />
            </Link>
          }
        >
          {data.recent_audit.length === 0 ? (
            <EmptyState title="No audit events" description="Ingestion and analyst decisions are recorded here." icon={Database} />
          ) : (
            <div className="space-y-2.5">
              {data.recent_audit.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400/70" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10.5px] text-brand-200/80">{entry.action}</span>
                      <span className="text-[10px] text-slate-600">{timeAgo(entry.created_at)}</span>
                    </div>
                    <p className="truncate text-xs text-slate-400" title={entry.summary}>
                      {truncate(entry.summary, 110)}
                    </p>
                    <p className="text-[10px] text-slate-600">
                      <span className="font-mono">{entry.actor}</span> · {entry.entity_type}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="border-brand-400/15 bg-gradient-to-r from-brand-400/[0.06] to-signal-violet/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-brand-400/25 bg-brand-400/10 text-brand-200">
              <AlertTriangle size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-100">TrustRAG abstains rather than guesses.</p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                Claims that cannot be entailed from retrieved evidence remain unresolved, and low trust forces
                human review. Treat every AI output as an investigative lead, not an operational fact.
              </p>
            </div>
          </div>
          <Link to="/ask" className="btn-primary">
            <Sparkles size={15} /> Ask TrustRAG
          </Link>
        </div>
      </Panel>
    </div>
  );
}
