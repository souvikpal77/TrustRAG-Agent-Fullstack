import {
  Crosshair,
  FileText,
  Filter,
  Fingerprint,
  Network,
  RefreshCw,
  ScanText,
} from "lucide-react";
import { useEffect, useState } from "react";

import { IOCBadge } from "../components/badges";
import { DonutChart } from "../components/charts";
import {
  Badge,
  CodeChip,
  CopyButton,
  EmptyState,
  ErrorBanner,
  Field,
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
import {
  cn,
  formatDateTime,
  formatNumber,
  formatRatio,
  truncate,
} from "../lib/format";
import { CHART_PALETTE } from "../lib/ui";
import type { ExtractedIOC, IOCType, IOCOut } from "../lib/types";

const IOC_TYPES: IOCType[] = ["IPV4", "DOMAIN", "URL", "SHA256", "SHA1", "MD5"];

const IOC_COLORS: Record<string, string> = {
  IPV4: "#22d3ee",
  DOMAIN: "#a78bfa",
  URL: "#60a5fa",
  SHA256: "#34d399",
  SHA1: "#fbbf24",
  MD5: "#fb7185",
};

export default function IOCsPage() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const search = useDebounced(query);
  const [type, setType] = useState<IOCType | "">("");
  const [documentId, setDocumentId] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<IOCOut | null>(null);

  const [extractText, setExtractText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedIOC[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);

  const list = useResource(
    () =>
      api.listIocs({
        page,
        page_size: 25,
        type: type || undefined,
        q: search || undefined,
        document_id: documentId || undefined,
      }),
    [page, search, type, documentId],
  );
  const documents = useResource(() => api.listDocuments({ page: 1, page_size: 100 }), []);

  useEffect(() => {
    setPage(1);
  }, [search, type, documentId]);

  const stats = list.data?.stats;
  const segments = IOC_TYPES.map((iocType, index) => ({
    label: iocType,
    value: stats?.by_type[iocType] ?? 0,
    color: IOC_COLORS[iocType] ?? CHART_PALETTE[index % CHART_PALETTE.length],
  })).filter((segment) => segment.value > 0);

  const runExtract = async () => {
    if (extractText.trim().length < 4) {
      setExtractError("Paste at least a few characters of CTI text to extract indicators.");
      return;
    }
    setExtracting(true);
    setExtractError(null);
    try {
      const response = await api.extractIocs(extractText);
      setExtracted(response.items);
      toast.push("success", "Extraction complete", `${response.count} unique indicators found`);
    } catch (caught) {
      setExtractError(errorMessage(caught));
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">Tradecraft</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Indicator repository</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            IPv4, domain, URL and file hash indicators are extracted from every chunk, deduplicated and stored
            defanged for safe handling in reports and chat.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void list.reload()} disabled={list.loading}>
          <RefreshCw size={14} className={cn(list.loading && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brand-400/20 bg-brand-400/10 text-brand-300">
            <Crosshair size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Total indicators</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(stats?.total ?? 0)}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-violet/20 bg-signal-violet/10 text-signal-violet">
            <FileText size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Documents represented</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(stats?.documents_with_iocs ?? 0)}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-supported/20 bg-signal-supported/10 text-signal-supported">
            <Fingerprint size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">IOC types</p>
            <p className="text-lg font-semibold text-slate-100">{formatNumber(segments.length)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="Indicator mix" subtitle="Distribution across stored IOC types" icon={Network}>
            {segments.length === 0 ? (
              <EmptyState title="No indicators stored" description="Upload a report containing network or file indicators." icon={Crosshair} />
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <DonutChart
                    segments={segments}
                    centerLabel="IOCs"
                    centerValue={formatNumber(stats?.total ?? 0)}
                    size={168}
                  />
                </div>
                <div className="space-y-2">
                  {segments.map((segment) => (
                    <div key={segment.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 text-slate-400">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                        {segment.label}
                      </span>
                      <span className="font-mono text-slate-400">
                        {formatNumber(segment.value)}
                        <span className="ml-2 text-slate-600">
                          {formatRatio((stats?.total ?? 0) > 0 ? segment.value / (stats?.total ?? 1) : 0, 0)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Ad-hoc extractor" subtitle="Test the defanging and extraction pipeline without persisting" icon={ScanText}>
            <div className="space-y-3">
              <Field label="CTI text" hint="Paste indicators or a report excerpt. Extraction is entirely local.">
                <textarea
                  className="textarea min-h-[130px] font-mono text-[11px]"
                  value={extractText}
                  onChange={(event) => setExtractText(event.target.value)}
                  placeholder={"C2 at 185.220.101.45\nbeacon.evil-example[.]com\nhttps://evil.example/payload.exe\nSHA256 9f2c...e1"}
                />
              </Field>
              <button type="button" className="btn-primary w-full" onClick={() => void runExtract()} disabled={extracting}>
                <ScanText size={15} className={cn(extracting && "animate-pulse")} />
                {extracting ? "Extracting…" : "Extract indicators"}
              </button>
              {extractError && <ErrorBanner message={extractError} />}
              {extracted.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {extracted.length} indicators
                    </span>
                    <CopyButton value={extracted.map((item) => item.defanged).join("\n")} label="Copy all" />
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {extracted.map((item) => (
                      <div key={`${item.ioc_type}-${item.normalized_value}`} className="flex items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[11px] text-slate-300">{item.defanged}</p>
                          <p className="mt-0.5 text-[10px] text-slate-600">
                            {item.ioc_type} · {formatRatio(item.confidence, 0)} confidence
                          </p>
                        </div>
                        <CopyButton value={item.defanged} label="" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>

        <Panel dense>
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="relative min-w-[180px] flex-1">
              <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search indicator, context or document…"
                className="input pl-9"
              />
            </div>
            <select className="select w-auto min-w-[130px]" value={type} onChange={(event) => setType(event.target.value as IOCType | "")}>
              <option value="">All types</option>
              {IOC_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select className="select w-auto min-w-[180px]" value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
              <option value="">All documents</option>
              {(documents.data?.items ?? []).map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </div>

          {list.error && <div className="p-4"><ErrorBanner message={list.error} onRetry={() => void list.reload()} /></div>}
          {list.loading && !list.data ? (
            <LoadingBlock />
          ) : !list.data || list.data.items.length === 0 ? (
            <EmptyState
              title={search || type || documentId ? "No matching indicators" : "No indicators yet"}
              description={
                search || type || documentId
                  ? "Try clearing the type or document filter."
                  : "Indicators are extracted automatically when you ingest CTI, or on demand from the corpus view."
              }
              icon={Crosshair}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table-shell">
                  <thead>
                    <tr>
                      <th>Indicator</th>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Confidence</th>
                      <th>Context</th>
                      <th>First seen</th>
                      <th className="text-right">Copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((ioc) => (
                      <tr key={ioc.id}>
                        <td className="max-w-[280px]">
                          <button type="button" className="block max-w-full text-left" onClick={() => setDetail(ioc)}>
                            <code className="block truncate font-mono text-[11.5px] text-brand-200 group-hover:underline">
                              {ioc.defanged}
                            </code>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-600">
                              {ioc.normalized_value}
                            </span>
                          </button>
                        </td>
                        <td><IOCBadge type={ioc.ioc_type} /></td>
                        <td>
                          <span className="block max-w-[180px] truncate text-xs text-slate-400" title={ioc.document_title ?? undefined}>
                            {ioc.document_title ?? "Ad-hoc"}
                          </span>
                        </td>
                        <td className="min-w-[110px]">
                          <div className="flex items-center gap-2">
                            <ProgressBar value={ioc.confidence} height={4} className="w-16" />
                            <span className="font-mono text-[10.5px] text-slate-500">{formatRatio(ioc.confidence, 0)}</span>
                          </div>
                        </td>
                        <td className="max-w-[220px]">
                          <span className="block truncate text-[11px] text-slate-500" title={ioc.context}>
                            {truncate(ioc.context, 70)}
                          </span>
                        </td>
                        <td><span className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(ioc.created_at)}</span></td>
                        <td className="text-right"><CopyButton value={ioc.defanged} label="" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPageChange={setPage} />
            </>
          )}
        </Panel>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="Indicator detail"
        subtitle={detail ? `${detail.ioc_type} · first seen ${formatDateTime(detail.created_at)}` : undefined}
        size="md"
        footer={<button type="button" className="btn-secondary" onClick={() => setDetail(null)}>Close</button>}
      >
        {detail && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.06] bg-ink-950/50 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <IOCBadge type={detail.ioc_type} />
                <CopyButton value={detail.defanged} label="Copy defanged" />
              </div>
              <code className="block break-all font-mono text-sm text-brand-200">{detail.defanged}</code>
              <code className="mt-1 block break-all font-mono text-[10.5px] text-slate-600">{detail.normalized_value}</code>
            </div>

            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Confidence">
                <div className="flex items-center gap-2">
                  <ProgressBar value={detail.confidence} height={5} className="w-20" />
                  <span className="font-mono text-xs">{formatRatio(detail.confidence, 0)}</span>
                </div>
              </KeyValue>
              <KeyValue label="Source document">{detail.document_title ?? "Ad-hoc extraction"}</KeyValue>
            </dl>

            <div>
              <p className="label">Extraction context</p>
              <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-slate-400">
                {detail.context || "No surrounding context was captured."}
              </p>
            </div>

            <div>
              <p className="label">Raw value</p>
              <div className="flex items-center gap-2">
                <CodeChip className="break-all">{detail.value}</CodeChip>
                <CopyButton value={detail.value} label="Copy raw" />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Store and share the defanged form. Only re-fang values inside an isolated analysis environment.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
