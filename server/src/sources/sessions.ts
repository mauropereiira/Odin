import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { paths, projectLabel } from "../claudePaths.js";
import { addTokens, costFor, emptyTokens } from "../pricing.js";
import type {
  LiveSession,
  SessionDetail,
  SessionSummary,
  TokenTotals,
  TranscriptTurn,
} from "../types.js";

const LIVE_WINDOW_MS = 5 * 60 * 1000;

/** A short, safe hint of what a tool is acting on, for the live card. */
function toolHint(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const val =
    (typeof i.command === "string" && i.command) ||
    (typeof i.file_path === "string" && basename(i.file_path)) ||
    (typeof i.path === "string" && basename(i.path)) ||
    (typeof i.pattern === "string" && i.pattern) ||
    (typeof i.description === "string" && i.description) ||
    "";
  return val ? String(val).slice(0, 80) : "";
}

/**
 * The `sessions` source is the reference pattern for all sources: it reads
 * Claude's on-disk transcripts, never writes, and caches parsed results by file
 * mtime so repeat reads over 1,400+ transcripts stay fast. Everything is a pure
 * read returning plain DTOs.
 */

interface CachedSummary {
  mtimeMs: number;
  filePath: string;
  projectDir: string;
  summary: SessionSummary;
}

const cache = new Map<string, CachedSummary>(); // sessionId → cached summary
let indexed = false;
let lastGoodList: SessionSummary[] | null = null;

interface FileRef {
  sessionId: string;
  projectDir: string;
  filePath: string;
  mtimeMs: number;
}

async function listFiles(): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  let projectDirs: string[];
  try {
    projectDirs = await readdir(paths.projects);
  } catch {
    return refs; // no projects dir yet
  }
  for (const projectDir of projectDirs) {
    const dir = join(paths.projects, projectDir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const filePath = join(dir, entry);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(filePath)).mtimeMs;
      } catch {
        continue;
      }
      refs.push({
        sessionId: entry.replace(/\.jsonl$/, ""),
        projectDir,
        filePath,
        mtimeMs,
      });
    }
  }
  return refs;
}

/** Extract plain text from a message `content` that may be a string or block array. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("\n");
}

function tokensFromUsage(usage: Record<string, unknown> | undefined): TokenTotals {
  if (!usage) return emptyTokens();
  return {
    input: Number(usage.input_tokens) || 0,
    output: Number(usage.output_tokens) || 0,
    cacheCreate: Number(usage.cache_creation_input_tokens) || 0,
    cacheRead: Number(usage.cache_read_input_tokens) || 0,
  };
}

/** True for a real typed user prompt (not a tool_result echoed back as a user line). */
function isRealUserPrompt(msg: Record<string, unknown>): boolean {
  const content = msg.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some(
      (b) => b && typeof b === "object" && (b as Record<string, unknown>).type === "text",
    );
  }
  return false;
}

/** Tail-parse a transcript for its latest user prompt + most-recent activity. */
export async function parseLatest(filePath: string): Promise<{
  userText: string | null;
  nowText: string | null;
  nowTool: { name: string; hint: string } | null;
  nowIsTool: boolean;
}> {
  let userText: string | null = null;
  let nowText: string | null = null;
  let nowTool: { name: string; hint: string } | null = null;
  let nowIsTool = false;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const type = row.type;
    const msg = (row.message as Record<string, unknown>) || {};
    if (type === "user") {
      if (isRealUserPrompt(msg)) {
        const t = contentToText(msg.content).trim();
        if (t) userText = t.slice(0, 500);
      }
    } else if (type === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          nowText = b.text.trim().slice(-500);
          nowIsTool = false;
        } else if (b.type === "tool_use") {
          nowTool = { name: String(b.name ?? "tool"), hint: toolHint(b.input) };
          nowIsTool = true;
        }
      }
    }
  }
  return { userText, nowText, nowTool, nowIsTool };
}

async function parseSummary(ref: FileRef): Promise<SessionSummary> {
  let title = "";
  let model: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let messageCount = 0;
  let toolCallCount = 0;
  let isSidechain = false;
  let gitBranch: string | null = null;
  let tokens = emptyTokens();
  let costUsd = 0;

  const rl = createInterface({
    input: createReadStream(ref.filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const type = row.type;
    const ts = typeof row.timestamp === "string" ? row.timestamp : null;
    if (ts) {
      if (!startedAt) startedAt = ts;
      endedAt = ts;
    }
    if (row.isSidechain === true) isSidechain = true;
    if (typeof row.gitBranch === "string" && row.gitBranch !== "HEAD") {
      gitBranch = row.gitBranch;
    }

    if (type !== "user" && type !== "assistant") continue;
    const msg = (row.message as Record<string, unknown>) || {};

    if (type === "user") {
      if (isRealUserPrompt(msg)) {
        messageCount++;
        if (!title) title = contentToText(msg.content).trim().slice(0, 200);
      }
    } else {
      messageCount++;
      if (typeof msg.model === "string") model = msg.model;
      const lineTokens = tokensFromUsage(msg.usage as Record<string, unknown>);
      tokens = addTokens(tokens, lineTokens);
      costUsd += costFor(typeof msg.model === "string" ? msg.model : model, lineTokens);
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use") {
            toolCallCount++;
          }
        }
      }
    }
  }

  const durationSec =
    startedAt && endedAt
      ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
      : 0;

  return {
    id: ref.sessionId,
    projectDir: ref.projectDir,
    project: projectLabel(ref.projectDir),
    title: title || "(untitled session)",
    model,
    startedAt,
    endedAt,
    durationSec,
    messageCount,
    toolCallCount,
    isSidechain,
    gitBranch,
    tokens,
    costUsd,
  };
}

async function summaryFor(ref: FileRef): Promise<SessionSummary> {
  const hit = cache.get(ref.sessionId);
  if (hit && hit.mtimeMs === ref.mtimeMs) return hit.summary;
  const summary = await parseSummary(ref);
  cache.set(ref.sessionId, {
    mtimeMs: ref.mtimeMs,
    filePath: ref.filePath,
    projectDir: ref.projectDir,
    summary,
  });
  return summary;
}

/** Bounded-concurrency map to avoid opening 1,400 file streams at once. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const sessions = {
  id: "sessions",
  watchPaths: [paths.projects],

  async list(): Promise<SessionSummary[]> {
    try {
      const refs = await listFiles();
      const summaries = await mapPool(refs, 12, summaryFor);
      const fresh = summaries.sort((a, b) =>
        (b.endedAt || "").localeCompare(a.endedAt || ""),
      );
      indexed = true;
      if (!fresh.length && lastGoodList?.length) return lastGoodList;
      lastGoodList = fresh;
      return fresh;
    } catch {
      return lastGoodList ?? [];
    }
  },

  async get(id: string): Promise<SessionDetail | null> {
    if (!indexed && !cache.has(id)) await this.list();
    const hit = cache.get(id);
    if (!hit) return null;
    const turns = await parseTurns(hit.filePath);
    return { ...hit.summary, turns };
  },

  /** Cheap headline for the Overview without paying for a full transcript parse. */
  async summary() {
    const all = await this.list();
    const active = all.filter(
      (s) => s.endedAt && Date.now() - Date.parse(s.endedAt) < LIVE_WINDOW_MS,
    ).length;
    return { total: all.length, activeNow: active };
  },

  /** Active sessions (activity within the window) with their latest exchange. */
  async live(windowMs: number = LIVE_WINDOW_MS): Promise<LiveSession[]> {
    const all = await this.list();
    const now = Date.now();
    const active = all.filter((s) => s.endedAt && now - Date.parse(s.endedAt) < windowMs);
    const out: LiveSession[] = [];
    for (const s of active) {
      const hit = cache.get(s.id);
      if (!hit) continue;
      const latest = await parseLatest(hit.filePath);
      out.push({
        id: s.id,
        project: s.project,
        projectDir: s.projectDir,
        gitBranch: s.gitBranch,
        model: s.model,
        lastActivity: s.endedAt,
        ...latest,
      });
    }
    out.sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
    return out;
  },

  /** Drop a session from cache so the next read re-parses (used by the watcher). */
  invalidate(sessionId?: string) {
    if (sessionId) cache.delete(sessionId);
    else cache.clear();
    indexed = false;
  },
};

async function parseTurns(filePath: string): Promise<TranscriptTurn[]> {
  const turns: TranscriptTurn[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const type = row.type;
    if (type !== "user" && type !== "assistant") continue;
    const msg = (row.message as Record<string, unknown>) || {};
    const toolCalls: { name: string; input?: unknown }[] = [];
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_use" && typeof b.name === "string") {
            toolCalls.push({ name: b.name, input: b.input });
          }
        }
      }
    }
    const model = typeof msg.model === "string" ? msg.model : null;
    const tokens =
      type === "assistant" ? tokensFromUsage(msg.usage as Record<string, unknown>) : null;
    turns.push({
      uuid: typeof row.uuid === "string" ? row.uuid : "",
      role: type as "user" | "assistant",
      timestamp: typeof row.timestamp === "string" ? row.timestamp : null,
      model,
      text: contentToText(msg.content),
      toolCalls,
      tokens,
      costUsd: tokens ? costFor(model, tokens) : 0,
    });
  }
  return turns;
}
