import type {
  AddMemoryRequest,
  AgentInfo,
  BrainSummary,
  ConverseTranscript,
  ConverseSession,
  McpServer,
  LiveSession,
  Memory,
  MemoryGraph,
  Overview,
  OdinCapabilities,
  OdinRuntime,
  ProviderCapability,
  ProviderId,
  SkillsReport,
  PlanResponse,
  ProjectCard,
  SessionDetail,
  SessionSummary,
  UsageReport,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return payload as T;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { accept: "application/json" },
  });
  const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return payload as T;
}

export interface ConverseRequest {
  provider: ProviderId;
  message: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  conversationId?: string;
}

export interface CreateAgentRequest {
  provider: ProviderId;
  cwd: string;
  project?: string;
  title?: string;
  model?: string;
  permissionMode?: string;
  message?: string;
}

export const api = {
  overview: () => get<Overview>("/api/overview"),
  runtime: () => get<OdinRuntime>("/api/health"),
  providers: () => get<ProviderCapability[]>("/api/providers"),
  capabilities: () => get<OdinCapabilities>("/api/capabilities"),
  sessions: () => get<SessionSummary[]>("/api/sessions"),
  sessionsLive: () => get<LiveSession[]>("/api/sessions/live"),
  session: (id: string) => get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),
  usage: () => get<UsageReport>("/api/usage"),
  mcp: () => get<McpServer[]>("/api/mcp"),
  projects: () => get<ProjectCard[]>("/api/projects"),
  plan: () => get<PlanResponse>("/api/plan"),
  converse: (request: ConverseRequest) =>
    post<{ runId: string; conversationId: string }>("/api/converse", request),
  stopConversation: (runId: string) =>
    post<{ stopped: boolean }>(`/api/converse/${encodeURIComponent(runId)}/stop`),
  converseSessions: () => get<ConverseSession[]>("/api/converse/sessions"),
  converseSession: (id: string) =>
    get<ConverseTranscript>(`/api/converse/sessions/${encodeURIComponent(id)}`),
  deleteConverseSession: (id: string) =>
    del<{ removed: boolean }>(`/api/converse/sessions/${encodeURIComponent(id)}`),
  agents: () => get<AgentInfo[]>("/api/agents"),
  createAgent: (request: CreateAgentRequest) => post<AgentInfo>("/api/agents", request),
  promptAgent: (id: string, message: string) =>
    post<{ runId: string }>(`/api/agents/${encodeURIComponent(id)}/prompt`, { message }),
  stopAgent: (id: string) =>
    post<{ stopped: boolean }>(`/api/agents/${encodeURIComponent(id)}/stop`),
  removeAgent: (id: string) =>
    del<{ removed: boolean }>(`/api/agents/${encodeURIComponent(id)}`),
  brain: () => get<BrainSummary>("/api/brain"),
  brainMemories: () => get<Memory[]>("/api/brain/memories"),
  brainMemory: (slug: string) => get<Memory>(`/api/brain/memories/${encodeURIComponent(slug)}`),
  brainGraph: () => get<MemoryGraph>("/api/brain/graph"),
  brainSearch: (q: string) => get<Memory[]>(`/api/brain/search?q=${encodeURIComponent(q)}`),
  brainAdd: (req: AddMemoryRequest) => post<Memory>("/api/brain/memories", req),
  brainDelete: (slug: string) =>
    del<{ removed: boolean }>(`/api/brain/memories/${encodeURIComponent(slug)}`),
  skills: () => get<SkillsReport>("/api/skills"),
  deleteForgedSkill: (slug: string) =>
    del<{ removed: boolean }>(`/api/skills/forged/${encodeURIComponent(slug)}`),
  activateForgedSkill: (slug: string) =>
    post<{ activated: boolean }>(`/api/skills/forged/${encodeURIComponent(slug)}/activate`),
  deactivateForgedSkill: (slug: string) =>
    post<{ deactivated: boolean }>(`/api/skills/forged/${encodeURIComponent(slug)}/deactivate`),
};

/** Query keys — the WS live feed invalidates these by source name. */
export const qk = {
  overview: ["overview"] as const,
  runtime: ["runtime"] as const,
  providers: ["providers"] as const,
  capabilities: ["capabilities"] as const,
  sessions: ["sessions"] as const,
  sessionsLive: ["sessions", "live"] as const,
  session: (id: string) => ["sessions", id] as const,
  usage: ["usage"] as const,
  mcp: ["mcp"] as const,
  projects: ["projects"] as const,
  agents: ["agents"] as const,
  plan: ["plan"] as const,
  brain: ["brain"] as const,
  brainMemories: ["brain", "memories"] as const,
  brainGraph: ["brain", "graph"] as const,
  skills: ["skills"] as const,
  converseSessions: ["converse", "sessions"] as const,
};

/** Map a change-event source to the query keys it should refresh. */
export const sourceToKeys: Record<string, readonly (readonly string[])[]> = {
  sessions: [qk.sessions, qk.overview, qk.sessionsLive],
  usage: [qk.usage, qk.overview],
  mcp: [qk.mcp, qk.overview],
  projects: [qk.projects, qk.overview],
  brain: [qk.brain, qk.brainMemories, qk.brainGraph],
  skills: [qk.skills, qk.capabilities],
  converse: [qk.converseSessions],
};
