import {
  Eye,
  Filter,
  Link2,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  Badge,
  CopyButton,
  EmptyState,
  ErrorBanner,
  KeyValue,
  JsonBlock,
  LoadingBlock,
  Modal,
  Pagination,
  Panel,
  useToast,
} from "../components/ui";
import { useDebounced, useResource } from "../hooks/useResource";
import { api } from "../lib/api";
import { cn, formatDateTime, formatNumber, shortHash } from "../lib/format";
import type { AuditLogOut } from "../lib/types";

export default function AuditPage() {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [actionInput, setActionInput] = useState("");
  const [entityTypeInput, setEntityTypeInput] = useState("");
  const [entityIdInput, setEntityIdInput] = useState("");
  const action = useDebounced(actionInput, 350);
  const entityType = useDebounced(entityTypeInput, 350);
  const entityId = useDebounced(entityIdInput, 350);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogOut | null>(null);

  const verify = useResource(() => api.verifyAudit(), [version]);
  const logs = useResource(
    () =>
      api.listAudit({
        page,
        page_size: 25,
        action: action || undefined,
        entity_type: entityType || undefined,
        entity_id: entityId || undefined,
      }),
    [page, action, entityType, entityId, version],
  );

  useEffect(() => {
    setPage(1);
  }, [action, entityType, entityId]);

  const refresh = () => {
    setVersion((value) => value + 1);
  };

  const copyHead = async () => {
    if (!verify.data?.head_hash) return;
    try {
      await navigator.clipboard.writeText(verify.data.head_hash);
      toast.push("success", "Head hash copied", "Use it to pin the current chain state externally.");
    } catch {
      toast.push("error", "Clipboard unavailable", "Select the hash manually and copy it.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">Assurance</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Immutable audit chain</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Every ingestion, generation, verification and analyst decision is appended with a SHA-256 hash of the
            previous entry. Tampering with history breaks verification.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={refresh}>
          <RefreshCw size={14} className={cn((verify.loading || logs.loading) && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel
          title="Chain integrity"
          subtitle="Recomputed from the genesis entry forward"
          icon={ShieldCheck}
          actions={
            <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={refresh} disabled={verify.loading}>
              <RefreshCw size={12} className={cn(verify.loading && "animate-spin")} /> Verify now
            </button>
          }
        >
          {verify.loading && !verify.data ? (
            <LoadingBlock label="Recomputing hash chain…" />
          ) : verify.error ? (
            <ErrorBanner message={verify.error} onRetry={() => void verify.reload()} />
          ) : verify.data ? (
            <div className="space-y-4">
              <div
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4",
                  verify.data.valid
                    ? "border-signal-supported/25 bg-signal-supported/[0.06]"
                    : "border-signal-contradicted/25 bg-signal-contradicted/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl border",
                    verify.data.valid
                      ? "border-signal-supported/25 bg-signal-supported/10 text-signal-supported"
                      : "border-signal-contradicted/25 bg-signal-contradicted/10 text-signal-contradicted",
                  )}
                >
                  {verify.data.valid ? <ShieldCheck size={19} /> : <ShieldAlert size={19} />}
                </span>
                <div>
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      verify.data.valid ? "text-signal-supported" : "text-signal-contradicted",
                    )}
                  >
                    {verify.data.valid ? "Chain verified" : "Chain integrity failure"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{verify.data.message}</p>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-4">
                <KeyValue label="Entries verified">{formatNumber(verify.data.entries)}</KeyValue>
                <KeyValue label="Broken at">
                  {verify.data.broken_at != null ? (
                    <span className="text-signal-contradicted">#{verify.data.broken_at}</span>
                  ) : (
                    "No breaks"
                  )}
                </KeyValue>
              </dl>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="label mb-0">Head hash</p>
                  {verify.data.head_hash && <CopyButton value={verify.data.head_hash} label="Copy" />}
                </div>
                <code className="block break-all rounded-lg border border-white/[0.07] bg-ink-950/60 px-3 py-2 font-mono text-[10.5px] text-slate-400">
                  {verify.data.head_hash ?? "No entries yet"}
                </code>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
                  Pin the head hash in an external system before exporting evidence. A later chain must start from
                  this digest.
                </p>
              </div>

              <button type="button" className="btn-secondary w-full" onClick={() => void copyHead()} disabled={!verify.data.head_hash}>
                <Link2 size={14} /> Copy head hash for external pinning
              </button>
            </div>
          ) : null}
        </Panel>

        <Panel title="How the chain works" subtitle="Append-only by construction" icon={Link2}>
          <div className="space-y-3 text-[11px] leading-relaxed text-slate-500">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="mb-1 font-semibold text-slate-300">Entry hash</p>
              <p>
                <code className="font-mono text-brand-200/80">SHA-256(prev_hash + canonical_json(payload))</code>
              </p>
            </div>
            <p>
              A PostgreSQL advisory lock serialises appends so concurrent requests cannot fork the chain. Rows are
              never updated or deleted by the application.
            </p>
            <p>
              The verifier recalculates every digest from genesis to head. A modified summary, actor or details
              payload will fail at the exact entry where trust was broken.
            </p>
            <div className="rounded-lg border border-signal-review/20 bg-signal-review/[0.05] p-3 text-signal-review">
              Auditing is an integrity control, not authentication. Terminate TLS at the edge, forward an
              authenticated principal in <code className="font-mono">X-Actor</code>, and restrict database access.
            </div>
          </div>
        </Panel>
      </div>

      <Panel dense>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="input pl-9"
              value={actionInput}
              onChange={(event) => setActionInput(event.target.value)}
              placeholder="Filter by action (e.g. gemini.generated)…"
            />
          </div>
          <input
            className="input w-auto min-w-[170px]"
            value={entityTypeInput}
            onChange={(event) => setEntityTypeInput(event.target.value)}
            placeholder="Entity type"
          />
          <input
            className="input w-auto min-w-[190px]"
            value={entityIdInput}
            onChange={(event) => setEntityIdInput(event.target.value)}
            placeholder="Entity ID"
          />
          {(actionInput || entityTypeInput || entityIdInput) && (
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => {
                setActionInput("");
                setEntityTypeInput("");
                setEntityIdInput("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        {logs.error && <div className="p-4"><ErrorBanner message={logs.error} onRetry={() => void logs.reload()} /></div>}
        {logs.loading && !logs.data ? (
          <LoadingBlock />
        ) : !logs.data || logs.data.items.length === 0 ? (
          <EmptyState
            title={action || entityType || entityId ? "No matching audit events" : "No audit entries yet"}
            description="Ingest evidence or run a generation to start the hash chain."
            icon={ScrollText}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-shell">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Summary</th>
                    <th>Entry hash</th>
                    <th>Time</th>
                    <th className="text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.items.map((entry) => (
                    <tr key={entry.id}>
                      <td><span className="font-mono text-[10.5px] text-slate-500">{entry.id}</span></td>
                      <td><span className="font-mono text-[11px] text-slate-300">{entry.actor}</span></td>
                      <td>
                        <Badge className="border-brand-400/20 bg-brand-400/[0.08] text-brand-200">{entry.action}</Badge>
                      </td>
                      <td>
                        <span className="text-[11px] text-slate-400">{entry.entity_type}</span>
                        {entry.entity_id && (
                          <span className="mt-0.5 block truncate font-mono text-[9.5px] text-slate-600" title={entry.entity_id}>
                            {shortHash(entry.entity_id, 10)}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[280px]">
                        <span className="block truncate text-[11px] text-slate-400" title={entry.summary}>
                          {entry.summary}
                        </span>
                      </td>
                      <td>
                        <code className="font-mono text-[10px] text-slate-500" title={entry.entry_hash}>
                          {shortHash(entry.entry_hash, 14)}
                        </code>
                      </td>
                      <td><span className="whitespace-nowrap text-[10.5px] text-slate-500">{formatDateTime(entry.created_at)}</span></td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost px-1.5 py-1" title="Inspect audit entry" onClick={() => setDetail(entry)}>
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={logs.data.page} pageSize={logs.data.page_size} total={logs.data.total} onPageChange={setPage} />
          </>
        )}
      </Panel>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Audit entry #${detail.id}` : "Audit entry"}
        subtitle={detail ? `${detail.action} · ${formatDateTime(detail.created_at)}` : undefined}
        size="lg"
        footer={<button type="button" className="btn-secondary" onClick={() => setDetail(null)}>Close</button>}
      >
        {detail && (
          <div className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <KeyValue label="Actor"><span className="font-mono text-xs">{detail.actor}</span></KeyValue>
              <KeyValue label="Action"><span className="font-mono text-xs">{detail.action}</span></KeyValue>
              <KeyValue label="Entity type">{detail.entity_type}</KeyValue>
              <KeyValue label="Entity ID"><span className="break-all font-mono text-[11px]">{detail.entity_id ?? "—"}</span></KeyValue>
            </dl>

            <div>
              <p className="label">Summary</p>
              <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-slate-300">
                {detail.summary}
              </p>
            </div>

            <div className="space-y-2">
              <p className="label mb-0">Hash links</p>
              <div className="rounded-lg border border-white/[0.06] bg-ink-950/50 p-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-600">Previous hash</p>
                <code className="mt-1 block break-all font-mono text-[10.5px] text-slate-400">{detail.prev_hash}</code>
                <div className="my-2 h-px bg-white/[0.06]" />
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-600">Entry hash</p>
                <code className="mt-1 block break-all font-mono text-[10.5px] text-brand-200/80">{detail.entry_hash}</code>
              </div>
            </div>

            <div>
              <p className="label">Payload</p>
              <JsonBlock value={detail.details} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
