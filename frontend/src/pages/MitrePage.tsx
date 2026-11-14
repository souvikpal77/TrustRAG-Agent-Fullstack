import {
  Check,
  Crosshair,
  Filter,
  LayoutGrid,
  ListChecks,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CandidateBadge } from "../components/badges";
import {
  Badge,
  CodeChip,
  EmptyState,
  ErrorBanner,
  Field,
  InfoNote,
  KeyValue,
  LoadingBlock,
  Modal,
  Pagination,
  Panel,
  ProgressBar,
  Tabs,
  useToast,
} from "../components/ui";
import { useDebounced, useResource } from "../hooks/useResource";
import { api, errorMessage } from "../lib/api";
import { cn, formatDateTime, formatNumber, formatRatio, truncate } from "../lib/format";
import type {
  CandidateStatus,
  MitreCandidateOut,
  MitreMatrixResponse,
  TechniqueOut,
} from "../lib/types";

const STATUS_OPTIONS: CandidateStatus[] = ["PENDING", "APPROVED", "REJECTED"];

function MatrixView({ matrix }: { matrix: MitreMatrixResponse }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return matrix.techniques;
    return matrix.techniques.filter(
      (technique) =>
        technique.technique_id.toLowerCase().includes(term) ||
        technique.name.toLowerCase().includes(term) ||
        technique.tactic_name.toLowerCase().includes(term) ||
        technique.keywords.some((keyword) => keyword.toLowerCase().includes(term)),
    );
  }, [matrix.techniques, query]);

  const byTactic = useMemo(() => {
    const grouped = new Map<string, TechniqueOut[]>();
    for (const technique of filtered) {
      const list = grouped.get(technique.tactic_id) ?? [];
      list.push(technique);
      grouped.set(technique.tactic_id, list);
    }
    return grouped;
  }, [filtered]);

  return (
    <Panel
      dense
      title="ATT&CK Enterprise matrix"
      subtitle={`${formatNumber(matrix.total_tactics)} tactics · ${formatNumber(matrix.total_techniques)} authentic enterprise techniques`}
      icon={LayoutGrid}
      actions={
        <div className="relative w-[220px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search technique, tactic or keyword…"
            className="input py-1.5 pl-8 text-xs"
          />
        </div>
      }
    >
      <div className="flex gap-3 overflow-x-auto p-4">
        {matrix.tactics.map((tactic) => {
          const techniques = byTactic.get(tactic.tactic_id) ?? [];
          if (query.trim() && techniques.length === 0) return null;
          return (
            <div key={tactic.tactic_id} className="w-[252px] shrink-0">
              <div className="mb-2 rounded-lg border border-white/[0.07] bg-ink-900/70 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-slate-200">{tactic.name}</span>
                  <span className="font-mono text-[9.5px] text-slate-500">{tactic.tactic_id}</span>
                </div>
                <p className="mt-0.5 font-mono text-[9.5px] text-slate-600">{tactic.short_name}</p>
              </div>
              <div className="scrollbar-none max-h-[540px] space-y-1.5 overflow-y-auto pr-1">
                {techniques.length === 0 ? (
                  <p className="px-1 py-3 text-center text-[10px] text-slate-600">No techniques in filter</p>
                ) : (
                  techniques.map((technique) => (
                    <div
                      key={technique.technique_id}
                      className={cn(
                        "rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 transition hover:border-brand-400/25 hover:bg-white/[0.035]",
                        technique.is_subtechnique && "ml-2 border-l-2 border-l-signal-violet/30",
                      )}
                      title={`${technique.technique_id} · ${technique.name}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[10.5px] leading-snug text-slate-300">{technique.name}</p>
                        <span className="shrink-0 font-mono text-[9px] text-brand-300/80">{technique.technique_id}</span>
                      </div>
                      {technique.platforms.length > 0 && (
                        <p className="mt-1 truncate text-[9px] text-slate-600">{technique.platforms.slice(0, 4).join(" · ")}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export default function MitrePage() {
  const toast = useToast();
  const [tab, setTab] = useState<"candidates" | "matrix">("candidates");
  const [version, setVersion] = useState(0);

  const [status, setStatus] = useState<CandidateStatus | "">("");
  const [techniqueQuery, setTechniqueQuery] = useState("");
  const technique = useDebounced(techniqueQuery, 400);
  const [page, setPage] = useState(1);

  const [mapDocumentId, setMapDocumentId] = useState("");
  const [maxCandidates, setMaxCandidates] = useState(8);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [mapping, setMapping] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);
  const [detail, setDetail] = useState<MitreCandidateOut | null>(null);

  const stats = useResource(() => api.mitreStats(), [version]);
  const candidates = useResource(
    () =>
      api.listMitreCandidates({
        page,
        page_size: 25,
        status: status || undefined,
        technique_id: technique.trim() || undefined,
      }),
    [page, status, technique, version],
  );
  const matrix = useResource(() => api.mitreMatrix(), [], { enabled: tab === "matrix" });
  const documents = useResource(() => api.listDocuments({ page: 1, page_size: 100 }), []);

  useEffect(() => {
    setPage(1);
  }, [status, technique]);

  const decide = async (candidate: MitreCandidateOut, next: Extract<CandidateStatus, "APPROVED" | "REJECTED">) => {
    setBusyCandidate(candidate.id);
    try {
      const updated = await api.decideMitreCandidate(candidate.id, { status: next });
      toast.push(
        "success",
        next === "APPROVED" ? "Technique approved" : "Technique rejected",
        `${updated.technique_id} ${updated.technique_name} — ${candidate.document_title}`,
      );
      setVersion((value) => value + 1);
      if (detail?.id === candidate.id) setDetail(updated);
    } catch (caught) {
      toast.push("error", "Decision failed", errorMessage(caught));
    } finally {
      setBusyCandidate(null);
    }
  };

  const mapDocument = async () => {
    if (!mapDocumentId) {
      setMapError("Select a document to map.");
      return;
    }
    setMapping(true);
    setMapError(null);
    try {
      const response = await api.mapMitre({
        document_id: mapDocumentId,
        max_candidates: maxCandidates,
        replace_existing: replaceExisting,
      });
      toast.push(
        "success",
        "ATT&CK mapping complete",
        `${response.created} candidate techniques generated${response.degraded ? " (degraded offline mapping)" : ""}`,
      );
      setVersion((value) => value + 1);
      setTab("candidates");
    } catch (caught) {
      setMapError(errorMessage(caught));
    } finally {
      setMapping(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">Tradecraft</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">MITRE ATT&CK mapping</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Evidence-backed technique candidates are proposed by the mapper and require explicit analyst
            approval. Approvals and rejections are written to the immutable audit chain.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            tabs={[
              { id: "candidates", label: "Candidates", icon: ListChecks, count: candidates.data?.total },
              { id: "matrix", label: "Matrix", icon: LayoutGrid },
            ]}
            active={tab}
            onChange={setTab}
          />
          <button type="button" className="btn-secondary" onClick={() => setVersion((value) => value + 1)}>
            <RefreshCw size={14} className={cn(stats.loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-review/20 bg-signal-review/10 text-signal-review">
            <Crosshair size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Pending review</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(stats.data?.pending ?? 0)}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-supported/20 bg-signal-supported/10 text-signal-supported">
            <ShieldCheck size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Approved</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(stats.data?.approved ?? 0)}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-contradicted/20 bg-signal-contradicted/10 text-signal-contradicted">
            <X size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Rejected</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(stats.data?.rejected ?? 0)}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-violet/20 bg-signal-violet/10 text-signal-violet">
            <LayoutGrid size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Top technique</p>
            <p className="truncate text-sm font-semibold text-slate-100">
              {stats.data?.top_techniques[0]
                ? `${stats.data.top_techniques[0].technique_id} · ${stats.data.top_techniques[0].count}`
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {tab === "candidates" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Panel dense>
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
              <div className="relative min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={techniqueQuery}
                  onChange={(event) => setTechniqueQuery(event.target.value)}
                  placeholder="Filter by technique ID (e.g. T1566)…"
                  className="input pl-9"
                />
              </div>
              <select
                className="select w-auto min-w-[150px]"
                value={status}
                onChange={(event) => setStatus(event.target.value as CandidateStatus | "")}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            {candidates.error && <div className="p-4"><ErrorBanner message={candidates.error} onRetry={() => void candidates.reload()} /></div>}
            {candidates.loading && !candidates.data ? (
              <LoadingBlock />
            ) : !candidates.data || candidates.data.items.length === 0 ? (
              <EmptyState
                title="No ATT&CK candidates"
                description="Map a document from the corpus view or the panel on the right. Candidates are only operational after analyst approval."
                icon={ShieldCheck}
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="table-shell">
                    <thead>
                      <tr>
                        <th>Technique</th>
                        <th>Tactic</th>
                        <th>Document</th>
                        <th>Confidence</th>
                        <th>Status</th>
                        <th>Reviewed</th>
                        <th className="text-right">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.data.items.map((candidate) => (
                        <tr key={candidate.id}>
                          <td className="max-w-[250px]">
                            <button type="button" className="block max-w-full text-left" onClick={() => setDetail(candidate)}>
                              <span className="font-mono text-[11px] text-brand-200">{candidate.technique_id}</span>
                              <span className="mt-0.5 block truncate text-xs font-medium text-slate-300">{candidate.technique_name}</span>
                            </button>
                          </td>
                          <td><span className="text-[11px] text-slate-400">{candidate.tactic_name}</span></td>
                          <td>
                            <span className="block max-w-[190px] truncate text-[11px] text-slate-400" title={candidate.document_title}>
                              {candidate.document_title}
                            </span>
                          </td>
                          <td className="min-w-[110px]">
                            <div className="flex items-center gap-2">
                              <ProgressBar value={candidate.confidence} height={4} className="w-14" />
                              <span className="font-mono text-[10px] text-slate-500">{formatRatio(candidate.confidence, 0)}</span>
                            </div>
                          </td>
                          <td><CandidateBadge status={candidate.status} /></td>
                          <td>
                            <span className="text-[10.5px] text-slate-500">
                              {candidate.reviewed_by ?? "—"}
                              {candidate.reviewed_at && (
                                <span className="block text-[9.5px] text-slate-600">{formatDateTime(candidate.reviewed_at)}</span>
                              )}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                className="btn-ghost px-1.5 py-1 text-signal-supported"
                                title="Approve technique"
                                disabled={busyCandidate === candidate.id}
                                onClick={() => void decide(candidate, "APPROVED")}
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                className="btn-ghost px-1.5 py-1 text-signal-contradicted"
                                title="Reject technique"
                                disabled={busyCandidate === candidate.id}
                                onClick={() => void decide(candidate, "REJECTED")}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={candidates.data.page}
                  pageSize={candidates.data.page_size}
                  total={candidates.data.total}
                  onPageChange={setPage}
                />
              </>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Map a document" subtitle="Propose evidence-backed techniques" icon={Crosshair}>
              <div className="space-y-3">
                <Field label="Evidence document">
                  <select className="select" value={mapDocumentId} onChange={(event) => setMapDocumentId(event.target.value)}>
                    <option value="">Select a document…</option>
                    {(documents.data?.items ?? []).map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Maximum candidates">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="input"
                    value={maxCandidates}
                    onChange={(event) => setMaxCandidates(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
                  />
                </Field>
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(event) => setReplaceExisting(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-brand-400"
                  />
                  Replace existing candidates for this document
                </label>
                {mapError && <ErrorBanner message={mapError} />}
                <button type="button" className="btn-primary w-full" onClick={() => void mapDocument()} disabled={mapping || !mapDocumentId}>
                  <Crosshair size={15} className={cn(mapping && "animate-pulse")} />
                  {mapping ? "Mapping…" : "Generate candidates"}
                </button>
                <p className="text-[10px] leading-relaxed text-slate-600">
                  Mapping uses the seeded ATT&CK enterprise catalogue and document evidence. Degraded offline
                  mapping is labelled in the result.
                </p>
              </div>
            </Panel>

            <Panel title="Most proposed techniques" subtitle="Across the current corpus" icon={ListChecks}>
              {!stats.data || stats.data.top_techniques.length === 0 ? (
                <EmptyState title="No candidates yet" description="Map a document to populate technique statistics." icon={Filter} />
              ) : (
                <div className="space-y-2.5">
                  {stats.data.top_techniques.map((item) => (
                    <div key={item.technique_id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-mono text-[10px] text-brand-200/80">{item.technique_id}</span>
                        <p className="truncate text-[11px] text-slate-400">{item.name}</p>
                      </div>
                      <Badge className="border-white/10 bg-white/[0.04] text-slate-400">{formatNumber(item.count)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      ) : matrix.loading && !matrix.data ? (
        <Panel title="Loading ATT&CK matrix" icon={LayoutGrid}><LoadingBlock /></Panel>
      ) : matrix.error ? (
        <ErrorBanner message={matrix.error} onRetry={() => void matrix.reload()} />
      ) : matrix.data ? (
        <MatrixView matrix={matrix.data} />
      ) : null}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.technique_id} · ${detail.technique_name}` : "Candidate detail"}
        subtitle={detail ? `${detail.tactic_id} · ${detail.tactic_name}` : undefined}
        size="lg"
        footer={
          detail ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setDetail(null)}>Close</button>
              <button
                type="button"
                className="btn-danger"
                disabled={busyCandidate === detail.id}
                onClick={() => void decide(detail, "REJECTED")}
              >
                <X size={14} /> Reject
              </button>
              <button
                type="button"
                className="btn-success"
                disabled={busyCandidate === detail.id}
                onClick={() => void decide(detail, "APPROVED")}
              >
                <Check size={14} /> Approve
              </button>
            </>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <CandidateBadge status={detail.status} />
              <CodeChip>{detail.technique_id}</CodeChip>
              <Badge className="border-white/10 bg-white/[0.04] text-slate-400">
                confidence {formatRatio(detail.confidence, 0)}
              </Badge>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <KeyValue label="Technique">{detail.technique_name}</KeyValue>
              <KeyValue label="Tactic">{detail.tactic_id} · {detail.tactic_name}</KeyValue>
              <KeyValue label="Document">{detail.document_title}</KeyValue>
              <KeyValue label="Created">{formatDateTime(detail.created_at)}</KeyValue>
              <KeyValue label="Reviewed by">{detail.reviewed_by ?? "Not reviewed"}</KeyValue>
              <KeyValue label="Reviewed at">{detail.reviewed_at ? formatDateTime(detail.reviewed_at) : "—"}</KeyValue>
            </dl>

            <div>
              <p className="label">Mapping rationale</p>
              <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-slate-400">
                {detail.rationale || "No rationale was provided by the mapper."}
              </p>
            </div>

            <div>
              <p className="label">Evidence snippet</p>
              <blockquote className="rounded-lg border-l-2 border-brand-400/40 bg-ink-950/50 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
                {truncate(detail.evidence_snippet, 1200) || "No evidence snippet."}
              </blockquote>
            </div>

            <InfoNote icon={ShieldCheck}>
              Analyst approval is required before a technique is treated as confirmed. The decision is recorded
              with actor, timestamp and rationale in the audit hash chain.
            </InfoNote>
          </div>
        )}
      </Modal>
    </div>
  );
}
