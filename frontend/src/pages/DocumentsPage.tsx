import {
  Crosshair,
  Eye,
  FileText,
  Filter,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";

import { TLPBadge } from "../components/badges";
import {
  Badge,
  CopyButton,
  EmptyState,
  ErrorBanner,
  Field,
  JsonBlock,
  KeyValue,
  LoadingBlock,
  Modal,
  Pagination,
  Panel,
  SliderField,
  Tabs,
  useToast,
} from "../components/ui";
import { useDebounced, useResource } from "../hooks/useResource";
import { api, errorMessage } from "../lib/api";
import {
  cn,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatRatio,
  shortHash,
  truncate,
} from "../lib/format";
import type {
  DocumentDetail,
  DocumentSummary,
  DocumentUploadResponse,
  SourceType,
  TLPLevel,
} from "../lib/types";

const TLP_OPTIONS: TLPLevel[] = ["WHITE", "GREEN", "AMBER", "RED"];
const SOURCE_OPTIONS: SourceType[] = ["PDF", "TXT", "MARKDOWN"];
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

function StatusBadge({ status }: { status: DocumentSummary["status"] }) {
  return (
    <Badge
      className={cn(
        status === "PROCESSED"
          ? "border-signal-supported/30 bg-signal-supported/10 text-signal-supported"
          : "border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted",
      )}
    >
      {status}
    </Badge>
  );
}

function UploadDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (response: DocumentUploadResponse) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tlp, setTlp] = useState<TLPLevel>("AMBER");
  const [provenance, setProvenance] = useState("");
  const [authority, setAuthority] = useState(0.6);
  const [publishedAt, setPublishedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle("");
    setTlp("AMBER");
    setProvenance("");
    setAuthority(0.6);
    setPublishedAt("");
    setBusy(false);
    setError(null);
    setDragging(false);
  }, [open]);

  const pickFile = (next: File | null) => {
    if (!next) return;
    if (next.size > MAX_UPLOAD_BYTES) {
      setError(`File is too large (${formatBytes(next.size)}). Maximum is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setError(null);
    setFile(next);
    if (!title.trim()) {
      setTitle(next.name.replace(/\.[^.]+$/, ""));
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files?.[0] ?? null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Select a PDF, TXT or Markdown file to ingest.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.uploadDocument({
        file,
        title: title.trim() || undefined,
        tlp,
        provenance: provenance.trim() || undefined,
        authority_score: authority,
        published_at: publishedAt ? new Date(`${publishedAt}T00:00:00Z`).toISOString() : undefined,
      });
      onUploaded(response);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ingest CTI evidence"
      subtitle="PDF, plain text or Markdown. The file is hashed with SHA-256 and chunked server-side."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="upload-form" className="btn-primary" disabled={busy || !file}>
            <Upload size={15} className={cn(busy && "animate-pulse")} />
            {busy ? "Ingesting…" : "Ingest document"}
          </button>
        </>
      }
    >
      <form id="upload-form" onSubmit={submit} className="space-y-5">
        {error && <ErrorBanner message={error} />}

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "cursor-pointer rounded-xl border border-dashed px-5 py-8 text-center transition",
            dragging
              ? "border-brand-400/60 bg-brand-400/[0.07]"
              : "border-white/[0.12] bg-ink-950/40 hover:border-brand-400/35 hover:bg-white/[0.02]",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
            onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          />
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-brand-300">
            <UploadCloud size={21} />
          </span>
          {file ? (
            <>
              <p className="text-sm font-medium text-slate-200">{file.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {formatBytes(file.size)} · {file.type || "unknown MIME type"}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-300">
                Drop a CTI report here, or <span className="text-brand-300">browse</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">PDF, TXT and Markdown up to 40 MB.</p>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display title" hint="Defaults to the filename without extension.">
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={512}
              placeholder="APT report — Q3 intrusion analysis"
            />
          </Field>
          <Field label="TLP marking" hint="Retrieval enforces TLP clearance ordering.">
            <select className="select" value={tlp} onChange={(event) => setTlp(event.target.value as TLPLevel)}>
              {TLP_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  TLP:{option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Provenance" hint="Publisher, collection source or sharing partner.">
            <input
              className="input"
              value={provenance}
              onChange={(event) => setProvenance(event.target.value)}
              maxLength={512}
              placeholder="e.g. Vendor MISP feed / internal IR team"
            />
          </Field>
          <Field label="Published date" hint="Used for the 180-day freshness half-life.">
            <input
              type="date"
              className="input"
              value={publishedAt}
              onChange={(event) => setPublishedAt(event.target.value)}
            />
          </Field>
        </div>

        <SliderField
          label="Source authority"
          value={authority}
          onChange={setAuthority}
          min={0}
          max={1}
          step={0.01}
          format={(value) => `${(value * 100).toFixed(0)}%`}
          hint="Analyst assessment of publisher credibility. Feeds the authority trust factor."
        />
      </form>
    </Modal>
  );
}

function DocumentDetailDialog({
  documentId,
  open,
  onClose,
  onExtract,
  onMap,
  busyAction,
}: {
  documentId: string | null;
  open: boolean;
  onClose: () => void;
  onExtract: (document: DocumentDetail) => void;
  onMap: (document: DocumentDetail) => void;
  busyAction: { id: string; action: string } | null;
}) {
  const { data, loading, error, reload } = useResource(
    () => api.getDocument(documentId as string),
    [documentId],
    { enabled: open && Boolean(documentId) },
  );
  const [tab, setTab] = useState<"metadata" | "chunks" | "text">("metadata");

  useEffect(() => {
    if (open) setTab("metadata");
  }, [open, documentId]);

  const busy = busyAction?.id === documentId ? busyAction.action : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data?.title ?? "Document detail"}
      subtitle={
        data
          ? `${data.source_type} · TLP:${data.tlp} · ${formatNumber(data.chunks.length)} chunks`
          : "Loading evidence metadata…"
      }
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!data || Boolean(busy)}
            onClick={() => data && onExtract(data)}
          >
            <ScanSearch size={14} />
            {busy === "extract" ? "Extracting…" : "Re-extract IOCs"}
          </button>
          <button type="button" className="btn-primary" disabled={!data || Boolean(busy)} onClick={() => data && onMap(data)}>
            <Crosshair size={14} />
            {busy === "map" ? "Mapping…" : "Map ATT&CK"}
          </button>
        </>
      }
    >
      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => void reload()} />
      ) : data ? (
        <div className="space-y-4">
          <Tabs
            tabs={[
              { id: "metadata", label: "Metadata" },
              { id: "chunks", label: "Chunks", count: data.chunks.length },
              { id: "text", label: "Raw text" },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === "metadata" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:grid-cols-4">
                <KeyValue label="TLP">{TLPBadge({ tlp: data.tlp })}</KeyValue>
                <KeyValue label="Status"><StatusBadge status={data.status} /></KeyValue>
                <KeyValue label="Authority">{formatRatio(data.authority_score)}</KeyValue>
                <KeyValue label="Size">{formatBytes(data.size_bytes)}</KeyValue>
                <KeyValue label="Pages">{formatNumber(data.page_count)}</KeyValue>
                <KeyValue label="Characters">{formatNumber(data.char_count)}</KeyValue>
                <KeyValue label="Chunks">{formatNumber(data.chunks.length)}</KeyValue>
                <KeyValue label="Indicators">{formatNumber(data.ioc_count)}</KeyValue>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <KeyValue label="Original filename">
                  <span className="font-mono text-xs">{data.original_filename}</span>
                </KeyValue>
                <KeyValue label="Provenance">{data.provenance || "Unspecified"}</KeyValue>
                <KeyValue label="Published">{data.published_at ? formatDateTime(data.published_at) : "—"}</KeyValue>
                <KeyValue label="Ingested">{formatDateTime(data.created_at)}</KeyValue>
              </dl>

              <div>
                <p className="label">SHA-256</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-white/[0.07] bg-ink-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
                    {data.sha256}
                  </code>
                  <CopyButton value={data.sha256} label="Copy" />
                </div>
              </div>

              {data.error_message && (
                <ErrorBanner message={`Ingestion note: ${data.error_message}`} />
              )}

              {Object.keys(data.metadata).length > 0 && (
                <div>
                  <p className="label">Extracted metadata</p>
                  <JsonBlock value={data.metadata} />
                </div>
              )}
            </div>
          )}

          {tab === "chunks" && (
            <div className="space-y-2">
              {data.chunks.length === 0 ? (
                <EmptyState title="No chunks" description="This document produced no indexable chunks." icon={FileText} />
              ) : (
                <>
                  {data.chunks.slice(0, 60).map((chunk) => (
                    <div key={chunk.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-500">
                        <span className="font-mono text-brand-200/80">#{chunk.chunk_index + 1}</span>
                        {chunk.section_header && (
                          <span className="truncate font-medium text-slate-400">{chunk.section_header}</span>
                        )}
                        <span className="ml-auto font-mono">
                          p.{chunk.page_start}
                          {chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : ""} · {formatNumber(chunk.char_count)} chars
                        </span>
                      </div>
                      <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
                        {chunk.text}
                      </p>
                    </div>
                  ))}
                  {data.chunks.length > 60 && (
                    <p className="text-center text-[11px] text-slate-500">
                      Showing the first 60 of {formatNumber(data.chunks.length)} chunks.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "text" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {formatNumber(data.raw_text.length)} characters extracted
                  {data.raw_text.length > 50_000 ? " · preview truncated to 50,000" : ""}
                </span>
                <CopyButton value={data.raw_text} label="Copy full text" />
              </div>
              <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-ink-950/70 p-4 font-mono text-[11px] leading-relaxed text-slate-400">
                {data.raw_text.slice(0, 50_000) || "No extractable text."}
              </pre>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export default function DocumentsPage() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const search = useDebounced(query);
  const [tlp, setTlp] = useState<TLPLevel | "">("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [status, setStatus] = useState<"PROCESSED" | "FAILED" | "">("");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyAction, setBusyAction] = useState<{ id: string; action: string } | null>(null);

  const { data, loading, error, reload } = useResource(
    () =>
      api.listDocuments({
        page,
        page_size: 20,
        q: search || undefined,
        tlp: tlp || undefined,
        source_type: sourceType || undefined,
        status: status || undefined,
      }),
    [page, search, tlp, sourceType, status],
  );

  useEffect(() => {
    setPage(1);
  }, [search, tlp, sourceType, status]);

  const totals = useMemo(() => {
    const items = data?.items ?? [];
    return {
      chunks: items.reduce((sum, item) => sum + item.chunk_count, 0),
      iocs: items.reduce((sum, item) => sum + item.ioc_count, 0),
    };
  }, [data]);

  const onUploaded = (response: DocumentUploadResponse) => {
    setUploadOpen(false);
    setPage(1);
    void reload();
    toast.push(
      "success",
      "Evidence ingested",
      `${response.document.title} · ${response.chunks_created} chunks · ${response.iocs_extracted} IOCs · ${response.mitre_candidates} ATT&CK candidates`,
    );
  };

  const runExtract = async (document: DocumentDetail | DocumentSummary) => {
    setBusyAction({ id: document.id, action: "extract" });
    try {
      const response = await api.extractDocumentIocs(document.id);
      toast.push(
        "success",
        "Indicators refreshed",
        `${response.created} new · ${response.updated} existing for ${document.title}`,
      );
      void reload();
    } catch (caught) {
      toast.push("error", "IOC extraction failed", errorMessage(caught));
    } finally {
      setBusyAction(null);
    }
  };

  const runMap = async (document: DocumentDetail | DocumentSummary) => {
    setBusyAction({ id: document.id, action: "map" });
    try {
      const response = await api.mapMitre({ document_id: document.id, replace_existing: true });
      toast.push(
        "success",
        "ATT&CK mapping complete",
        `${response.created} candidate techniques proposed for ${document.title}`,
      );
    } catch (caught) {
      toast.push("error", "ATT&CK mapping failed", errorMessage(caught));
    } finally {
      setBusyAction(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteDocument(deleteTarget.id);
      toast.push("success", "Document deleted", deleteTarget.title);
      setDeleteTarget(null);
      if (detailId === deleteTarget.id) setDetailId(null);
      void reload();
    } catch (caught) {
      toast.push("error", "Delete failed", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">Evidence corpus</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">CTI document repository</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every document is hashed, TLP-marked and split into section-aware chunks. Indicators and ATT&CK
            candidates are extracted at ingestion time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={14} className={cn(loading && "animate-spin")} /> Refresh
          </button>
          <button type="button" className="btn-primary" onClick={() => setUploadOpen(true)}>
            <Upload size={15} /> Upload CTI
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brand-400/20 bg-brand-400/10 text-brand-300">
            <FileText size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Documents</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(data?.total ?? 0)}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-violet/20 bg-signal-violet/10 text-signal-violet">
            <ShieldCheck size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Chunks on page</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(totals.chunks)}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-supported/20 bg-signal-supported/10 text-signal-supported">
            <Crosshair size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Indicators on page</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(totals.iocs)}</p>
          </div>
        </div>
      </div>

      <Panel dense>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, filename or provenance…"
              className="input pl-9"
            />
          </div>
          <select className="select w-auto min-w-[130px]" value={tlp} onChange={(event) => setTlp(event.target.value as TLPLevel | "")}>
            <option value="">All TLP</option>
            {TLP_OPTIONS.map((option) => (
              <option key={option} value={option}>
                TLP:{option}
              </option>
            ))}
          </select>
          <select
            className="select w-auto min-w-[140px]"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as SourceType | "")}
          >
            <option value="">All formats</option>
            {SOURCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            className="select w-auto min-w-[140px]"
            value={status}
            onChange={(event) => setStatus(event.target.value as "PROCESSED" | "FAILED" | "")}
          >
            <option value="">Any status</option>
            <option value="PROCESSED">Processed</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>

        {error && <div className="p-4"><ErrorBanner message={error} onRetry={() => void reload()} /></div>}
        {loading && !data ? (
          <LoadingBlock />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title={search || tlp || sourceType || status ? "No matching documents" : "No evidence ingested yet"}
            description={
              search || tlp || sourceType || status
                ? "Adjust or clear the filters to see more of the corpus."
                : "Upload a PDF, TXT or Markdown CTI report. Ingestion hashes, chunks, extracts IOCs and proposes ATT&CK techniques."
            }
            icon={FileText}
            action={
              <button type="button" className="btn-primary" onClick={() => setUploadOpen(true)}>
                <Upload size={15} /> Upload CTI
              </button>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-shell">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>TLP</th>
                    <th>Format</th>
                    <th>Authority</th>
                    <th>Chunks</th>
                    <th>IOCs</th>
                    <th>Status</th>
                    <th>Ingested</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((document) => (
                    <tr key={document.id} className="group">
                      <td className="max-w-[340px]">
                        <button
                          type="button"
                          className="block max-w-full text-left"
                          onClick={() => setDetailId(document.id)}
                        >
                          <span className="block truncate text-sm font-medium text-slate-200 group-hover:text-brand-100">
                            {document.title}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-slate-500">
                            {document.original_filename} · {formatBytes(document.size_bytes)} ·{" "}
                            {shortHash(document.sha256, 12)}
                          </span>
                        </button>
                      </td>
                      <td><TLPBadge tlp={document.tlp} /></td>
                      <td><span className="text-xs text-slate-400">{document.source_type}</span></td>
                      <td><span className="font-mono text-xs text-slate-400">{formatRatio(document.authority_score, 0)}</span></td>
                      <td><span className="font-mono text-xs text-slate-400">{formatNumber(document.chunk_count)}</span></td>
                      <td><span className="font-mono text-xs text-slate-400">{formatNumber(document.ioc_count)}</span></td>
                      <td><StatusBadge status={document.status} /></td>
                      <td><span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(document.created_at)}</span></td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn-ghost px-1.5 py-1"
                            title="Inspect document"
                            onClick={() => setDetailId(document.id)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-1.5 py-1"
                            title="Re-extract indicators"
                            disabled={busyAction?.id === document.id}
                            onClick={() => void runExtract(document)}
                          >
                            <ScanSearch size={14} className={cn(busyAction?.id === document.id && busyAction.action === "extract" && "animate-pulse")} />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-1.5 py-1"
                            title="Map ATT&CK techniques"
                            disabled={busyAction?.id === document.id}
                            onClick={() => void runMap(document)}
                          >
                            <Crosshair size={14} className={cn(busyAction?.id === document.id && busyAction.action === "map" && "animate-pulse")} />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-1.5 py-1 text-signal-contradicted/80 hover:text-signal-contradicted"
                            title="Delete document"
                            onClick={() => setDeleteTarget(document)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={setPage} />
          </>
        )}
      </Panel>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={onUploaded} />

      <DocumentDetailDialog
        documentId={detailId}
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        onExtract={(document) => void runExtract(document)}
        onMap={(document) => void runMap(document)}
        busyAction={busyAction}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete document?"
        subtitle="This removes the document, chunks and linked indicators. Audit records are retained."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={() => void confirmDelete()} disabled={deleting}>
              <Trash2 size={14} /> {deleting ? "Deleting…" : "Delete permanently"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          Delete <span className="font-medium text-slate-200">{deleteTarget?.title}</span>? Generated claims that
          referenced it will retain their evidence snapshots, but the source will no longer be retrievable.
        </p>
      </Modal>
    </div>
  );
}
