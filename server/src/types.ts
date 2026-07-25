/** Shared DTOs returned by the API. Plain JSON — no fs handles leak out. */

export interface TokenTotals {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface SessionSummary {
  id: string;
  /** Encoded project dir name (stable id). */
  projectDir: string;
  /** Human label, e.g. "OS". */
  project: string;
  /** First user message, trimmed — the session's title. */
  title: string;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Wall-clock seconds between first and last event. */
  durationSec: number;
  messageCount: number;
  toolCallCount: number;
  isSidechain: boolean;
  gitBranch: string | null;
  tokens: TokenTotals;
  /** Estimated equivalent API cost in USD. */
  costUsd: number;
}

export interface TranscriptTurn {
  uuid: string;
  role: "user" | "assistant" | "system" | "tool";
  timestamp: string | null;
  model: string | null;
  /** Rendered text of the turn (tool calls summarized). */
  text: string;
  toolCalls: { name: string; input?: unknown }[];
  tokens: TokenTotals | null;
  costUsd: number;
}

export interface SessionDetail extends SessionSummary {
  turns: TranscriptTurn[];
}

export interface McpServer {
  name: string;
  scope: "global" | "project" | "plugin";
  /** For project scope, the project this belongs to. */
  projectDir?: string;
  transport: "stdio" | "sse" | "http" | "unknown";
  command?: string;
  url?: string;
  needsAuth: boolean;
}

export interface ProjectCard {
  dir: string;
  label: string;
  path: string;
  sessionCount: number;
  lastActive: string | null;
  tokens: TokenTotals;
  costUsd: number;
  isGitRepo: boolean;
}

export interface DailyPoint {
  date: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  costUsd: number;
  sessions: number;
  messages: number;
  toolCalls: number;
}

export interface UsageReport {
  totals: TokenTotals & { costUsd: number };
  today: TokenTotals & { costUsd: number };
  month: TokenTotals & { costUsd: number };
  daily: DailyPoint[];
  byModel: { model: string; tokens: TokenTotals; costUsd: number; sessions: number }[];
  byProject: { project: string; dir: string; costUsd: number; tokens: TokenTotals }[];
}

/** A change event pushed over the WebSocket when watched files change. */
export interface ChangeEvent {
  source: string;
  at: string;
}

// --- Brain (memory) --------------------------------------------------------

/** One durable memory, parsed from a note in the Odin Forge. */
export interface Memory {
  slug: string;
  title: string;
  type: string;
  body: string;
  excerpt: string;
  created: string | null;
  updated: string | null;
  source: string | null;
  session: string | null;
  pinned: boolean;
  tags: string[];
  links: string[];
  color: string | null;
}
export interface MemoryGraphNode {
  slug: string;
  title: string;
  type: string;
}
export interface MemoryGraphEdge {
  from: string;
  to: string;
}
export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}
export interface BrainStats {
  total: number;
  byType: { type: string; count: number }[];
  newThisWeek: number;
}
export interface BrainSummary {
  total: number;
  recent: Memory[];
  stats: BrainStats;
}

/** An active session with its latest exchange, for the live cockpit grid. */
export interface LiveSession {
  id: string;
  project: string;
  projectDir: string;
  gitBranch: string | null;
  model: string | null;
  lastActivity: string | null; // ISO
  userText: string | null; // latest real user prompt
  nowText: string | null; // tail of latest assistant text
  nowTool: { name: string; hint: string } | null; // latest tool_use
  nowIsTool: boolean; // true → the most recent activity is the tool
}

// --- Skills & Plugins ------------------------------------------------------

export interface SkillInfo {
  name: string;
  description: string;
  plugin: string; // owning plugin name, or "odin-forged"
  forged: boolean;
  /** For forged skills: true = loaded into Odin's runs; false = staged, awaiting activation. */
  active: boolean;
  createdAt: string | null;
  sourceSession: string | null;
  project: string | null;
  path: string; // absolute path to the SKILL.md
  content: string;
}
export interface InstalledPlugin {
  key: string; // "name@marketplace"
  name: string;
  marketplace: string;
  version: string;
  scope: string;
  installPath: string;
  installedAt: string | null;
  skillCount: number;
}
export interface SkillsReport {
  plugins: InstalledPlugin[];
  skills: SkillInfo[]; // plugin-provided skills
  forged: SkillInfo[]; // Odin's forged skills
  stats: { plugins: number; skills: number; forged: number };
}
