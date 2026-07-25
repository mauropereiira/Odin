import type { ProviderId } from "./types";

/** Formatting helpers — every number the user reads passes through here. */

/** Compact token/count formatting: 1234 → "1.2K", 3_400_000 → "3.4M". */
export function compact(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return trim(n / 1000) + "K";
  if (abs < 1_000_000_000) return trim(n / 1_000_000) + "M";
  return trim(n / 1_000_000_000) + "B";
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, "");
}

/** USD with sensible precision: <$10 shows cents, else whole/thousands. */
export function usd(n: number): string {
  if (!isFinite(n)) return "$0";
  if (n === 0) return "$0";
  if (n < 10) return "$" + n.toFixed(2);
  if (n < 10_000) return "$" + n.toFixed(0);
  return "$" + compact(n);
}

export function fullUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function commas(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "2h 14m", "9m", "45s" from seconds. */
export function duration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Rolling quota reset time from a UNIX timestamp in seconds. */
export function resetCountdown(resetsAt: number, nowMs = Date.now()): string {
  const remainingMs = resetsAt * 1000 - nowMs;
  if (remainingMs <= 0) return "resets soon";
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `resets in ${hours > 0 ? `${hours}h ` : ""}${minutes}m`;
}

/** "just now", "14m ago", "3h ago", "yesterday", "Jul 2". */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const min = diff / 60000;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.floor(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)}h ago`;
  const days = hr / 24;
  if (days < 2) return "yesterday";
  if (days < 7) return `${Math.floor(days)}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Human model label: "claude-opus-4-8" → "Opus 4.8". */
export function modelLabel(model: string | null): string {
  if (!model) return "—";
  const m = model.toLowerCase();
  const fam = m.includes("opus")
    ? "Opus"
    : m.includes("sonnet")
      ? "Sonnet"
      : m.includes("haiku")
        ? "Haiku"
        : m.includes("fable")
          ? "Fable"
          : null;
  if (!fam) return model;
  const ver = model.match(/(\d+)[-.]?(\d+)?/);
  if (ver) return `${fam} ${ver[1]}${ver[2] ? "." + ver[2] : ""}`;
  return fam;
}

export function providerLabel(provider: ProviderId): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

export const MODEL_COLORS: Record<string, string> = {
  Opus: "var(--color-clay)",
  Sonnet: "var(--color-iris)",
  Haiku: "var(--color-teal)",
  Fable: "var(--color-amber)",
};

export function totalTokens(t: {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}): number {
  return t.input + t.output + t.cacheCreate + t.cacheRead;
}
