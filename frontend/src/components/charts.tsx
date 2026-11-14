import { useId, useState } from "react";
import { cn, formatNumber, formatRatio } from "../lib/format";
import type { TrendPoint, TrustBand } from "../lib/types";
import { TRUST_COLOR } from "../lib/ui";

export interface Segment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  segments,
  size = 168,
  thickness = 15,
  centerLabel,
  centerValue,
  className,
}: {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const visible = segments.filter((segment) => segment.value > 0);

  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.055)"
          strokeWidth={thickness}
        />
        {total > 0 &&
          visible.map((segment) => {
            const length = (segment.value / total) * circumference;
            const dashOffset = -offset;
            offset += length;
            return (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`}
                strokeDashoffset={dashOffset}
                className="transition-all duration-500"
              >
                <title>{`${segment.label}: ${formatNumber(segment.value)}`}</title>
              </circle>
            );
          })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-slate-100">{centerValue ?? formatNumber(total)}</div>
          {centerLabel && (
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">
              {centerLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BarList({
  items,
  total,
  showPercent = true,
  className,
  barHeight = 7,
  emptyLabel = "No data yet",
}: {
  items: { label: string; value: number; color?: string }[];
  total?: number;
  showPercent?: boolean;
  className?: string;
  barHeight?: number;
  emptyLabel?: string;
}) {
  const denominator = total ?? items.reduce((sum, item) => sum + item.value, 0);
  if (items.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-500">{emptyLabel}</p>;
  }
  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item, index) => {
        const ratio = denominator > 0 ? item.value / denominator : 0;
        return (
          <div key={`${item.label}-${index}`}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-slate-400">{item.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-slate-400">
                {formatNumber(item.value)}
                {showPercent && <span className="ml-1.5 text-slate-600">{formatRatio(ratio, 0)}</span>}
              </span>
            </div>
            <div className="overflow-hidden rounded-full bg-white/[0.05]" style={{ height: barHeight }}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(item.value > 0 ? 2 : 0, ratio * 100)}%`,
                  backgroundColor: item.color ?? "#22d3ee",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TrendChart({
  points,
  height = 190,
  className,
}: {
  points: TrendPoint[];
  height?: number;
  className?: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const padding = { top: 14, right: 12, bottom: 26, left: 28 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...points.map((point) => Math.max(point.documents, point.generations)));
  const step = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;

  const x = (index: number) => padding.left + index * step;
  const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;

  const linePath = (key: "documents" | "generations") =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(point[key]).toFixed(1)}`)
      .join(" ");

  const areaPath = (key: "documents" | "generations") =>
    `${linePath(key)} L ${x(points.length - 1).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} L ${x(0).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  if (points.length === 0) {
    return <p className="py-10 text-center text-xs text-slate-500">No activity in this window.</p>;
  }

  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Ingestion and generation trend">
        <defs>
          <linearGradient id={`doc-${gradientId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`gen-${gradientId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => {
          const yValue = padding.top + plotHeight - tick * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yValue}
                y2={yValue}
                stroke="rgba(148,163,184,0.09)"
                strokeDasharray="3 5"
              />
              <text x={4} y={yValue + 3} fill="#475569" fontSize="9" fontFamily="ui-monospace, monospace">
                {Math.round(tick * maxValue)}
              </text>
            </g>
          );
        })}

        <path d={areaPath("documents")} fill={`url(#doc-${gradientId})`} />
        <path d={areaPath("generations")} fill={`url(#gen-${gradientId})`} />
        <path d={linePath("documents")} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinejoin="round" />
        <path
          d={linePath("generations")}
          fill="none"
          stroke="#a78bfa"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeDasharray="5 3"
        />

        {points.map((point, index) => (
          <g key={point.date}>
            <circle cx={x(index)} cy={y(point.documents)} r={hover === index ? 3.6 : 2.2} fill="#22d3ee" />
            <circle cx={x(index)} cy={y(point.generations)} r={hover === index ? 3.6 : 2.2} fill="#a78bfa" />
            {index % labelEvery === 0 || index === points.length - 1 ? (
              <text
                x={x(index)}
                y={height - 6}
                fill="#475569"
                fontSize="9"
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
              >
                {point.date.slice(5)}
              </text>
            ) : null}
            <rect
              x={x(index) - step / 2}
              y={padding.top}
              width={step}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            stroke="rgba(148,163,184,0.3)"
          />
        )}
      </svg>

      {hover !== null && points[hover] && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-white/10 bg-ink-800/95 px-2.5 py-1.5 text-[10.5px] shadow-lg"
          style={{
            left: `calc(${(x(hover) / width) * 100}% + 8px)`,
            transform: x(hover) > width * 0.7 ? "translateX(-110%)" : undefined,
          }}
        >
          <div className="font-mono text-slate-400">{points[hover].date}</div>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-brand-300">Docs {points[hover].documents}</span>
            <span className="text-signal-violet">Gens {points[hover].generations}</span>
          </div>
        </div>
      )}

      <div className="mt-1 flex items-center justify-center gap-5 text-[10.5px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-brand-400" /> Documents
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-signal-violet" /> Generations
        </span>
      </div>
    </div>
  );
}

export function TrustGauge({
  score,
  band,
  size = 170,
  showThresholds,
  thresholds,
}: {
  score: number;
  band: TrustBand;
  size?: number;
  showThresholds?: boolean;
  thresholds?: Record<string, number>;
}) {
  const stroke = 13;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, score / 100));
  const color = TRUST_COLOR[band];

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.01, ratio * circumference)} ${circumference}`}
          className="transition-all duration-700"
          style={{ filter: `drop-shadow(0 0 8px ${color}55)` }}
        />
        {showThresholds && thresholds && (
          <>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#fb7185"
              strokeWidth={1}
              strokeDasharray={`1 ${circumference}`}
              strokeDashoffset={-(thresholds.abstain / 100) * circumference}
              opacity={0.7}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#fbbf24"
              strokeWidth={1}
              strokeDasharray={`1 ${circumference}`}
              strokeDashoffset={-(thresholds.review / 100) * circumference}
              opacity={0.7}
            />
          </>
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-3xl font-semibold tracking-tight" style={{ color }}>
            {score.toFixed(1)}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{band}</div>
        </div>
      </div>
    </div>
  );
}

export function MiniSparkline({
  values,
  color = "#22d3ee",
  width = 120,
  height = 32,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const path = values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${(index * step).toFixed(1)} ${(height - (value / max) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ScoreBars({
  values,
  className,
}: {
  values: { label: string; value: number; color?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {values.map((item) => (
        <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_42px] items-center gap-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-slate-400">{item.label}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(1, Math.min(100, item.value * 100))}%`, backgroundColor: item.color ?? "#22d3ee" }}
              />
            </div>
          </div>
          <span className="text-right font-mono text-[11px] text-slate-400">{Math.round(item.value * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
