import clsx from "clsx";
import type { ReactNode } from "react";

/** A framed instrument panel. Optional header row with a micro-label + action. */
export function Panel({
  children,
  className,
  label,
  action,
  flush,
}: {
  children: ReactNode;
  className?: string;
  label?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={clsx("panel", className)}>
      {(label || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {label ? <span className="micro-label">{label}</span> : <span />}
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/** The signature metric: a mono numeral with a micro-label and hairline underline. */
export function Readout({
  value,
  label,
  unit,
  accent = "ink",
  size = "md",
  hint,
}: {
  value: ReactNode;
  label: ReactNode;
  unit?: ReactNode;
  accent?: "ink" | "clay" | "teal" | "iris" | "amber" | "rose";
  size?: "sm" | "md" | "lg" | "xl";
  hint?: ReactNode;
}) {
  const accentColor = {
    ink: "var(--color-ink)",
    clay: "var(--color-clay)",
    teal: "var(--color-teal)",
    iris: "var(--color-iris)",
    amber: "var(--color-amber)",
    rose: "var(--color-rose)",
  }[accent];
  const sizeClass = {
    sm: "text-xl",
    md: "text-3xl",
    lg: "text-4xl",
    xl: "text-6xl",
  }[size];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="micro-label">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={clsx("readout font-medium leading-none", sizeClass)}
          style={{ color: accentColor }}
        >
          {value}
        </span>
        {unit && <span className="readout text-xs text-ink-faint">{unit}</span>}
      </div>
      <span className="h-px w-8" style={{ background: accentColor, opacity: 0.5 }} />
      {hint && <span className="text-xs text-ink-dim">{hint}</span>}
    </div>
  );
}

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("micro-label", className)}>{children}</span>;
}

/** Small status pill for states like scope / transport / auth. */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "clay" | "teal" | "iris" | "amber" | "rose" | "green";
}) {
  const tones: Record<string, string> = {
    neutral: "border-line text-ink-dim",
    clay: "text-clay",
    teal: "text-teal",
    iris: "text-iris",
    amber: "text-amber",
    rose: "text-rose",
    green: "text-teal",
  };
  const bg: Record<string, string> = {
    neutral: "transparent",
    clay: "rgba(217,119,87,0.12)",
    teal: "rgba(94,234,212,0.12)",
    iris: "rgba(139,156,255,0.12)",
    amber: "rgba(245,181,68,0.12)",
    rose: "rgba(242,104,143,0.12)",
    green: "rgba(94,234,212,0.12)",
  };
  return (
    <span
      className={clsx(
        "readout inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
        tones[tone],
      )}
      style={{ background: bg[tone], borderColor: tone === "neutral" ? undefined : "transparent" }}
    >
      {children}
    </span>
  );
}

/** Minimal inline sparkline from a series of numbers. */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  color = "var(--color-teal)",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 3) - 1.5]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spark-${color.replace(/[^a-z]/gi, "")}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx("animate-pulse rounded-md bg-panel-2", className)}
      style={{ minHeight: 8 }}
    />
  );
}

export function EmptyState({ icon, title, body }: { icon?: ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <p className="text-sm text-ink">{title}</p>
      {body && <p className="max-w-sm text-xs text-ink-dim">{body}</p>}
    </div>
  );
}
