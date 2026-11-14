import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  History,
  Info,
  ListChecks,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  DegradedBadge,
  RiskBadge,
  TLPBadge,
  TrustBadge,
  VerificationBadge,
} from "../components/badges";
import { DonutChart, TrustGauge } from "../components/charts";
import {
  Badge,
  CodeChip,
  CopyButton,
  EmptyState,
  ErrorBanner,
  Field,
  InfoNote,
  JsonBlock,
  KeyValue,
  LoadingBlock,
  Modal,
  Panel,
  ProgressBar,
  SliderField,
  Spinner,
  useToast,
} from "../components/ui";
import { useResource } from "../hooks/useResource";
import { api, errorMessage } from "../lib/api";
import {
  cn,
  formatDateTime,
  formatNumber,
  formatRatio,
  formatScore,
  truncate,
} from "../lib/format";
import { CHART_PALETTE, VERIFICATION_COLOR } from "../lib/ui";
import type {
  ClaimOut,
  GenerateResponse,
  GenerationDetail,
  GenerationSummary,
  TLPLevel,
  TrustFactors,
  TrustScoreResponse,
  TrustWeights,
  VerifyClaimsResponse,
} from "../lib/types";

const TLP_OPTIONS: TLPLevel[] = ["WHITE", "GREEN", "AMBER", "RED"];

const WEIGHT_FIELDS: { key: keyof TrustWeights; label: string }[] = [
  { key: "provenance", label: "Provenance" },
  { key: "authority", label: "Authority" },
  { key: "relevance", label: "Relevance" },
  { key: "entailment", label: "Entailment" },
  { key: "freshness", label: "Freshness" },
  { key: "model_confidence", label: "Model confidence" },
];

function toTrustFactors(record: Record<string, number>): TrustFactors {
  return {
    provenance: record.provenance ?? 0.5,
    authority: record.authority ?? 0.5,
    relevance: record.relevance ?? 0.5,
    entailment: record.entailment ?? 0.5,
    freshness: record.freshness ?? 0.5,
    model_confidence: record.model_confidence ?? 0.5,
  };
}

function ClaimRow({ claim }: { claim: ClaimOut }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] text-slate-500">claim #{claim.claim_index + 1}</span>
        <VerificationBadge status={claim.status} />
        <span className="ml-auto flex items-center gap-3 text-[10px] text-slate-500">
          <span>
            confidence <span className="font-mono text-slate-300">{formatRatio(claim.confidence, 0)}</span>
          </span>
          <span>
            entailment <span className="font-mono text-slate-300">{formatRatio(claim.entailment_score, 0)}</span>
          </span>
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">{claim.claim_text}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ProgressBar
          value={claim.confidence}
          height={4}
          tone={claim.confidence >= 0.7 ? "#34d399" : claim.confidence >= 0.45 ? "#fbbf24" : "#fb7185"}
        />
        <ProgressBar
          value={claim.entailment_score}
          height={4}
          tone={claim.entailment_score >= 0.55 ? "#34d399" : claim.entailment_score >= 0.3 ? "#fbbf24" : "#fb7185"}
        />
      </div>
      {claim.rationale && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{claim.rationale}</p>}
      {claim.evidence_chunk_ids.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] text-slate-600">evidence</span>
          {claim.evidence_chunk_ids.slice(0, 5).map((chunkId) => (
            <CodeChip key={chunkId}>{chunkId.slice(0, 8)}…</CodeChip>
          ))}
        </div>
      )}
    </div>
  );
}

function GenerationDetailDialog({ generationId, onClose }: { generationId: string | null; onClose: () => void }) {
  const { data, loading, error } = useResource(
    () => api.getGeneration(generationId as string),
    [generationId],
    { enabled: Boolean(generationId) },
  );

  const trust = data?.trust ?? null;
  const claims = data?.claims ?? [];
  const evidence = data?.evidence ?? [];

  return (
    <Modal
      open={Boolean(generationId)}
      onClose={onClose}
      title={data ? truncate(data.question, 90) : "Generation detail"}
      subtitle={data ? `${formatDateTime(data.created_at)} · ${data.model_used}` : "Loading persisted run…"}
      size="xl"
      footer={<button type="button" className="btn-secondary" onClick={onClose}>Close</button>}
    >
      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-white/10 bg-white/[0.04] text-slate-400">{data.model_used}</Badge>
            <DegradedBadge degraded={data.degraded} />
            <RiskBadge risk={data.injection_risk} />
            {trust && <TrustBadge band={trust.band} score={trust.score} />}
            <span className="text-[11px] text-slate-500">{formatNumber(data.latency_ms)} ms</span>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-ink-950/40 p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
              {data.answer_text || "No answer text was persisted."}
            </p>
          </div>

          {trust && (
            <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div className="flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <TrustGauge score={trust.score} band={trust.band} size={132} thresholds={trust.thresholds} showThresholds />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">Trust decision</span>
                  <Badge className="border-white/10 bg-white/[0.04] text-slate-400">{trust.decision}</Badge>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">{trust.explanation}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {trust.components.map((component) => (
                    <div key={component.key}>
                      <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                        <span>{component.label}</span>
                        <span className="font-mono">{formatRatio(component.raw_value, 0)}</span>
                      </div>
                      <ProgressBar value={component.raw_value} height={4} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="label">Claims ({claims.length})</p>
            {claims.length === 0 ? (
              <p className="text-xs text-slate-500">No claims were persisted for this run.</p>
            ) : (
              <div className="space-y-2">
                {claims.map((claim) => (
                  <ClaimRow key={`${claim.id ?? claim.claim_index}`} claim={claim} />
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="label">Evidence snapshot ({evidence.length})</p>
            {evidence.length === 0 ? (
              <p className="text-xs text-slate-500">No evidence was stored.</p>
            ) : (
              <div className="space-y-2">
                {evidence.map((chunk) => (
                  <div key={chunk.chunk_id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-slate-500">
                      <span className="font-medium text-slate-300">{chunk.document_title}</span>
                      <TLPBadge tlp={chunk.tlp} />
                      <span>{chunk.section_header ?? "Unsectioned"}</span>
                      <span className="ml-auto font-mono">p.{chunk.page_start}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-4 text-[11px] leading-relaxed text-slate-500">{chunk.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(data.warnings ?? []).length > 0 && (
            <div>
              <p className="label">Warnings</p>
              <JsonBlock value={data.warnings} />
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export default function AskPage() {
  const toast = useToast();

  const [question, setQuestion] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [topK, setTopK] = useState(8);
  const [semanticWeight, setSemanticWeight] = useState(0.6);
  const [tlpMax, setTlpMax] = useState<TLPLevel | "">("");
  const [model, setModel] = useState("");
  const [persist, setPersist] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  const [verification, setVerification] = useState<VerifyClaimsResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [weights, setWeights] = useState<TrustWeights | null>(null);
  const [tunedTrust, setTunedTrust] = useState<TrustScoreResponse | null>(null);
  const [tuning, setTuning] = useState(false);
  const [tuneError, setTuneError] = useState<string | null>(null);

  const [historyId, setHistoryId] = useState<string | null>(null);

  const meta = useResource(() => api.meta(), []);
  const defaults = useResource(() => api.getWeights(), []);
  const documents = useResource(() => api.listDocuments({ page: 1, page_size: 100 }), []);
  const history = useResource(() => api.listGenerations({ page: 1, page_size: 8 }), []);

  useEffect(() => {
    if (defaults.data && !weights) setWeights(defaults.data);
  }, [defaults.data, weights]);

  // Live re-scoring while the analyst moves trust weights.
  useEffect(() => {
    if (!result || !weights) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setTuning(true);
      setTuneError(null);
      try {
        const next = await api.scoreTrust({ factors: toTrustFactors(result.trust.factors), weights });
        if (!cancelled) setTunedTrust(next);
      } catch (caught) {
        if (!cancelled) setTuneError(errorMessage(caught));
      } finally {
        if (!cancelled) setTuning(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [weights, result]);

  const effectiveTrust = tunedTrust ?? result?.trust ?? null;
  const weightTotal = useMemo(
    () => (weights ? Object.values(weights).reduce((sum, value) => sum + value, 0) : 0),
    [weights],
  );

  const generate = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const prompt = (override ?? question).trim();
    if (prompt.length < 3) {
      setError("Enter a question of at least three characters.");
      return;
    }
    setGenerating(true);
    setError(null);
    setVerification(null);
    setVerifyError(null);
    setTunedTrust(null);
    try {
      const next = await api.generate({
        question: prompt,
        document_ids: documentId ? [documentId] : [],
        top_k: topK,
        semantic_weight: semanticWeight,
        tlp_max: tlpMax || null,
        persist,
        model: model || null,
      });
      setResult(next);
      if (next.generation_id) void history.reload(true);
      if (next.injection.risk !== "LOW") {
        toast.push("info", `${next.injection.risk} injection risk`, "Review the flagged evidence before trusting this answer.");
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setGenerating(false);
    }
  };

  const verify = async () => {
    if (!result) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const next = await api.verifyClaims(
        result.generation_id
          ? { generation_id: result.generation_id, question: result.question, persist }
          : {
              answer: result.answer,
              question: result.question,
              evidence_chunk_ids: result.evidence.map((entry) => entry.chunk_id),
              document_ids: Array.from(new Set(result.evidence.map((entry) => entry.document_id))),
              persist: false,
            },
      );
      setVerification(next);
      toast.push(
        "success",
        "Claims verified",
        `${next.summary.supported} supported · ${next.summary.contradicted} contradicted · ${next.summary.unresolved} unresolved`,
      );
    } catch (caught) {
      setVerifyError(errorMessage(caught));
    } finally {
      setVerifying(false);
    }
  };

  const updateWeight = (key: keyof TrustWeights, value: number) => {
    setWeights((current) => (current ? { ...current, [key]: value } : current));
  };

  const resetWeights = () => {
    if (defaults.data) {
      setWeights(defaults.data);
      setTunedTrust(null);
    }
  };

  const verificationSegments = verification
    ? [
        { label: "Supported", value: verification.summary.supported, color: VERIFICATION_COLOR.SUPPORTED },
        { label: "Contradicted", value: verification.summary.contradicted, color: VERIFICATION_COLOR.CONTRADICTED },
        { label: "Unresolved", value: verification.summary.unresolved, color: VERIFICATION_COLOR.UNRESOLVED },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">Grounded reasoning</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Ask TrustRAG</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Evidence is wrapped in untrusted-data delimiters, the answer is decomposed into atomic claims, and
            every claim is verified against retrieved CTI before trust gating decides whether to answer or abstain.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Badge className="border-white/10 bg-white/[0.04] text-slate-400">
            <ShieldCheck size={11} className="text-signal-supported" /> abstention-first
          </Badge>
          <Badge className="border-white/10 bg-white/[0.04] text-slate-400">
            <Bot size={11} className="text-brand-300" /> {meta.data?.gemini_configured ? "Gemini live" : "offline fallback"}
          </Badge>
        </div>
      </div>

      <Panel title="Compose an evidence question" subtitle="Retrieval and generation are scoped before the model sees any context." icon={Sparkles}>
        <form onSubmit={generate} className="space-y-4">
          <Field label="Analyst question" hint="Use concrete entities, time windows and TTPs for sharper evidence retrieval.">
            <textarea
              className="textarea min-h-[110px]"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What infrastructure and execution techniques did the actor use, and how confident is the evidence?"
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void generate();
              }}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            {[
              "Summarise the actor's initial access tradecraft with supporting evidence.",
              "Which IOCs are associated with the reported C2 infrastructure?",
              "Map the described intrusion to ATT&CK techniques and cite the source.",
            ].map((example) => (
              <button
                key={example}
                type="button"
                className="chip max-w-full text-left text-[10.5px] text-slate-400 transition hover:border-brand-400/30 hover:text-brand-200"
                onClick={() => {
                  setQuestion(example);
                  void generate(undefined, example);
                }}
              >
                {example}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Document scope">
              <select className="select" value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                <option value="">Entire corpus</option>
                {(documents.data?.items ?? []).map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Retrieval top K">
              <input
                type="number"
                min={1}
                max={20}
                className="input"
                value={topK}
                onChange={(event) => setTopK(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
              />
            </Field>
            <Field label="TLP ceiling" hint="Filters evidence above the selected sharing level.">
              <select className="select" value={tlpMax} onChange={(event) => setTlpMax(event.target.value as TLPLevel | "")}>
                <option value="">No ceiling</option>
                {TLP_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    TLP:{option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model" hint="Falls back through the configured Gemini chain.">
              <select className="select" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="">Auto (fallback chain)</option>
                {(meta.data?.gemini_models ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-5">
            <div className="min-w-[240px] flex-1">
              <SliderField
                label="Semantic weight"
                value={semanticWeight}
                onChange={setSemanticWeight}
                min={0}
                max={1}
                step={0.05}
                format={(value) => `${(value * 100).toFixed(0)}% semantic`}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={persist}
                onChange={(event) => setPersist(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-brand-400"
              />
              Persist generation, evidence snapshot and claims
            </label>
            <button type="submit" className="btn-primary ml-auto" disabled={generating}>
              {generating ? <Spinner size={15} /> : <Send size={15} />}
              {generating ? "Retrieving and generating…" : "Generate grounded answer"}
            </button>
          </div>
        </form>
      </Panel>

      {error && <ErrorBanner message={error} onRetry={() => void generate()} />}

      {!result ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="What TrustRAG does differently" icon={ShieldCheck}>
            <div className="space-y-4">
              {[
                {
                  icon: ShieldAlert,
                  title: "Prompt-injection aware",
                  body: "Evidence and analyst questions are scanned for instruction hijacking before they reach the model; high risk caps trust and forces review.",
                },
                {
                  icon: ListChecks,
                  title: "Claim-level verification",
                  body: "Answers are decomposed into atomic claims. Each one must be entailed by a specific evidence chunk, otherwise it is unresolved.",
                },
                {
                  icon: Gauge,
                  title: "Weighted, explainable trust",
                  body: "Provenance, authority, relevance, entailment, freshness and model confidence are weighted and shown component by component.",
                },
                {
                  icon: XCircle,
                  title: "Explicit abstention",
                  body: "No evidence or a score below threshold returns ABSTAIN rather than a plausible-sounding fabrication.",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-brand-300">
                      <Icon size={15} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-200">{item.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="Recent generations"
            subtitle="Persisted runs with trust and claim counts"
            icon={History}
            actions={
              <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => void history.reload()}>
                <RefreshCw size={12} /> Refresh
              </button>
            }
          >
            {history.loading && !history.data ? (
              <LoadingBlock />
            ) : history.error ? (
              <ErrorBanner message={history.error} onRetry={() => void history.reload()} />
            ) : (history.data?.items ?? []).length === 0 ? (
              <EmptyState title="No generations yet" description="Ask a question to create the first persisted, evidence-grounded run." icon={Sparkles} />
            ) : (
              <div className="space-y-2">
                {(history.data?.items ?? []).map((run: GenerationSummary) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setHistoryId(run.id)}
                    className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-brand-400/25 hover:bg-white/[0.035]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-slate-300">{truncate(run.question, 90)}</span>
                      {run.trust_score != null && (
                        <TrustBadge
                          band={run.trust_score >= 65 ? "TRUSTED" : run.trust_score >= 40 ? "REVIEW" : "ABSTAIN"}
                          score={run.trust_score}
                        />
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                      <span>{run.model_used}</span>
                      <span>{formatNumber(run.claims_total)} claims</span>
                      <span>{formatNumber(run.evidence_count)} evidence</span>
                      <span className="ml-auto">{formatDateTime(run.created_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4">
              <Panel
                title="Grounded answer"
                subtitle={`${result.model_used} · ${formatNumber(result.latency_ms)} ms · ${result.evidence.length} evidence chunks`}
                icon={Sparkles}
                actions={<CopyButton value={result.answer} label="Copy answer" />}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge className="border-white/10 bg-white/[0.04] text-slate-400">
                    <Bot size={11} /> {result.model_used}
                  </Badge>
                  <DegradedBadge degraded={result.degraded} />
                  <RiskBadge risk={result.injection.risk} />
                  <Badge className="border-white/10 bg-white/[0.04] text-slate-400">
                    citation coverage {formatRatio(result.citation_coverage)}
                  </Badge>
                  {result.generation_id && (
                    <button
                      type="button"
                      className="btn-ghost ml-auto px-1.5 py-1 text-[11px]"
                      onClick={() => setHistoryId(result.generation_id)}
                    >
                      <Info size={12} /> Open persisted run
                    </button>
                  )}
                </div>

                <ProgressBar value={result.citation_coverage} height={4} className="mb-4" />

                <div className="rounded-xl border border-white/[0.06] bg-ink-950/40 p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{result.answer}</p>
                </div>

                {result.injection.matches.length > 0 && (
                  <div className="mt-4">
                    <InfoNote tone="warning" icon={AlertTriangle}>
                      <span className="font-semibold">Prompt-injection heuristics fired.</span> Evidence or the
                      question contains instruction-like text; treat the answer as untrusted until corroborated.
                      <div className="mt-2 space-y-1.5">
                        {result.injection.matches.slice(0, 5).map((match, index) => (
                          <div key={`${match.label}-${index}`} className="rounded border border-signal-review/20 bg-black/20 px-2 py-1.5">
                            <span className="font-mono text-[10px] text-signal-review">{match.location}</span>{" "}
                            <span className="text-[10.5px]">{match.label}</span>
                            <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{match.excerpt}</p>
                          </div>
                        ))}
                      </div>
                    </InfoNote>
                  </div>
                )}

                {(result.warnings ?? []).length > 0 && (
                  <div className="mt-4">
                    <p className="label">Warnings</p>
                    <ul className="space-y-1">
                      {result.warnings.map((warning, index) => (
                        <li key={index} className="flex items-start gap-2 text-[11px] text-slate-500">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-signal-review" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>

              <Panel
                title="Claim verification"
                subtitle="Atomic claims checked only against retrieved evidence"
                icon={ListChecks}
                actions={
                  <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => void verify()} disabled={verifying}>
                    {verifying ? <Spinner size={13} /> : <ShieldCheck size={13} />}
                    {verifying ? "Verifying…" : verification ? "Re-verify" : "Verify claims"}
                  </button>
                }
              >
                {verifyError && <ErrorBanner message={verifyError} onRetry={() => void verify()} className="mb-4" />}
                {verifying && !verification ? (
                  <LoadingBlock label="Decomposing the answer and checking entailment…" />
                ) : !verification ? (
                  <div className="rounded-xl border border-dashed border-white/[0.1] px-5 py-7 text-center">
                    <ShieldCheck size={22} className="mx-auto mb-2 text-slate-500" />
                    <p className="text-sm font-medium text-slate-300">Verification has not run</p>
                    <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                      Run verification to detect unsupported or contradicted statements. The system abstains when
                      evidence is insufficient instead of forcing a label.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row">
                      <DonutChart
                        segments={verificationSegments}
                        centerLabel="claims"
                        centerValue={formatNumber(verification.summary.total)}
                        size={150}
                      />
                      <div className="grid w-full grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Supported</p>
                          <p className="mt-0.5 font-mono text-lg text-signal-supported">{verification.summary.supported}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Contradicted</p>
                          <p className="mt-0.5 font-mono text-lg text-signal-contradicted">{verification.summary.contradicted}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Unresolved</p>
                          <p className="mt-0.5 font-mono text-lg text-slate-300">{verification.summary.unresolved}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Verification ratio</p>
                          <p className="mt-0.5 font-mono text-lg text-brand-200">{formatRatio(verification.summary.verification_ratio)}</p>
                        </div>
                        <div className="col-span-2 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-2 text-[10.5px] text-slate-500">
                          <span>model {verification.model_used}</span>
                          <span>·</span>
                          <span>{formatNumber(verification.elapsed_ms)} ms</span>
                          {verification.degraded && <Badge className="border-signal-review/30 bg-signal-review/10 text-signal-review">degraded</Badge>}
                          {verification.summary.abstained && (
                            <Badge className="border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted">abstained</Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {verification.summary.abstained && (
                      <InfoNote tone="warning" icon={ShieldAlert}>
                        <span className="font-semibold">Verifier abstained.</span>{" "}
                        {verification.summary.abstention_reason ?? "Evidence was insufficient to assign claim labels with confidence."}
                      </InfoNote>
                    )}

                    <div className="space-y-2">
                      {verification.claims.map((claim) => (
                        <ClaimRow key={`${claim.id ?? claim.claim_index}`} claim={claim} />
                      ))}
                    </div>

                    {verification.trust && (
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium text-slate-300">Post-verification trust</span>
                          <TrustBadge band={verification.trust.band} score={verification.trust.score} />
                          <span className="text-[11px] text-slate-500">{verification.trust.explanation}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Panel>
            </div>

            <div className="space-y-4">
              <Panel
                title="Trust assessment"
                subtitle={tunedTrust ? "Re-scored with interactive weights" : "Weighted, explainable score"}
                icon={Gauge}
                actions={tuning ? <Spinner size={13} className="text-brand-300" /> : null}
              >
                {effectiveTrust ? (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-2">
                      <TrustGauge
                        score={effectiveTrust.score}
                        band={effectiveTrust.band}
                        thresholds={effectiveTrust.thresholds}
                        showThresholds
                      />
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <TrustBadge band={effectiveTrust.band} score={effectiveTrust.score} />
                        <Badge className="border-white/10 bg-white/[0.04] text-slate-400">{effectiveTrust.decision}</Badge>
                        {tunedTrust && result.trust.score !== tunedTrust.score && (
                          <Badge
                            className={cn(
                              tunedTrust.score >= result.trust.score
                                ? "border-signal-supported/30 bg-signal-supported/10 text-signal-supported"
                                : "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
                            )}
                          >
                            {tunedTrust.score >= result.trust.score ? "+" : ""}
                            {(tunedTrust.score - result.trust.score).toFixed(1)} vs default
                          </Badge>
                        )}
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-500">{effectiveTrust.explanation}</p>

                    {effectiveTrust.safety_flags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {effectiveTrust.safety_flags.map((flag) => (
                          <Badge key={flag} className="border-signal-review/25 bg-signal-review/[0.08] text-signal-review">
                            <AlertTriangle size={10} /> {flag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="space-y-3 border-t border-white/[0.06] pt-3">
                      {effectiveTrust.components.map((component) => (
                        <div key={component.key}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-400">{component.label}</span>
                            <span className="font-mono text-slate-500">
                              {formatRatio(component.raw_value, 0)}
                              <span className="ml-1.5 text-slate-600">× {formatRatio(component.weight, 0)}</span>
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-brand-400/80"
                              style={{ width: `${Math.max(1, component.raw_value * 100)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] leading-relaxed text-slate-600">{component.explanation}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10.5px] leading-relaxed text-slate-500">
                      Abstain below <span className="font-mono text-signal-contradicted">{formatScore(effectiveTrust.thresholds.abstain)}</span> ·
                      review below <span className="font-mono text-signal-review">{formatScore(effectiveTrust.thresholds.review)}</span>.
                      Trust is capped when injection risk is elevated or evidence is missing.
                    </div>
                  </div>
                ) : (
                  <LoadingBlock label="Awaiting a generated answer…" />
                )}
              </Panel>

              <Panel
                title="Weight tuner"
                subtitle="Interactive what-if scoring over this answer's factors"
                icon={SlidersHorizontal}
                actions={
                  <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={resetWeights} disabled={!weights}>
                    Reset defaults
                  </button>
                }
              >
                {weights ? (
                  <div className="space-y-3.5">
                    {WEIGHT_FIELDS.map((field) => (
                      <SliderField
                        key={field.key}
                        label={field.label}
                        value={weights[field.key]}
                        onChange={(value) => updateWeight(field.key, value)}
                        min={0}
                        max={1}
                        step={0.01}
                        format={(value) => value.toFixed(2)}
                      />
                    ))}
                    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px]">
                      <span className="text-slate-500">Weight sum</span>
                      <span className="font-mono text-slate-300">{weightTotal.toFixed(2)}</span>
                    </div>
                    {tuneError && <p className="text-[11px] text-signal-contradicted">{tuneError}</p>}
                    <p className="text-[10px] leading-relaxed text-slate-600">
                      Weights are normalised server-side. Moving them changes only this explanation; the persisted
                      trust score is not overwritten unless verification re-scores the generation.
                    </p>
                  </div>
                ) : (
                  <LoadingBlock label="Loading default weights…" />
                )}
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel title="Retrieved evidence" subtitle={`${result.evidence.length} chunks used as the only admissible context`} icon={FileText}>
              {result.evidence.length === 0 ? (
                <EmptyState
                  title="No evidence retrieved"
                  description="The system abstained because there was nothing to ground the answer in. Ingest CTI or relax the scope."
                  icon={FileText}
                />
              ) : (
                <div className="space-y-2">
                  {result.evidence.map((chunk) => (
                    <div key={chunk.chunk_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-brand-200/80">E{chunk.rank}</span>
                        <span className="truncate text-xs font-medium text-slate-300">{chunk.document_title}</span>
                        <TLPBadge tlp={chunk.tlp} />
                        <span className="ml-auto font-mono text-[10px] text-slate-500">
                          hybrid {chunk.hybrid_score.toFixed(3)} · p.{chunk.page_start}
                        </span>
                      </div>
                      {chunk.section_header && (
                        <p className="mt-1 text-[10.5px] text-slate-500">{chunk.section_header}</p>
                      )}
                      <p className="mt-1.5 line-clamp-4 text-[11px] leading-relaxed text-slate-500">{chunk.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="Recent generations"
              subtitle="Click any run to inspect persisted evidence and claims"
              icon={History}
              actions={
                <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => void history.reload()}>
                  <RefreshCw size={12} /> Refresh
                </button>
              }
            >
              {history.loading && !history.data ? (
                <LoadingBlock />
              ) : (history.data?.items ?? []).length === 0 ? (
                <EmptyState title="No history" description="Persisted runs appear here." icon={History} />
              ) : (
                <div className="space-y-2">
                  {(history.data?.items ?? []).map((run: GenerationSummary) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setHistoryId(run.id)}
                      className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-brand-400/25 hover:bg-white/[0.035]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-slate-300">{truncate(run.question, 90)}</span>
                        {run.trust_score != null && (
                          <TrustBadge
                            band={run.trust_score >= 65 ? "TRUSTED" : run.trust_score >= 40 ? "REVIEW" : "ABSTAIN"}
                            score={run.trust_score}
                          />
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                        <span>{formatNumber(run.claims_total)} claims</span>
                        <span>{formatNumber(run.evidence_count)} evidence</span>
                        <span className="ml-auto">{formatDateTime(run.created_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      <GenerationDetailDialog generationId={historyId} onClose={() => setHistoryId(null)} />
    </div>
  );
}
