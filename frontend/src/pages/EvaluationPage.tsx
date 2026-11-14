import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileText,
  FlaskConical,
  ListChecks,
  Play,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { DegradedBadge, ModeBadge } from "../components/badges";
import { BarList } from "../components/charts";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Field,
  InfoNote,
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
import type {
  EvaluationBatchResponse,
  EvaluationMode,
  EvaluationRunOut,
} from "../lib/types";

const MODE_DESCRIPTION: Record<EvaluationMode, string> = {
  STANDALONE: "Raw model, no retrieval and no evidence discipline.",
  STANDARD_RAG: "Retrieved evidence injected without claim verification or trust gating.",
  TRUSTRAG: "Injection-aware retrieval, claim verification, weighted trust and abstention.",
};

const MODE_COLOR: Record<EvaluationMode, string> = {
  STANDALONE: "#fb7185",
  STANDARD_RAG: "#fbbf24",
  TRUSTRAG: "#34d399",
};

function MetricCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-600">{label}</p>
      <p className={cn("mt-0.5 font-mono text-xs", tone ?? "text-slate-300")}>{value}</p>
    </div>
  );
}

function RunCard({ run, winner }: { run: EvaluationRunOut; winner: boolean }) {
  const composite = Number(run.metrics?.composite_score ?? 0);
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        winner
          ? "border-signal-supported/25 bg-signal-supported/[0.05]"
          : "border-white/[0.06] bg-white/[0.02]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ModeBadge mode={run.mode} />
        {winner && (
          <Badge className="border-signal-supported/30 bg-signal-supported/10 text-signal-supported">
            <Trophy size={11} /> Winner
          </Badge>
        )}
        <DegradedBadge degraded={run.degraded} />
        <span className="ml-auto font-mono text-sm font-semibold text-brand-200">
          {formatRatio(composite, 0)}
          <span className="ml-1 text-[9px] font-normal uppercase tracking-[0.1em] text-slate-600">composite</span>
        </span>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">{MODE_DESCRIPTION[run.mode]}</p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCell label="Groundedness" value={formatRatio(run.groundedness)} tone="text-signal-supported" />
        <MetricCell label="Hallucination" value={formatRatio(run.hallucination_rate)} tone="text-signal-contradicted" />
        <MetricCell label="Citation coverage" value={formatRatio(run.citation_coverage)} />
        <MetricCell label="Trust score" value={run.trust_score != null ? formatScore(run.trust_score) : "—"} />
        <MetricCell label="IOC recall" value={run.ioc_recall != null ? formatRatio(run.ioc_recall) : "—"} />
        <MetricCell label="Latency" value={`${formatNumber(Math.round(run.latency_ms))} ms`} />
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.05] bg-ink-950/50 p-3">
        <p className="line-clamp-6 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-400">
          {run.answer_text || "No answer produced."}
        </p>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span>{run.model_used}</span>
        <span>·</span>
        <span>{formatNumber(run.total_claims)} claims</span>
        <span>·</span>
        <span>{run.grounded_claims} supported / {run.contradicted_claims} contradicted</span>
      </div>
    </div>
  );
}

function BatchRunsDialog({ batchId, onClose }: { batchId: string | null; onClose: () => void }) {
  const runs = useResource(
    () => api.getEvaluationBatch(batchId as string),
    [batchId],
    { enabled: Boolean(batchId) },
  );

  return (
    <Modal
      open={Boolean(batchId)}
      onClose={onClose}
      title="Evaluation batch detail"
      subtitle={batchId ? `Batch ${batchId.slice(0, 8)}…` : undefined}
      size="xl"
      footer={<button type="button" className="btn-secondary" onClick={onClose}>Close</button>}
    >
      {runs.loading && !runs.data ? (
        <LoadingBlock />
      ) : runs.error ? (
        <ErrorBanner message={runs.error} onRetry={() => void runs.reload()} />
      ) : runs.data && runs.data.length > 0 ? (
        <div className="space-y-3">
          {runs.data.map((run) => (
            <RunCard key={run.id} run={run} winner={Number(run.metrics?.composite_score ?? 0) === Math.max(...runs.data!.map((item) => Number(item.metrics?.composite_score ?? 0)))} />
          ))}
        </div>
      ) : (
        <EmptyState title="Batch not found" description="The evaluation runs may have been removed." icon={FlaskConical} />
      )}
    </Modal>
  );
}

export default function EvaluationPage() {
  const toast = useToast();
  const [question, setQuestion] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [topK, setTopK] = useState(6);
  const [semanticWeight, setSemanticWeight] = useState(0.6);
  const [expectedIocs, setExpectedIocs] = useState("");
  const [persist, setPersist] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [batch, setBatch] = useState<EvaluationBatchResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);

  const documents = useResource(() => api.listDocuments({ page: 1, page_size: 100 }), []);
  const summary = useResource(() => api.evaluationSummary(), [version]);
  const batches = useResource(() => api.listEvaluationBatches({ page: 1, page_size: 10 }), [version]);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (question.trim().length < 3) {
      setRunError("Enter a question of at least three characters.");
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const next = await api.runEvaluation({
        question: question.trim(),
        document_ids: documentId ? [documentId] : [],
        top_k: topK,
        semantic_weight: semanticWeight,
        expected_iocs: expectedIocs
          .split(/[\s,;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        persist,
      });
      setBatch(next);
      setVersion((value) => value + 1);
      toast.push(
        "success",
        "Three-way benchmark complete",
        `Winner: ${next.winner.replace("_", " ")} · ${next.runs.length} modes evaluated`,
      );
    } catch (caught) {
      setRunError(errorMessage(caught));
    } finally {
      setRunning(false);
    }
  };

  const summaryBars = (summary.data?.average_by_mode ?? []).map((item) => ({
    label: `${item.mode.replace("_", " ")} · ${item.runs} runs`,
    value: item.groundedness,
    color: MODE_COLOR[item.mode] ?? "#22d3ee",
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">Assurance</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Evaluation centre</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            One question is answered three ways — standalone LLM, standard RAG and TrustRAG-Agent — and every
            answer is scored for groundedness, hallucination, citation coverage, IOC recall, trust and latency.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setVersion((value) => value + 1)}>
          <RefreshCw size={14} className={cn((summary.loading || batches.loading) && "animate-spin")} /> Refresh
        </button>
      </div>

      <Panel title="Run a three-way benchmark" subtitle="TrustRAG refuses to manufacture an answer when evidence is absent — baselines will not." icon={FlaskConical}>
        <form onSubmit={run} className="space-y-4">
          <Field label="Evaluation question" hint="The same question is sent to all three pipelines with the same retrieval scope.">
            <textarea
              className="textarea min-h-[92px]"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Describe the actor's initial access and C2 infrastructure with supporting evidence."
            />
          </Field>

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
            <Field label="Top K evidence">
              <input
                type="number"
                min={1}
                max={20}
                className="input"
                value={topK}
                onChange={(event) => setTopK(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
              />
            </Field>
            <Field label="Expected IOCs" hint="Optional. Comma or space separated values for recall scoring.">
              <input
                className="input font-mono text-[11px]"
                value={expectedIocs}
                onChange={(event) => setExpectedIocs(event.target.value)}
                placeholder="185.220.101.45, evil[.]example"
              />
            </Field>
            <div className="space-y-2">
              <SliderField
                label="Semantic weight"
                value={semanticWeight}
                onChange={setSemanticWeight}
                min={0}
                max={1}
                step={0.05}
                format={(value) => value.toFixed(2)}
              />
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={persist}
                  onChange={(event) => setPersist(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-brand-400"
                />
                Persist runs to history
              </label>
            </div>
          </div>

          {runError && <ErrorBanner message={runError} />}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[10.5px] leading-relaxed text-slate-600">
              Composite score = 40% groundedness + 20% non-contradiction + 15% citation coverage + 15% trust + 10% non-degraded.
            </p>
            <button type="submit" className="btn-primary shrink-0" disabled={running}>
              {running ? <Spinner size={15} /> : <Play size={15} />}
              {running ? "Running three pipelines…" : "Run benchmark"}
            </button>
          </div>
        </form>
      </Panel>

      {batch ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-signal-supported/20 bg-signal-supported/[0.05] px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-signal-supported/25 bg-signal-supported/10 text-signal-supported">
                <Trophy size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  Winner: <span className="text-signal-supported">{batch.winner.replace("_", " ")}</span>
                </p>
                <p className="text-[11px] text-slate-500">{truncate(batch.question, 120)}</p>
              </div>
            </div>
            <Badge className="border-white/10 bg-white/[0.04] text-slate-400">
              batch {batch.batch_id.slice(0, 8)}…
            </Badge>
          </div>

          <Panel title="Head-to-head comparison" subtitle="Sorted by composite score" icon={Scale}>
            <div className="overflow-x-auto">
              <table className="table-shell">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Groundedness</th>
                    <th>Hallucination</th>
                    <th>Citations</th>
                    <th>Trust</th>
                    <th>IOC recall</th>
                    <th>Latency</th>
                    <th>Composite</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.comparison.map((row) => (
                    <tr key={row.mode} className={cn(row.mode === batch.winner && "bg-signal-supported/[0.04]")}>
                      <td><ModeBadge mode={row.mode} /></td>
                      <td><span className="font-mono text-xs text-signal-supported">{formatRatio(row.groundedness)}</span></td>
                      <td><span className="font-mono text-xs text-signal-contradicted">{formatRatio(row.hallucination_rate)}</span></td>
                      <td><span className="font-mono text-xs text-slate-300">{formatRatio(row.citation_coverage)}</span></td>
                      <td><span className="font-mono text-xs text-slate-300">{row.trust_score != null ? formatScore(row.trust_score) : "—"}</span></td>
                      <td><span className="font-mono text-xs text-slate-300">{row.ioc_recall != null ? formatRatio(row.ioc_recall) : "—"}</span></td>
                      <td><span className="font-mono text-xs text-slate-400">{formatNumber(Math.round(row.latency_ms))} ms</span></td>
                      <td>
                        <div className="flex items-center gap-2">
                          <ProgressBar value={row.composite} height={4} className="w-16" tone={MODE_COLOR[row.mode]} />
                          <span className="font-mono text-xs text-slate-200">{formatRatio(row.composite, 0)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {batch.notes.length > 0 && (
              <div className="mt-3">
                <InfoNote tone="warning" icon={AlertTriangle}>
                  <span className="font-semibold">Run notes</span>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {batch.notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </InfoNote>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-3">
            {batch.runs.map((run) => (
              <RunCard key={run.id} run={run} winner={run.mode === batch.winner} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {(["STANDALONE", "STANDARD_RAG", "TRUSTRAG"] as EvaluationMode[]).map((mode) => (
            <Panel key={mode} title={mode.replace("_", " ")} subtitle={MODE_DESCRIPTION[mode]} icon={mode === "TRUSTRAG" ? ShieldCheck : mode === "STANDARD_RAG" ? FileText : Sparkles}>
              <div className="space-y-3 text-[11px] leading-relaxed text-slate-500">
                {mode === "STANDALONE" && (
                  <>
                    <p>No retrieval. The model may answer from prior knowledge or fabricate specifics.</p>
                    <p className="text-signal-contradicted">Expected weakness: unsupported specifics and no citations.</p>
                  </>
                )}
                {mode === "STANDARD_RAG" && (
                  <>
                    <p>Retrieves the same top-K evidence and injects it into the prompt without claim verification.</p>
                    <p className="text-signal-review">Expected weakness: retrieval supports the answer, but unsupported sentences pass through.</p>
                  </>
                )}
                {mode === "TRUSTRAG" && (
                  <>
                    <p>Delimits untrusted evidence, verifies atomic claims, applies weighted trust and abstains below threshold.</p>
                    <p className="text-signal-supported">Expected strength: lower hallucination and an explicit abstention path.</p>
                  </>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Historical averages by mode"
          subtitle={`${formatNumber(summary.data?.total_batches ?? 0)} persisted batches`}
          icon={Scale}
        >
          {summary.loading && !summary.data ? (
            <LoadingBlock />
          ) : summary.error ? (
            <ErrorBanner message={summary.error} onRetry={() => void summary.reload()} />
          ) : !summary.data || summary.data.average_by_mode.length === 0 ? (
            <EmptyState title="No persisted evaluations" description="Run a benchmark with persistence enabled to build mode averages." icon={FlaskConical} />
          ) : (
            <div className="space-y-5">
              <BarList items={summaryBars} total={1} emptyLabel="No averages yet" />
              <div className="space-y-2 border-t border-white/[0.06] pt-3">
                {summary.data.average_by_mode.map((item) => (
                  <div key={item.mode} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <ModeBadge mode={item.mode} />
                    <span className="text-slate-500">
                      halluc. <span className="font-mono text-signal-contradicted">{formatRatio(item.hallucination_rate)}</span> · trust{" "}
                      <span className="font-mono text-slate-300">{formatScore(item.avg_trust_score)}</span> ·{" "}
                      <span className="font-mono text-slate-400">{formatNumber(Math.round(item.avg_latency_ms))} ms</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title="Recent batches"
          subtitle="Click to inspect all three runs"
          icon={ListChecks}
          actions={
            <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => void batches.reload()}>
              <RefreshCw size={12} /> Refresh
            </button>
          }
        >
          {batches.loading && !batches.data ? (
            <LoadingBlock />
          ) : batches.error ? (
            <ErrorBanner message={batches.error} onRetry={() => void batches.reload()} />
          ) : (batches.data ?? []).length === 0 ? (
            <EmptyState title="No batches" description="Benchmark history appears here when persistence is enabled." icon={ListChecks} />
          ) : (
            <div className="space-y-2">
              {(batches.data ?? []).map((item) => (
                <button
                  key={item.batch_id}
                  type="button"
                  onClick={() => setBatchId(item.batch_id)}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-brand-400/25 hover:bg-white/[0.035]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-slate-300">{truncate(item.question, 90)}</span>
                    <ArrowUpRight size={13} className="shrink-0 text-slate-500" />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                    <ModeBadge mode={item.best_mode as EvaluationMode} />
                    <span>{item.runs} runs</span>
                    <span className="ml-auto flex items-center gap-1">
                      <Clock size={10} /> {formatDateTime(item.created_at)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <InfoNote icon={CheckCircle2}>
        <span className="font-semibold">Read this before citing results.</span> Without a configured Gemini API key,
        the standalone baseline cannot run and the standard-RAG baseline falls back to extractive mode; the
        comparison then validates pipeline mechanics rather than absolute model quality. IOC recall is only
        computed when expected indicators are supplied.
      </InfoNote>

      <BatchRunsDialog batchId={batchId} onClose={() => setBatchId(null)} />
    </div>
  );
}
