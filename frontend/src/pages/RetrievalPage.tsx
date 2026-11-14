import {
  ChevronDown,
  ChevronUp,
  FileSearch,
  Filter,
  Layers,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { TLPBadge } from "../components/badges";
import { BarList } from "../components/charts";
import {
  Badge,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingBlock,
  Panel,
  SliderField,
  Tabs,
} from "../components/ui";
import { useResource } from "../hooks/useResource";
import { api, errorMessage } from "../lib/api";
import { cn, formatNumber, formatRatio } from "../lib/format";
import type { RetrievalResponse, RetrievedChunk, TLPLevel } from "../lib/types";

const TLP_OPTIONS: TLPLevel[] = ["WHITE", "GREEN", "AMBER", "RED"];

function ResultCard({ result }: { result: RetrievedChunk }) {
  const [expanded, setExpanded] = useState(false);
  const long = result.text.length > 620;
  return (
    <article className="panel-flat overflow-hidden">
      <div className="flex items-start gap-3 border-b border-white/[0.05] px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-brand-400/20 bg-brand-400/10 font-mono text-[11px] font-semibold text-brand-200">
          {result.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium text-slate-200">{result.document_title}</h3>
            <TLPBadge tlp={result.tlp} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {result.section_header ?? "Unsectioned passage"} · p.{result.page_start}
            {result.page_end !== result.page_start ? `–${result.page_end}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-semibold text-brand-200">{result.hybrid_score.toFixed(3)}</p>
          <p className="text-[10px] uppercase tracking-[0.13em] text-slate-600">hybrid</p>
        </div>
      </div>

      <div className="px-4 py-3">
        <p
          className={cn(
            "whitespace-pre-wrap text-xs leading-relaxed text-slate-400",
            !expanded && "max-h-32 overflow-hidden",
          )}
        >
          {result.text}
        </p>
        {long && (
          <button
            type="button"
            className="btn-ghost mt-1 px-0 py-1 text-[11px] text-brand-300"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? "Collapse passage" : "Expand passage"}
          </button>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>BM25 keyword</span>
              <span className="font-mono">{result.bm25_score.toFixed(3)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-brand-400"
                style={{ width: `${Math.min(100, Math.max(1, result.bm25_score * 100))}%` }}
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Semantic similarity</span>
              <span className="font-mono">{result.semantic_score.toFixed(3)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-signal-violet"
                style={{ width: `${Math.min(100, Math.max(1, result.semantic_score * 100))}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span>
              authority <span className="font-mono text-slate-300">{formatRatio(result.document_authority, 0)}</span>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function RetrievalPage() {
  const [query, setQuery] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [topK, setTopK] = useState(8);
  const [semanticWeight, setSemanticWeight] = useState(0.6);
  const [tlpMax, setTlpMax] = useState<TLPLevel | "">("");
  const [minScore, setMinScore] = useState(0);
  const [result, setResult] = useState<RetrievalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documents = useResource(() => api.listDocuments({ page: 1, page_size: 100 }), []);

  const submit = async (event?: FormEvent, overrideQuery?: string) => {
    event?.preventDefault();
    const effectiveQuery = (overrideQuery ?? query).trim();
    if (effectiveQuery.length < 2) {
      setError("Enter at least two characters to search the corpus.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await api.search({
        query: effectiveQuery,
        document_ids: documentId ? [documentId] : [],
        top_k: topK,
        semantic_weight: semanticWeight,
        tlp_max: tlpMax || null,
        min_score: minScore,
      });
      setResult(next);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">Retrieval lab</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Dual-vector hybrid search</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          BM25 lexical matching and semantic chunk similarity are fused into a single ranked score. TLP clearance
          is enforced before ranking, so sensitive evidence never appears in a lower-clearance query.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <form onSubmit={submit} className="space-y-4">
          <Panel title="Query controls" icon={SlidersHorizontal}>
            <div className="space-y-4">
              <Field label="Evidence question / search query" hint="Natural-language queries and selectors work best.">
                <textarea
                  className="textarea min-h-[130px]"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Which C2 infrastructure and execution techniques did the actor use against the finance sector?"
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit();
                  }}
                />
              </Field>

              <Field label="Document scope" hint="Restrict retrieval to a single evidence source.">
                <select className="select" value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                  <option value="">Entire corpus</option>
                  {(documents.data?.items ?? []).map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Top K">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    className="input"
                    value={topK}
                    onChange={(event) => setTopK(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                  />
                </Field>
                <Field label="TLP ceiling">
                  <select
                    className="select"
                    value={tlpMax}
                    onChange={(event) => setTlpMax(event.target.value as TLPLevel | "")}
                  >
                    <option value="">No ceiling</option>
                    {TLP_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        TLP:{option}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <SliderField
                label="Semantic weight"
                value={semanticWeight}
                onChange={setSemanticWeight}
                min={0}
                max={1}
                step={0.05}
                format={(value) => `${(value * 100).toFixed(0)}% semantic / ${((1 - value) * 100).toFixed(0)}% BM25`}
              />

              <SliderField
                label="Minimum hybrid score"
                value={minScore}
                onChange={setMinScore}
                min={0}
                max={1}
                step={0.01}
                format={(value) => value.toFixed(2)}
                hint="Raise to suppress weak matches and force abstention."
              />

              <button type="submit" className="btn-primary w-full" disabled={loading}>
                <Search size={15} />
                {loading ? "Searching corpus…" : "Run hybrid retrieval"}
              </button>
              <p className="text-center text-[10px] text-slate-600">
                <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> to run
              </p>
            </div>
          </Panel>

          <Panel title="Fusion model" subtitle="How the ranking is composed" icon={Layers}>
            <div className="space-y-3 text-[11px] leading-relaxed text-slate-500">
              <div className="flex items-center justify-between gap-2">
                <span>Keyword weight</span>
                <Badge className="border-brand-400/20 bg-brand-400/10 text-brand-200">
                  {((1 - semanticWeight) * 100).toFixed(0)}%
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Semantic weight</span>
                <Badge className="border-signal-violet/20 bg-signal-violet/10 text-signal-violet">
                  {(semanticWeight * 100).toFixed(0)}%
                </Badge>
              </div>
              <p>
                Scores are normalised per signal before fusion, then ranked. Section headers, page spans and
                document authority travel with every chunk so downstream trust scoring stays explainable.
              </p>
            </div>
          </Panel>
        </form>

        <div className="space-y-4">
          {error && <ErrorBanner message={error} onRetry={() => void submit()} />}

          {loading && !result ? (
            <Panel title="Running retrieval" icon={FileSearch}>
              <LoadingBlock label="Scoring candidate chunks…" />
            </Panel>
          ) : !result ? (
            <Panel>
              <EmptyState
                title="Run a retrieval to inspect evidence"
                description="The lab shows lexical and semantic contributions for every retrieved passage so you can validate why evidence surfaced."
                icon={FileSearch}
                action={
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const example = "initial access phishing infrastructure used by the threat actor";
                      setQuery(example);
                      void submit(undefined, example);
                    }}
                  >
                    <Sparkles size={14} /> Try an example query
                  </button>
                }
              />
            </Panel>
          ) : (
            <>
              <Panel
                title="Ranked evidence"
                subtitle={`${formatNumber(result.results.length)} chunks from ${formatNumber(result.candidate_chunks)} candidates · ${result.elapsed_ms.toFixed(0)} ms`}
                icon={Filter}
                actions={
                  <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => void submit()}>
                    <RefreshCw size={13} /> Re-run
                  </button>
                }
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Badge className="border-brand-400/20 bg-brand-400/10 text-brand-200">
                    semantic {result.semantic_weight.toFixed(2)} · keyword {result.keyword_weight.toFixed(2)}
                  </Badge>
                  <Badge className="border-white/10 bg-white/[0.04] text-slate-400">query: {result.query}</Badge>
                  {result.matched_terms.slice(0, 10).map((term) => (
                    <span key={term} className="chip px-2 py-0.5 text-[10.5px]">
                      {term}
                    </span>
                  ))}
                </div>

                {result.results.length === 0 ? (
                  <EmptyState
                    title="No evidence above the threshold"
                    description="Lower the minimum hybrid score, widen the TLP ceiling or remove the document scope. TrustRAG would abstain on this query."
                    icon={FileSearch}
                  />
                ) : (
                  <div className="space-y-3">
                    {result.results.map((entry) => (
                      <ResultCard key={`${entry.chunk_id}-${entry.rank}`} result={entry} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Score contribution profile" subtitle="Top-ranked passages by hybrid score" icon={Layers}>
                <BarList
                  items={result.results.slice(0, 8).map((entry) => ({
                    label: `#${entry.rank} ${entry.document_title}${entry.section_header ? ` — ${entry.section_header}` : ""}`,
                    value: entry.hybrid_score,
                    color: "#22d3ee",
                  }))}
                  total={1}
                  emptyLabel="No passages to compare"
                />
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
