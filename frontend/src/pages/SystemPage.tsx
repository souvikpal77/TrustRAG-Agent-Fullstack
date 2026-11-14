import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  Database,
  Gauge,
  KeyRound,
  Layers,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useState } from "react";

import {
  Badge,
  CodeChip,
  CopyButton,
  ErrorBanner,
  InfoNote,
  JsonBlock,
  KeyValue,
  LoadingBlock,
  Panel,
  ProgressBar,
  useToast,
} from "../components/ui";
import { useResource } from "../hooks/useResource";
import { api } from "../lib/api";
import { cn, formatDateTime, formatNumber, formatRatio, formatScore } from "../lib/format";
import type { TrustWeights } from "../lib/types";

const ENDPOINTS: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; purpose: string }[] = [
  { method: "GET", path: "/api/health", purpose: "Liveness and database readiness" },
  { method: "GET", path: "/api/meta", purpose: "Non-secret runtime configuration" },
  { method: "POST", path: "/api/documents", purpose: "Upload and ingest PDF / TXT / Markdown" },
  { method: "GET", path: "/api/documents/{id}", purpose: "Document metadata and chunks" },
  { method: "POST", path: "/api/retrieval/search", purpose: "Hybrid BM25 + semantic retrieval" },
  { method: "POST", path: "/api/gemini/generate", purpose: "Grounded generation with trust scoring" },
  { method: "POST", path: "/api/gemini/verify-claims", purpose: "Atomic claim verification" },
  { method: "GET", path: "/api/gemini/generations", purpose: "Persisted generation history" },
  { method: "GET", path: "/api/trust/weights", purpose: "Default trust weights" },
  { method: "POST", path: "/api/trust/score", purpose: "Explainable weighted trust score" },
  { method: "GET", path: "/api/iocs", purpose: "Indicator repository listing" },
  { method: "POST", path: "/api/iocs/extract", purpose: "Ad-hoc IOC extraction and defanging" },
  { method: "GET", path: "/api/mitre/matrix", purpose: "ATT&CK enterprise matrix" },
  { method: "POST", path: "/api/mitre/map", purpose: "Document-to-technique candidate mapping" },
  { method: "PATCH", path: "/api/mitre/candidates/{id}", purpose: "Analyst approve / reject decision" },
  { method: "GET", path: "/api/audit/logs", purpose: "Immutable audit log" },
  { method: "GET", path: "/api/audit/verify", purpose: "SHA-256 hash-chain verification" },
  { method: "POST", path: "/api/evaluation/run", purpose: "Three-way benchmark" },
  { method: "GET", path: "/api/dashboard", purpose: "SOC aggregate metrics" },
];

const METHOD_TONE: Record<string, string> = {
  GET: "border-signal-info/25 bg-signal-info/[0.08] text-signal-info",
  POST: "border-signal-supported/25 bg-signal-supported/[0.08] text-signal-supported",
  PATCH: "border-signal-review/25 bg-signal-review/[0.08] text-signal-review",
  DELETE: "border-signal-contradicted/25 bg-signal-contradicted/[0.08] text-signal-contradicted",
};

export default function SystemPage() {
  const toast = useToast();
  const [showRaw, setShowRaw] = useState(false);
  const health = useResource(() => api.health(), []);
  const meta = useResource(() => api.meta(), []);

  const geminiReady = health.data?.gemini_configured ?? false;
  const offline = health.data?.offline_fallback ?? false;
  const weights: TrustWeights | null = meta.data?.trust.weights ?? null;
  const weightEntries = weights
    ? (Object.entries(weights) as [keyof TrustWeights, number][])
    : [];

  const copyBase = async () => {
    try {
      await navigator.clipboard.writeText(api.baseUrl || window.location.origin);
      toast.push("success", "API base copied", api.baseUrl || window.location.origin);
    } catch {
      toast.push("error", "Clipboard unavailable", "Copy the URL manually.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/80">System</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Runtime health and configuration</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Non-secret runtime state exposed by the backend. API keys, database credentials and embedding secrets
            are never returned to the browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void health.reload();
              void meta.reload();
            }}
          >
            <RefreshCw size={14} className={cn((health.loading || meta.loading) && "animate-spin")} /> Refresh
          </button>
          <button type="button" className="btn-ghost px-2.5 py-2 text-xs" onClick={() => void copyBase()}>
            <CopyButton value={api.baseUrl || window.location.origin} label="API base" />
          </button>
        </div>
      </div>

      {(health.error || meta.error) && (
        <ErrorBanner
          message={health.error ?? meta.error ?? "Unknown error"}
          onRetry={() => {
            void health.reload();
            void meta.reload();
          }}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel flex items-center gap-3 p-4">
          <span className={cn("grid h-9 w-9 place-items-center rounded-lg border", health.data?.status === "ok" ? "border-signal-supported/20 bg-signal-supported/10 text-signal-supported" : "border-signal-review/20 bg-signal-review/10 text-signal-review")}>
            <Activity size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">API status</p>
            <p className="text-sm font-semibold text-slate-100">{health.data?.status ?? "unreachable"}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brand-400/20 bg-brand-400/10 text-brand-300">
            <Database size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">PostgreSQL</p>
            <p className="text-sm font-semibold text-slate-100">{health.data?.database ?? "unknown"}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className={cn("grid h-9 w-9 place-items-center rounded-lg border", geminiReady ? "border-signal-supported/20 bg-signal-supported/10 text-signal-supported" : "border-signal-review/20 bg-signal-review/10 text-signal-review")}>
            <KeyRound size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Gemini</p>
            <p className="text-sm font-semibold text-slate-100">{geminiReady ? "Configured server-side" : "Not configured"}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-violet/20 bg-signal-violet/10 text-signal-violet">
            <Server size={17} />
          </span>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-500">Environment</p>
            <p className="text-sm font-semibold text-slate-100">{health.data?.environment ?? "unknown"}</p>
          </div>
        </div>
      </div>

      {!geminiReady && (
        <InfoNote tone="warning" icon={AlertTriangle}>
          <span className="font-semibold">No Gemini API key is configured on the server.</span> Generation runs in
          clearly labelled degraded extractive mode, and the standalone evaluation baseline is unavailable. Set{" "}
          <code className="font-mono">GOOGLE_API_KEY</code> on the backend and restart to enable live model calls.
        </InfoNote>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Runtime configuration" subtitle="Effective chunking, retrieval and embedding settings" icon={Settings}>
          {meta.loading && !meta.data ? (
            <LoadingBlock />
          ) : meta.data ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4">
                <KeyValue label="Application">{meta.data.app_name}</KeyValue>
                <KeyValue label="Version">{meta.data.version}</KeyValue>
                <KeyValue label="Embeddings">{meta.data.embedding_provider}</KeyValue>
                <KeyValue label="ATT&CK techniques">{formatNumber(meta.data.mitre_techniques)}</KeyValue>
                <KeyValue label="Chunk size">{formatNumber(meta.data.chunking.chunk_size)} chars</KeyValue>
                <KeyValue label="Chunk overlap">{formatNumber(meta.data.chunking.chunk_overlap)} chars</KeyValue>
                <KeyValue label="Minimum chunk">{formatNumber(meta.data.chunking.min_chunk_size)} chars</KeyValue>
                <KeyValue label="Default top K">{formatNumber(meta.data.retrieval.default_top_k)}</KeyValue>
                <KeyValue label="BM25 k1">{meta.data.retrieval.bm25_k1.toFixed(2)}</KeyValue>
                <KeyValue label="BM25 b">{meta.data.retrieval.bm25_b.toFixed(2)}</KeyValue>
              </dl>

              <div>
                <p className="label">Gemini fallback chain</p>
                <div className="flex flex-wrap gap-1.5">
                  {meta.data.gemini_models.length === 0 ? (
                    <span className="text-xs text-slate-500">No models configured.</span>
                  ) : (
                    meta.data.gemini_models.map((modelName, index) => (
                      <span key={modelName} className="chip px-2 py-1 font-mono text-[10.5px]">
                        <span className="text-slate-600">{index + 1}</span> {modelName}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
                Embedding provider <span className="font-mono text-slate-300">{meta.data.embedding_provider}</span>.
                The offline feature-hashing embedder keeps ingestion fully local; Gemini embeddings are optional.
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel title="Trust defaults" subtitle="Weights and abstention thresholds applied to new generations" icon={Gauge}>
          {meta.loading && !meta.data ? (
            <LoadingBlock />
          ) : meta.data ? (
            <div className="space-y-4">
              <div className="space-y-3">
                {weightEntries.map(([key, value]) => (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="capitalize text-slate-400">{key.replace("_", " ")}</span>
                      <span className="font-mono text-slate-500">{formatRatio(value, 0)}</span>
                    </div>
                    <ProgressBar value={value} height={4} />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-3">
                <div>
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-600">Abstain below</p>
                  <p className="mt-0.5 font-mono text-sm text-signal-contradicted">{formatScore(meta.data.trust.abstain_threshold)}</p>
                </div>
                <div>
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-600">Review below</p>
                  <p className="mt-0.5 font-mono text-sm text-signal-review">{formatScore(meta.data.trust.review_threshold)}</p>
                </div>
                <div>
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-600">Support threshold</p>
                  <p className="mt-0.5 font-mono text-sm text-signal-supported">{meta.data.trust.support_threshold.toFixed(2)}</p>
                </div>
              </div>

              <InfoNote icon={ShieldCheck}>
                Support is only granted above the entailment threshold. Moving the trust weights in the Ask view
                changes explanations for that answer; server defaults remain authoritative for persisted runs.
              </InfoNote>
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel title="API surface" subtitle="REST endpoints exposed by the backend" icon={Terminal} dense>
          <div className="max-h-[460px] overflow-y-auto">
            <table className="table-shell">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map((endpoint) => (
                  <tr key={`${endpoint.method}-${endpoint.path}`}>
                    <td>
                      <Badge className={METHOD_TONE[endpoint.method]}>{endpoint.method}</Badge>
                    </td>
                    <td><code className="font-mono text-[10.5px] text-slate-300">{endpoint.path}</code></td>
                    <td><span className="text-[11px] text-slate-500">{endpoint.purpose}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Security posture" subtitle="Production assumptions and controls" icon={ShieldCheck}>
            <div className="space-y-3 text-[11px] leading-relaxed text-slate-500">
              <div className="flex items-start gap-2">
                <KeyRound size={13} className="mt-0.5 shrink-0 text-brand-300" />
                <p>Secrets stay server-side. The browser only ever sees this non-secret runtime metadata.</p>
              </div>
              <div className="flex items-start gap-2">
                <Layers size={13} className="mt-0.5 shrink-0 text-brand-300" />
                <p>Evidence reaches the model inside strict delimiters and is scanned for injection patterns first.</p>
              </div>
              <div className="flex items-start gap-2">
                <Cpu size={13} className="mt-0.5 shrink-0 text-brand-300" />
                <p>Answers are rejected from trusted status when evidence is missing, regardless of model confidence.</p>
              </div>
              <div className="flex items-start gap-2">
                <Database size={13} className="mt-0.5 shrink-0 text-brand-300" />
                <p>Audit rows are append-only and hash-chained. Restrict direct database write access to the app role.</p>
              </div>
              <div className="rounded-lg border border-signal-review/20 bg-signal-review/[0.05] p-3 text-signal-review">
                <span className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={12} /> Deployment note</span>
                <p className="mt-1 text-[10.5px] leading-relaxed">
                  <code className="font-mono">X-Actor</code> is an attribution label, not authentication. Put an SSO
                  proxy in front of the API and forward the verified principal.
                </p>
              </div>
            </div>
          </Panel>

          <Panel
            title="Diagnostics"
            subtitle="Snapshot details for support and incident response"
            icon={Activity}
            actions={
              <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => setShowRaw((value) => !value)}>
                {showRaw ? "Hide raw" : "Show raw"}
              </button>
            }
          >
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-3">
                <KeyValue label="API base"><span className="break-all font-mono text-[11px]">{api.baseUrl || window.location.origin}</span></KeyValue>
                <KeyValue label="Offline fallback">{offline ? "Enabled" : "Disabled"}</KeyValue>
                <KeyValue label="Health checked">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <Clock size={11} /> {formatDateTime(new Date().toISOString())}
                  </span>
                </KeyValue>
                <KeyValue label="Build mode">{import.meta.env.MODE}</KeyValue>
              </dl>
              {showRaw && meta.data && <JsonBlock value={meta.data} />}
              <div className="flex flex-wrap gap-2">
                <Badge className="border-white/10 bg-white/[0.04] text-slate-400">React + Vite</Badge>
                <Badge className="border-white/10 bg-white/[0.04] text-slate-400">FastAPI</Badge>
                <Badge className="border-white/10 bg-white/[0.04] text-slate-400">PostgreSQL</Badge>
                <Badge className="border-white/10 bg-white/[0.04] text-slate-400">google-genai</Badge>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[10.5px] text-slate-600">
        <span className="flex items-center gap-1.5">
          <CodeChip>TrustRAG-Agent</CodeChip> evidence-grounded CTI analysis
        </span>
        <span>
          {meta.data ? `${meta.data.app_name} v${meta.data.version}` : "runtime metadata unavailable"} ·{" "}
          {meta.data ? `${formatNumber(meta.data.mitre_techniques)} ATT&CK techniques seeded` : "catalogue unknown"}
        </span>
      </div>
    </div>
  );
}
