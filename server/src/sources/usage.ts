import { readFile } from "node:fs/promises";
import { sessions } from "./sessions.js";
import { addTokens, emptyTokens } from "../pricing.js";
import { paths } from "../claudePaths.js";
import type { DailyPoint, TokenTotals, UsageReport } from "../types.js";

/**
 * Aggregate usage from the already-parsed session source and Claude's daily
 * activity cache. This source only reads Claude's state and returns plain DTOs.
 */

interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface UsageTotal extends TokenTotals {
  costUsd: number;
}

const DAYS = 45;
let statsCache: DailyActivity[] | null = null;
let reportCache: { day: string; report: UsageReport } | null = null;
let lastGoodReport: UsageReport | null = null;

const emptyTotal = (): UsageTotal => ({ ...emptyTokens(), costUsd: 0 });

function addSession(total: UsageTotal, tokens: TokenTotals, costUsd: number): UsageTotal {
  return {
    ...addTokens(total, tokens),
    costUsd: total.costUsd + costUsd,
  };
}

function localDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recentDates(today: Date): string[] {
  const dates: string[] = [];
  for (let offset = DAYS - 1; offset >= 0; offset--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    dates.push(localDate(date));
  }
  return dates;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readDailyActivity(): Promise<DailyActivity[]> {
  if (statsCache) return statsCache;
  try {
    const parsed = JSON.parse(await readFile(paths.statsCache, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const rows = (parsed as Record<string, unknown>).dailyActivity;
    if (!Array.isArray(rows)) return [];

    const dailyActivity: DailyActivity[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const activity = row as Record<string, unknown>;
      if (typeof activity.date !== "string") continue;
      dailyActivity.push({
        date: activity.date,
        messageCount: number(activity.messageCount),
        sessionCount: number(activity.sessionCount),
        toolCallCount: number(activity.toolCallCount),
      });
    }
    statsCache = dailyActivity;
    return dailyActivity;
  } catch {
    statsCache = null;
    return [];
  }
}

function emptyReport(): UsageReport {
  return {
    totals: emptyTotal(),
    today: emptyTotal(),
    month: emptyTotal(),
    daily: [],
    byModel: [],
    byProject: [],
  };
}

export const usage = {
  id: "usage",
  watchPaths: [paths.projects, paths.statsCache],

  async report(): Promise<UsageReport> {
    const now = new Date();
    const today = localDate(now);
    if (reportCache?.day === today) return reportCache.report;

    try {
      const [all, activity] = await Promise.all([sessions.list(), readDailyActivity()]);
      const month = today.slice(0, 7);
      let totals = emptyTotal();
      let todayTotal = emptyTotal();
      let monthTotal = emptyTotal();
      const dailyTotals = new Map<string, UsageTotal>();
      const modelTotals = new Map<
        string,
        { tokens: TokenTotals; costUsd: number; sessions: number }
      >();
      const projectTotals = new Map<
        string,
        { project: string; tokens: TokenTotals; costUsd: number }
      >();

      for (const session of all) {
        totals = addSession(totals, session.tokens, session.costUsd);
        const day = session.endedAt?.slice(0, 10);
        if (day === today) todayTotal = addSession(todayTotal, session.tokens, session.costUsd);
        if (day?.slice(0, 7) === month) {
          monthTotal = addSession(monthTotal, session.tokens, session.costUsd);
        }
        if (day) {
          dailyTotals.set(
            day,
            addSession(dailyTotals.get(day) || emptyTotal(), session.tokens, session.costUsd),
          );
        }

        const model = session.model || "unknown";
        const byModel = modelTotals.get(model) || {
          tokens: emptyTokens(),
          costUsd: 0,
          sessions: 0,
        };
        byModel.tokens = addTokens(byModel.tokens, session.tokens);
        byModel.costUsd += session.costUsd;
        byModel.sessions++;
        modelTotals.set(model, byModel);

        const byProject = projectTotals.get(session.projectDir) || {
          project: session.project,
          tokens: emptyTokens(),
          costUsd: 0,
        };
        byProject.tokens = addTokens(byProject.tokens, session.tokens);
        byProject.costUsd += session.costUsd;
        projectTotals.set(session.projectDir, byProject);
      }

      const activityByDay = new Map<string, DailyActivity>();
      for (const row of activity) {
        const current = activityByDay.get(row.date);
        activityByDay.set(row.date, {
          date: row.date,
          messageCount: (current?.messageCount || 0) + row.messageCount,
          sessionCount: (current?.sessionCount || 0) + row.sessionCount,
          toolCallCount: (current?.toolCallCount || 0) + row.toolCallCount,
        });
      }

      const daily: DailyPoint[] = recentDates(now).map((date) => {
        const tokens = dailyTotals.get(date) || emptyTotal();
        const counts = activityByDay.get(date);
        return {
          date,
          input: tokens.input,
          output: tokens.output,
          cacheCreate: tokens.cacheCreate,
          cacheRead: tokens.cacheRead,
          costUsd: tokens.costUsd,
          sessions: counts?.sessionCount || 0,
          messages: counts?.messageCount || 0,
          toolCalls: counts?.toolCallCount || 0,
        };
      });

      const report: UsageReport = {
        totals,
        today: todayTotal,
        month: monthTotal,
        daily,
        byModel: [...modelTotals].map(([model, value]) => ({ model, ...value })).sort(
          (a, b) => b.costUsd - a.costUsd,
        ),
        byProject: [...projectTotals]
          .map(([dir, value]) => ({ dir, ...value }))
          .sort((a, b) => b.costUsd - a.costUsd),
      };
      if (
        report.totals.costUsd === 0 &&
        lastGoodReport &&
        lastGoodReport.totals.costUsd > 0
      ) {
        return lastGoodReport;
      }
      lastGoodReport = report;
      reportCache = { day: today, report };
      return report;
    } catch {
      return lastGoodReport ?? emptyReport();
    }
  },

  async summary() {
    const report = await this.report();
    return { todayCost: report.today.costUsd, monthCost: report.month.costUsd };
  },

  invalidate() {
    statsCache = null;
    reportCache = null;
  },
};
