import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import Layout from "./components/Layout";
import { ToastProvider } from "./components/ui";
import AskPage from "./pages/AskPage";
import AuditPage from "./pages/AuditPage";
import DashboardPage from "./pages/DashboardPage";
import DocumentsPage from "./pages/DocumentsPage";
import EvaluationPage from "./pages/EvaluationPage";
import IOCsPage from "./pages/IOCsPage";
import MitrePage from "./pages/MitrePage";
import NotFoundPage from "./pages/NotFoundPage";
import RetrievalPage from "./pages/RetrievalPage";
import SystemPage from "./pages/SystemPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the component stack in the browser console for local triage only.
    console.error("TrustRAG UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 px-6 text-center">
        <div className="panel max-w-lg p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-signal-contradicted">
            Interface fault
          </p>
          <h1 className="mt-3 text-xl font-semibold text-slate-100">Something broke while rendering this view</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The analyst workspace could not recover automatically. Reload the page to restore the last known state.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-white/[0.06] bg-ink-950/70 p-3 text-left font-mono text-[11px] text-slate-500">
            {this.state.error.message}
          </pre>
          <button type="button" className="btn-primary mt-5" onClick={() => window.location.reload()}>
            Reload workspace
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ScrollToTop />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="retrieval" element={<RetrievalPage />} />
            <Route path="ask" element={<AskPage />} />
            <Route path="iocs" element={<IOCsPage />} />
            <Route path="mitre" element={<MitrePage />} />
            <Route path="evaluation" element={<EvaluationPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="system" element={<SystemPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </ErrorBoundary>
  );
}
