import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn, copyText, formatNumber } from "../lib/format";

// --------------------------------------------------------------------- panel
export function Panel({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  dense,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}) {
  return (
    <section className={cn("panel", className)}>
      {(title || actions) && (
        <div className="panel-header">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-brand-300">
                <Icon size={16} />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="truncate text-sm font-semibold text-slate-100">{title}</h2>}
              {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(dense ? "p-0" : "panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}

// --------------------------------------------------------------------- badge
export function Badge({
  children,
  className,
  dot,
}: {
  children: ReactNode;
  className?: string;
  dot?: string;
}) {
  return (
    <span className={cn("badge", className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} />}
      {children}
    </span>
  );
}

export function CodeChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "rounded border border-white/[0.07] bg-ink-950/60 px-1.5 py-0.5 font-mono text-[11px] text-slate-300",
        className,
      )}
    >
      {children}
    </code>
  );
}

// ------------------------------------------------------------------- loading
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn("animate-spin", className)} />;
}

export function LoadingBlock({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-10 text-sm text-slate-500", className)}>
      <Spinner />
      {label}
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, colIndex) => (
            <div
              key={colIndex}
              className="skeleton h-5"
              style={{ width: `${60 + ((rowIndex * 7 + colIndex * 11) % 35)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------- empty
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-slate-500">
        <Icon size={22} />
      </div>
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ stat card
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "brand",
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "brand" | "success" | "warning" | "danger" | "violet" | "neutral";
  footer?: ReactNode;
}) {
  const tones: Record<string, string> = {
    brand: "text-brand-300 border-brand-400/20 bg-brand-400/10",
    success: "text-signal-supported border-signal-supported/20 bg-signal-supported/10",
    warning: "text-signal-review border-signal-review/20 bg-signal-review/10",
    danger: "text-signal-contradicted border-signal-contradicted/20 bg-signal-contradicted/10",
    violet: "text-signal-violet border-signal-violet/20 bg-signal-violet/10",
    neutral: "text-slate-300 border-white/10 bg-white/[0.04]",
  };
  return (
    <div className="panel relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-100">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl border", tones[tone])}>
            <Icon size={17} />
          </span>
        )}
      </div>
      {footer && <div className="mt-3 border-t border-white/[0.05] pt-2.5 text-xs text-slate-500">{footer}</div>}
    </div>
  );
}

// ------------------------------------------------------------------- progress
export function ProgressBar({
  value,
  tone = "#22d3ee",
  className,
  height = 6,
}: {
  value: number;
  tone?: string;
  className?: string;
  height?: number;
}) {
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-white/[0.06]", className)} style={{ height }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, backgroundColor: tone }}
      />
    </div>
  );
}

// --------------------------------------------------------------------- field
export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  format = (v: number) => v.toFixed(2),
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </label>
        <span className="font-mono text-xs text-brand-200">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-brand-400"
      />
      {hint && <p className="mt-1 text-[10.5px] text-slate-600">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ pagination
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] px-4 py-3 text-xs text-slate-500">
      <span>
        Showing <span className="text-slate-300">{formatNumber((page - 1) * pageSize + 1)}</span>–
        <span className="text-slate-300">{formatNumber(Math.min(page * pageSize, total))}</span> of{" "}
        <span className="text-slate-300">{formatNumber(total)}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost px-2 py-1"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="px-2 font-mono text-[11px] text-slate-400">
          {page} / {pages}
        </span>
        <button
          type="button"
          className="btn-ghost px-2 py-1"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- tabs
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; count?: number; icon?: LucideIcon }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 rounded-xl border border-white/[0.06] bg-ink-900/60 p-1", className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              selected
                ? "bg-brand-400/12 text-brand-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.18)]"
                : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
            )}
          >
            {Icon && <Icon size={14} />}
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] text-slate-400">
                {formatNumber(tab.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------- modal
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 my-auto w-full animate-fade-in overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-850 shadow-2xl",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2 px-2 py-1" aria-label="Close dialog">
            <X size={17} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ error box
export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-xl border border-signal-contradicted/20 bg-signal-contradicted/[0.07] px-4 py-3 text-sm text-signal-contradicted",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span className="leading-relaxed">{message}</span>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary px-2.5 py-1 text-xs">
          Retry
        </button>
      )}
    </div>
  );
}

export function InfoNote({
  children,
  tone = "info",
  icon: Icon = AlertCircle,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "success";
  icon?: LucideIcon;
}) {
  const tones = {
    info: "border-signal-info/20 bg-signal-info/[0.06] text-signal-info",
    warning: "border-signal-review/20 bg-signal-review/[0.06] text-signal-review",
    success: "border-signal-supported/20 bg-signal-supported/[0.06] text-signal-supported",
  };
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", tones[tone])}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- copy button
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const onClick = async () => {
    const ok = await copyText(value);
    setCopied(ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button type="button" onClick={onClick} className={cn("btn-ghost px-1.5 py-1 text-[11px]", className)}>
      {copied ? <Check size={13} className="text-signal-supported" /> : <Copy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

// ---------------------------------------------------------------- json viewer
export function JsonBlock({ value }: { value: unknown }) {
  const text = (() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  })();
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-white/[0.06] bg-ink-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
      {text}
    </pre>
  );
}

// ------------------------------------------------------------------ misc bits
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-300">{children}</dd>
    </div>
  );
}

export function CountPill({ value, tone = "text-slate-300" }: { value: number; tone?: string }) {
  return (
    <span className={cn("rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 font-mono text-[11px]", tone)}>
      {formatNumber(value)}
    </span>
  );
}

// ------------------------------------------------------------- toast system
type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string };

const ToastContext = createContext<{
  push: (kind: ToastKind, title: string, description?: string) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((kind: ToastKind, title: string, description?: string) => {
    const id = ++counter.current;
    setItems((current) => [...current.slice(-4), { id, kind, title, description }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, kind === "error" ? 8000 : 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-full max-w-sm flex-col gap-2">
          {items.map((item) => {
            const tone =
              item.kind === "success"
                ? "border-signal-supported/30 text-signal-supported"
                : item.kind === "error"
                  ? "border-signal-contradicted/30 text-signal-contradicted"
                  : "border-signal-info/30 text-signal-info";
            return (
              <div
                key={item.id}
                className="pointer-events-auto animate-fade-in rounded-xl border border-white/[0.08] bg-ink-800/95 p-3.5 shadow-xl backdrop-blur"
              >
                <div className={cn("flex items-start gap-2.5 text-sm font-medium", tone)}>
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-current" />
                  <div className="min-w-0">
                    <p>{item.title}</p>
                    {item.description && (
                      <p className="mt-1 text-xs font-normal leading-relaxed text-slate-400">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
