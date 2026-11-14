import {
  Activity,
  BookOpenCheck,
  Crosshair,
  FileText,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Menu,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { api, getActor, setActor } from "../lib/api";
import { cn } from "../lib/format";
import type { HealthResponse } from "../lib/types";
import { Badge } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      {
        to: "/",
        label: "SOC Dashboard",
        icon: LayoutDashboard,
        description: "Evidence coverage, trust posture and recent activity",
        end: true,
      },
      {
        to: "/documents",
        label: "CTI Corpus",
        icon: FileText,
        description: "Ingest, inspect and govern evidence documents",
      },
      {
        to: "/retrieval",
        label: "Retrieval Lab",
        icon: Search,
        description: "Dual-vector hybrid search across the evidence corpus",
      },
      {
        to: "/ask",
        label: "Ask TrustRAG",
        icon: Sparkles,
        description: "Generate, verify and trust-score grounded answers",
      },
    ],
  },
  {
    label: "Tradecraft",
    items: [
      {
        to: "/iocs",
        label: "Indicators",
        icon: Crosshair,
        description: "Defanged IOCs extracted from the CTI corpus",
      },
      {
        to: "/mitre",
        label: "ATT&CK Mapping",
        icon: ShieldCheck,
        description: "Candidate techniques with analyst validation",
      },
    ],
  },
  {
    label: "Assurance",
    items: [
      {
        to: "/evaluation",
        label: "Evaluation Centre",
        icon: FlaskConical,
        description: "Standalone LLM vs Standard RAG vs TrustRAG-Agent",
      },
      {
        to: "/audit",
        label: "Audit Chain",
        icon: ScrollText,
        description: "Append-only, hash-chained analyst activity",
      },
      {
        to: "/system",
        label: "System",
        icon: Settings,
        description: "Runtime health, configuration and limits",
      },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function resolvePage(pathname: string): NavItem {
  const exact = ALL_ITEMS.find((item) => item.end && item.to === pathname);
  if (exact) return exact;
  const nested = [...ALL_ITEMS]
    .filter((item) => !item.end && item.to !== "/")
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname.startsWith(item.to));
  return (
    nested ?? {
      to: "/",
      label: "Not found",
      icon: BookOpenCheck,
      description: "The requested view does not exist",
    }
  );
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cn("nav-link", isActive && "nav-link-active")}
    >
      <Icon size={17} className="shrink-0 opacity-80" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid h-10 w-10 place-items-center rounded-xl border border-brand-400/25 bg-gradient-to-br from-brand-400/20 to-signal-violet/15 text-brand-200 shadow-glow">
        <ShieldCheck size={20} />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-signal-supported" />
      </span>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight text-slate-100">TrustRAG-Agent</p>
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Evidence-grounded CTI
          </p>
        </div>
      )}
    </div>
  );
}

const HEALTH_POLL_INTERVAL_MS = 30_000;
// When a check fails, confirm quickly instead of waiting a full poll interval.
const HEALTH_CONFIRM_RETRY_MS = 2_000;

function HealthPill({ health, reachable }: { health: HealthResponse | null; reachable: boolean | null }) {
  if (reachable === null) {
    return (
      <Badge className="border-white/10 bg-white/[0.03] text-slate-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
        Checking
      </Badge>
    );
  }
  if (!reachable) {
    return (
      <Badge className="border-signal-contradicted/30 bg-signal-contradicted/10 text-signal-contradicted">
        <WifiOff size={11} />
        API OFFLINE
      </Badge>
    );
  }
  const degraded = health?.status !== "ok" || health?.database !== "ok";
  return (
    <Badge
      className={cn(
        degraded
          ? "border-signal-review/30 bg-signal-review/10 text-signal-review"
          : "border-signal-supported/30 bg-signal-supported/10 text-signal-supported",
      )}
    >
      {degraded ? <WifiOff size={11} /> : <Wifi size={11} />}
      {degraded ? "Degraded" : "API ONLINE"}
    </Badge>
  );
}

export default function Layout() {
  const location = useLocation();
  const page = resolvePage(location.pathname);
  const PageIcon = page.icon;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [actor, setActorState] = useState(getActor());
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const failureCount = useRef(0);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let retryTimer: number | undefined;

    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api.health();
        if (cancelled) return;
        // A single good response restores the badge immediately.
        failureCount.current = 0;
        setHealth(next);
        setReachable(true);
      } catch {
        if (cancelled) return;
        failureCount.current += 1;
        // Require two consecutive failures so a hot reload, tab wake-up, or
        // brief network blip never flips the badge to offline.
        if (failureCount.current >= 2) {
          setReachable(false);
        } else {
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => void check(), HEALTH_CONFIRM_RETRY_MS);
        }
      } finally {
        inFlight = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), HEALTH_POLL_INTERVAL_MS);

    // Re-check as soon as the tab becomes visible or regains focus, so a
    // backgrounded tab never shows a stale offline badge.
    const recheckOnFocus = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", recheckOnFocus);
    window.addEventListener("focus", recheckOnFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", recheckOnFocus);
      window.removeEventListener("focus", recheckOnFocus);
    };
  }, []);

  const commitActor = (event: FormEvent) => {
    event.preventDefault();
    const next = actor.trim() || "analyst";
    setActor(next);
    setActorState(next);
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-5 pt-5">
        <BrandMark />
        <button
          type="button"
          className="btn-ghost px-1.5 py-1 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="scrollbar-none flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarLink key={item.to} item={item} onNavigate={() => setMobileOpen(false)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-3 border-t border-white/[0.06] p-4">
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <Activity size={12} /> {health?.version ?? "v1.0.0"}
          </span>
          <HealthPill health={health} reachable={reachable} />
        </div>

        <form onSubmit={commitActor} className="space-y-1.5">
          <label htmlFor="actor" className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            <UserRound size={11} /> Acting analyst
          </label>
          <div className="flex gap-1.5">
            <input
              id="actor"
              value={actor}
              onChange={(event) => setActorState(event.target.value)}
              maxLength={64}
              placeholder="analyst"
              className="input px-2.5 py-1.5 text-xs"
            />
            <button type="submit" className="btn-secondary px-2.5 py-1.5 text-[11px]">
              Set
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-600">
            Sent as <span className="font-mono text-slate-500">X-Actor</span> to attribute audit events.
          </p>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-white/[0.06] bg-ink-900/55 backdrop-blur-xl lg:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[278px] animate-fade-in border-r border-white/[0.08] bg-ink-900">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/75 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="btn-ghost -ml-1 px-2 py-1 lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={19} />
              </button>
              <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-brand-300 sm:grid">
                <PageIcon size={17} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-tight text-slate-100 sm:text-base">
                  {page.label}
                </h1>
                <p className="hidden truncate text-xs text-slate-500 sm:block">{page.description}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-400 md:flex">
                <Gauge size={12} className="text-brand-300" />
                {health?.environment ?? "environment"}
              </span>
              <span className="hidden items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-400 sm:flex">
                <span className="text-slate-600">actor</span>
                <span className="max-w-[120px] truncate font-mono text-slate-300">{actor || "analyst"}</span>
              </span>
              <HealthPill health={health} reachable={reachable} />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1480px]">
            <Outlet />
          </div>
        </main>

        <footer className="border-t border-white/[0.05] px-4 py-4 text-[11px] text-slate-600 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-2">
            <span>TrustRAG-Agent · evidence-grounded CTI with abstention-first trust scoring.</span>
            <span className="font-mono">
              {health?.gemini_configured ? "Gemini live" : "Gemini not configured"}
              {health?.offline_fallback ? " · offline fallback enabled" : ""}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
