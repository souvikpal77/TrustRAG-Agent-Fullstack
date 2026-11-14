import { ArrowLeft, Compass, LayoutDashboard, SearchX } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { EmptyState, Panel } from "../components/ui";

const SUGGESTIONS = [
  { to: "/", label: "SOC Dashboard", hint: "Trust posture and recent activity" },
  { to: "/documents", label: "CTI Corpus", hint: "Ingest and govern evidence" },
  { to: "/ask", label: "Ask TrustRAG", hint: "Grounded answers with citations" },
  { to: "/evaluation", label: "Evaluation Centre", hint: "Compare grounding strategies" },
];

export default function NotFoundPage() {
  const location = useLocation();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Panel title="View not found" icon={Compass}>
        <EmptyState
          icon={SearchX}
          title="This route is not part of the analyst workspace"
          description={`No page is registered for "${location.pathname}". Check the address, or jump back into one of the operational views below.`}
          action={
            <Link to="/" className="btn-primary">
              <LayoutDashboard size={15} />
              Return to dashboard
            </Link>
          }
        />
      </Panel>

      <Panel title="Suggested workspaces" icon={Compass}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 transition hover:border-brand-400/25 hover:bg-brand-400/[0.06]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-200">{item.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{item.hint}</span>
                </span>
                <ArrowLeft
                  size={15}
                  className="shrink-0 rotate-180 text-slate-600 transition group-hover:text-brand-300"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
