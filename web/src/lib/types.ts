/** Mirror of the server DTOs (server/src/types.ts). Kept in sync by hand. */

export interface TokenTotals {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface SessionSummary {
  id: string;
  projectDir: string;
  project: string;
  title: string;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  messageCount: number;
  toolCallCount: number;
  isSidechain: boolean;
  gitBranch: string | null;
  tokens: TokenTotals;
  costUsd: number;
}

export interface TranscriptTurn {
  uuid: string;
  role: "user" | "assistant" | "system" | "tool";
  timestamp: string | null;
  model: string | null;
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

export interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
  overageStatus: string;
  isUsingOverage: boolean;
}

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

export interface PlanResponse {
  account: PlanInfo;
  rateLimits: Record<string, RateLimitInfo>;
}

export type ProviderId = "claude-code" | "codex";

export interface ProviderModel {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export interface ProviderAccessMode {
  id: string;
  label: string;
  description: string;
  dangerous?: boolean;
}

export interface ProviderCapability {
  id: ProviderId;
  label: string;
  available: boolean;
  version?: string;
  authenticated?: boolean;
  models: ProviderModel[];
  accessModes: ProviderAccessMode[];
  defaultAccessMode: string;
}

export interface OdinCapabilities {
  runtime: { mode: "live" | "demo"; readOnly: boolean };
  providers: Array<{
    id: ProviderId;
    label: string;
    available: boolean;
    authenticated?: boolean;
  }>;
  brain: { persistent: boolean; recall: boolean; remember: boolean };
  notes: { enabled: boolean; available: boolean; forge: string };
  skills: { enabled: boolean; active: number };
  conversations: { persistent: boolean };
  fleet: { persistent: boolean };
}

export interface OdinRuntime {
  mode: "live" | "demo";
  readOnly: boolean;
}

export interface AgentEvent extends Record<string, unknown> {
  kind?: "agent";
  provider: ProviderId;
  runId: string;
  type:
    | "start"
    | "init"
    | "thinking"
    | "text"
    | "tool_use"
    | "tool_result"
    | "result"
    | "rate_limit"
    | "error"
    | "exit";
}

export interface AgentInfo {
  id: string;
  provider: ProviderId;
  title: string;
  cwd: string;
  project: string;
  model?: string;
  permissionMode?: string;
  status: "idle" | "working" | "error";
  sessionId: string | null;
  createdAt: string;
  lastActivity: string;
  lastRunId: string | null;
  lastSummary: string;
}

export interface ConverseSession {
  id: string;
  provider: ProviderId;
  nativeSessionId: string | null;
  title: string;
  cwd: string;
  project: string;
  model?: string;
  permissionMode?: string;
  createdAt: string;
  updatedAt: string;
}

export type ConverseRecord =
  | { kind: "user"; text: string; at: string }
  | { kind: "agent"; event: AgentEvent; at: string };

export interface ConverseTranscript {
  session: ConverseSession;
  records: ConverseRecord[];
}

export interface Overview {
  sessions: { total: number; activeNow: number };
  usage: { todayCost: number; monthCost: number };
  mcp: { total: number; needsAuth: number };
  projects: { total: number };
  rateLimit?: RateLimitInfo | null;
  at: string;
}

// --- Brain (memory) --------------------------------------------------------

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
export interface AddMemoryRequest {
  title: string;
  type?: string;
  body?: string;
  pinned?: boolean;
  tags?: string[];
}

export interface LiveSession {
  id: string;
  project: string;
  projectDir: string;
  gitBranch: string | null;
  model: string | null;
  lastActivity: string | null;
  userText: string | null;
  nowText: string | null;
  nowTool: { name: string; hint: string } | null;
  nowIsTool: boolean;
}

// --- Skills & Plugins ------------------------------------------------------

export interface SkillInfo {
  name: string;
  description: string;
  plugin: string;
  forged: boolean;
  active: boolean;
  createdAt: string | null;
  sourceSession: string | null;
  project: string | null;
  path: string;
  content: string;
}
export interface InstalledPlugin {
  key: string;
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
  skills: SkillInfo[];
  forged: SkillInfo[];
  stats: { plugins: number; skills: number; forged: number };
}
