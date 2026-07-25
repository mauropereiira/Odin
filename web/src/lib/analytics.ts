import type { SessionSummary } from "./types";
import { totalTokens, modelLabel } from "./format";

const DAY = 86_400_000;

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function isToday(iso: string | null): boolean {
  return dayKey(iso) === new Date().toISOString().slice(0, 10);
}

export interface Rollup {
  sessions: number;
  tokens: number;
  cost: number;
  todayTokens: number;
  todayCost: number;
  activeNow: number;
}

export function rollups(sessions: SessionSummary[]): Rollup {
  let tokens = 0;
  let cost = 0;
  let todayTokens = 0;
  let todayCost = 0;
  let activeNow = 0;
  const now = Date.now();
  for (const s of sessions) {
    const t = totalTokens(s.tokens);
    tokens += t;
    cost += s.costUsd;
    if (isToday(s.endedAt)) {
      todayTokens += t;
      todayCost += s.costUsd;
    }
    if (s.endedAt && now - Date.parse(s.endedAt) < 5 * 60 * 1000) activeNow++;
  }
  return { sessions: sessions.length, tokens, cost, todayTokens, todayCost, activeNow };
}

/** Daily total-token series over the last `days`, zero-filled for gaps. */
export function dailyTokenSeries(
  sessions: SessionSummary[],
  days = 30,
): { date: string; tokens: number; cost: number }[] {
  const byDay = new Map<string, { tokens: number; cost: number }>();
  for (const s of sessions) {
    const k = dayKey(s.endedAt);
    if (!k) continue;
    const cur = byDay.get(k) ?? { tokens: 0, cost: 0 };
    cur.tokens += totalTokens(s.tokens);
    cur.cost += s.costUsd;
    byDay.set(k, cur);
  }
  const out: { date: string; tokens: number; cost: number }[] = [];
  const start = Date.now() - (days - 1) * DAY;
  for (let i = 0; i < days; i++) {
    const key = new Date(start + i * DAY).toISOString().slice(0, 10);
    const hit = byDay.get(key);
    out.push({ date: key, tokens: hit?.tokens ?? 0, cost: hit?.cost ?? 0 });
  }
  return out;
}

export function topProjects(
  sessions: SessionSummary[],
  n = 5,
): { project: string; dir: string; tokens: number; cost: number; sessions: number }[] {
  const map = new Map<string, { project: string; dir: string; tokens: number; cost: number; sessions: number }>();
  for (const s of sessions) {
    const cur =
      map.get(s.projectDir) ??
      { project: s.project, dir: s.projectDir, tokens: 0, cost: 0, sessions: 0 };
    cur.tokens += totalTokens(s.tokens);
    cur.cost += s.costUsd;
    cur.sessions += 1;
    map.set(s.projectDir, cur);
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens).slice(0, n);
}

export function modelMix(
  sessions: SessionSummary[],
): { model: string; tokens: number; cost: number }[] {
  const map = new Map<string, { model: string; tokens: number; cost: number }>();
  for (const s of sessions) {
    const label = modelLabel(s.model);
    const cur = map.get(label) ?? { model: label, tokens: 0, cost: 0 };
    cur.tokens += totalTokens(s.tokens);
    cur.cost += s.costUsd;
    map.set(label, cur);
  }
  return [...map.values()].filter((m) => m.model !== "—").sort((a, b) => b.tokens - a.tokens);
}
