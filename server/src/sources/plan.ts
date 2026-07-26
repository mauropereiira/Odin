import { readFile } from "node:fs/promises";
import { paths } from "../claudePaths.js";

/**
 * The `plan` source surfaces the account / subscription facts Claude Code keeps
 * in ~/.claude.json — the same things you'd see in the desktop app's settings.
 * Pure reader; the live session-limit windows (the 5-hour rolling limit, etc.)
 * come separately from the agent stream's rate_limit events.
 */

export interface PlanInfo {
  email: string | null;
  organizationUuid: string | null;
  billingType: string | null;
  memberSince: string | null;
  hasExtraUsage: boolean;
  extraUsageDisabledReason: string | null;
  guestPassesRemaining: number | null;
  opusDefault: boolean;
}

let lastGood: PlanInfo | null = null;

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

const EMPTY: PlanInfo = {
  email: null,
  organizationUuid: null,
  billingType: null,
  memberSince: null,
  hasExtraUsage: false,
  extraUsageDisabledReason: null,
  guestPassesRemaining: null,
  opusDefault: false,
};

export const plan = {
  id: "plan",
  watchPaths: [paths.configJson],

  async get(): Promise<PlanInfo> {
    try {
      const raw = JSON.parse(await readFile(paths.configJson, "utf8")) as Record<string, unknown>;
      const account = (raw.oauthAccount as Record<string, unknown>) || {};
      const passes = raw.passesLastSeenRemaining;

      const info: PlanInfo = {
        email: str(account.emailAddress),
        organizationUuid: str(account.organizationUuid),
        billingType: str(account.billingType),
        memberSince: str(account.accountCreatedAt),
        hasExtraUsage: account.hasExtraUsageEnabled === true,
        extraUsageDisabledReason: str(raw.cachedExtraUsageDisabledReason),
        guestPassesRemaining: typeof passes === "number" ? passes : null,
        opusDefault: raw.hasOpusPlanDefault === true,
      };
      lastGood = info;
      return info;
    } catch {
      return lastGood ?? EMPTY;
    }
  },

  invalidate() {
    lastGood = null;
  },
};
