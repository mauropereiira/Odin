import type { ConverseRecord, ConverseSession } from "./converse.js";
import type { AgentInfo } from "./fleet.js";
import type { ProviderCapability } from "./providers/types.js";
import type {
  BrainSummary,
  LiveSession,
  McpServer,
  Memory,
  MemoryGraph,
  ProjectCard,
  SessionDetail,
  SessionSummary,
  SkillsReport,
  TokenTotals,
  UsageReport,
} from "./types.js";

interface DemoConversation {
  session: ConverseSession;
  records: ConverseRecord[];
}

export interface DemoData {
  providers: ProviderCapability[];
  capabilities: Record<string, unknown>;
  overview: Record<string, unknown>;
  rateLimit: Record<string, unknown>;
  plan: Record<string, unknown>;
  sessions: SessionSummary[];
  sessionDetails: Map<string, SessionDetail>;
  liveSessions: LiveSession[];
  usage: UsageReport;
  mcp: McpServer[];
  projects: ProjectCard[];
  memories: Memory[];
  brain: BrainSummary;
  graph: MemoryGraph;
  skills: SkillsReport;
  conversations: DemoConversation[];
  agents: AgentInfo[];
}

const PROJECTS = [
  { label: "Atlas", dir: "-demo-workspaces-atlas", path: "/demo/workspaces/atlas" },
  { label: "Relay", dir: "-demo-workspaces-relay", path: "/demo/workspaces/relay" },
  { label: "Northstar", dir: "-demo-workspaces-northstar", path: "/demo/workspaces/northstar" },
  { label: "Beacon", dir: "-demo-workspaces-beacon", path: "/demo/workspaces/beacon" },
];

function tokens(index: number): TokenTotals {
  return {
    input: 16_000 + index * 1_700,
    output: 3_800 + (index % 5) * 760,
    cacheCreate: 1_200 + index * 80,
    cacheRead: 22_000 + (index % 6) * 5_400,
  };
}

function totalTokens(value: TokenTotals): number {
  return value.input + value.output + value.cacheCreate + value.cacheRead;
}

function addTokens(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreate: a.cacheCreate + b.cacheCreate,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function createDemoData(anchor = new Date()): DemoData {
  const now = anchor.getTime();
  const isoAgo = (milliseconds: number) => new Date(now - milliseconds).toISOString();
  const titles = [
    "Design the release checklist",
    "Refine the indexing pipeline",
    "Review the synchronization boundary",
    "Implement resilient retries",
    "Map the onboarding flow",
    "Audit storage permissions",
    "Draft the migration guide",
    "Investigate cache invalidation",
    "Add provider diagnostics",
    "Simplify the deployment script",
    "Test conversation recovery",
    "Document the local API",
  ];
  const models = ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-3-5"];
  const sessions: SessionSummary[] = titles.map((title, index) => {
    const project = PROJECTS[index % PROJECTS.length];
    const endedAt = isoAgo(index === 0 ? 90_000 : index * 27 * 60 * 60 * 1_000);
    const sessionTokens = tokens(index);
    return {
      id: `demo-session-${String(index + 1).padStart(2, "0")}`,
      projectDir: project.dir,
      project: project.label,
      title,
      model: models[index % models.length],
      startedAt: new Date(Date.parse(endedAt) - (16 + index) * 60_000).toISOString(),
      endedAt,
      durationSec: (16 + index) * 60,
      messageCount: 6 + (index % 7),
      toolCallCount: 3 + (index % 6),
      isSidechain: index === titles.length - 1,
      gitBranch: index % 3 === 0 ? "main" : `feature/demo-${index + 1}`,
      tokens: sessionTokens,
      costUsd: Number((1.25 + index * 0.34).toFixed(2)),
    };
  });
  const sessionDetails = new Map<string, SessionDetail>();
  for (const session of sessions) {
    sessionDetails.set(session.id, {
      ...session,
      turns: [
        {
          uuid: `${session.id}-user`,
          role: "user",
          timestamp: session.startedAt,
          model: null,
          text: session.title,
          toolCalls: [],
          tokens: null,
          costUsd: 0,
        },
        {
          uuid: `${session.id}-assistant`,
          role: "assistant",
          timestamp: session.endedAt,
          model: session.model,
          text: "Completed the synthetic task, verified the result, and recorded the next decision.",
          toolCalls: [{ name: "Read", input: { file_path: `${PROJECTS.find((project) => project.dir === session.projectDir)?.path}/README.md` } }],
          tokens: session.tokens,
          costUsd: session.costUsd,
        },
      ],
    });
  }

  const projects: ProjectCard[] = PROJECTS.map((project, index) => {
    const projectSessions = sessions.filter((session) => session.projectDir === project.dir);
    return {
      dir: project.dir,
      label: project.label,
      path: project.path,
      sessionCount: projectSessions.length,
      lastActive: projectSessions[0]?.endedAt ?? null,
      tokens: projectSessions.reduce(
        (sum, session) => addTokens(sum, session.tokens),
        { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      ),
      costUsd: Number(projectSessions.reduce((sum, session) => sum + session.costUsd, 0).toFixed(2)),
      isGitRepo: index !== 3,
    };
  });

  const allTokens = sessions.reduce(
    (sum, session) => addTokens(sum, session.tokens),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  );
  const allCost = Number(sessions.reduce((sum, session) => sum + session.costUsd, 0).toFixed(2));
  const daily = Array.from({ length: 45 }, (_, index) => {
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - (44 - index));
    const active = index % 4 !== 0;
    return {
      date: date.toISOString().slice(0, 10),
      input: active ? 8_000 + index * 430 : 0,
      output: active ? 2_100 + index * 95 : 0,
      cacheCreate: active ? 500 + index * 25 : 0,
      cacheRead: active ? 12_000 + index * 680 : 0,
      costUsd: active ? Number((0.65 + index * 0.06).toFixed(2)) : 0,
      sessions: active ? 1 + (index % 3) : 0,
      messages: active ? 4 + (index % 8) : 0,
      toolCalls: active ? 2 + (index % 6) : 0,
    };
  });
  const usage: UsageReport = {
    totals: { ...allTokens, costUsd: allCost },
    today: { ...sessions[0].tokens, costUsd: sessions[0].costUsd },
    month: { ...allTokens, costUsd: allCost },
    daily,
    byModel: models.map((model) => {
      const matching = sessions.filter((session) => session.model === model);
      const modelTokens = matching.reduce(
        (sum, session) => addTokens(sum, session.tokens),
        { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      );
      return {
        model,
        tokens: modelTokens,
        costUsd: Number(matching.reduce((sum, session) => sum + session.costUsd, 0).toFixed(2)),
        sessions: matching.length,
      };
    }),
    byProject: projects.map((project) => ({
      project: project.label,
      dir: project.dir,
      costUsd: project.costUsd,
      tokens: project.tokens,
    })),
  };

  const providers: ProviderCapability[] = [
    {
      id: "claude-code",
      label: "Claude Code",
      available: true,
      authenticated: true,
      version: "synthetic",
      models: [
        { id: "sonnet", label: "Sonnet", isDefault: true },
        { id: "opus", label: "Opus" },
        { id: "haiku", label: "Haiku" },
      ],
      accessModes: [
        { id: "plan", label: "Plan", description: "Read and reason without changes." },
        { id: "default", label: "Default", description: "Standard guarded permissions." },
      ],
      defaultAccessMode: "default",
    },
    {
      id: "codex",
      label: "Codex",
      available: true,
      authenticated: true,
      version: "synthetic",
      models: [{ id: "gpt-5-codex", label: "GPT-5 Codex", isDefault: true }],
      accessModes: [
        { id: "read-only", label: "Read only", description: "Inspect without changes." },
        { id: "workspace-write", label: "Workspace write", description: "Write within the workspace." },
      ],
      defaultAccessMode: "workspace-write",
    },
  ];

  const memories: Memory[] = [
    ["operating-principles", "Operating principles", "preference", "Prefer small, reversible changes with explicit verification.", true, ["release-checklist", "security-boundary"]],
    ["release-checklist", "Release checklist", "reference", "Run tests, build production assets, inspect the diff, and verify health.", true, ["operating-principles", "atlas-roadmap"]],
    ["atlas-roadmap", "Atlas roadmap", "project", "Ship resilient synchronization, then improve observability and onboarding.", false, ["release-checklist", "sync-boundary"]],
    ["sync-boundary", "Synchronization boundary", "decision", "Keep provider adapters behind one normalized event contract.", false, ["atlas-roadmap", "provider-behavior"]],
    ["provider-behavior", "Provider behavior", "reference", "Resume identifiers remain provider-native while Odin owns normalized transcripts.", false, ["sync-boundary", "conversation-recovery"]],
    ["conversation-recovery", "Conversation recovery", "decision", "Preserve corrupt registries and tolerate incomplete JSONL tails.", false, ["provider-behavior", "security-boundary"]],
    ["security-boundary", "Local security boundary", "decision", "Keep the API on loopback and reject non-loopback hosts and origins.", true, ["operating-principles", "conversation-recovery"]],
    ["relay-retrospective", "Relay retrospective", "project", "The staged rollout reduced recovery time and clarified ownership.", false, ["release-checklist"]],
    ["research-queue", "Research queue", "idea", "Compare event compaction strategies before changing transcript storage.", false, ["provider-behavior"]],
    ["weekly-review", "Weekly review", "preference", "Summarize decisions, unresolved risks, and the next smallest milestone.", false, ["operating-principles", "research-queue"]],
  ].map(([slug, title, type, excerpt, pinned, links], index) => ({
    slug: slug as string,
    title: title as string,
    type: type as string,
    body: `# ${title as string}\n\n${excerpt as string}\n\nThis is synthetic demonstration content.`,
    excerpt: excerpt as string,
    created: isoAgo((18 - index) * 86_400_000),
    updated: isoAgo(index * 3_600_000),
    source: index < 3 ? "manual" : index % 2 ? "converse" : "fleet",
    session: null,
    pinned: pinned as boolean,
    tags: ["synthetic", type as string],
    links: links as string[],
    color: null,
  }));
  const graph: MemoryGraph = {
    nodes: memories.map(({ slug, title, type }) => ({ slug, title, type })),
    edges: memories.flatMap((memory) => memory.links.map((to) => ({ from: memory.slug, to }))),
  };
  const byType = new Map<string, number>();
  for (const memory of memories) byType.set(memory.type, (byType.get(memory.type) ?? 0) + 1);
  const brain: BrainSummary = {
    total: memories.length,
    recent: memories.slice(0, 5),
    stats: {
      total: memories.length,
      byType: [...byType].map(([type, count]) => ({ type, count })),
      newThisWeek: 4,
    },
  };

  const mcp: McpServer[] = [
    { name: "local-search", scope: "global", transport: "stdio", command: "/demo/bin/search-mcp", needsAuth: false },
    { name: "project-context", scope: "project", projectDir: "Atlas", transport: "stdio", command: "/demo/bin/context-mcp", needsAuth: false },
    { name: "reference-api", scope: "plugin", transport: "http", url: "https://mcp.example.invalid/api", needsAuth: true },
  ];
  const skills: SkillsReport = {
    plugins: [
      { key: "demo-tools@example", name: "demo-tools", marketplace: "example", version: "1.0.0", scope: "user", installPath: "/demo/plugins/demo-tools", installedAt: isoAgo(12 * 86_400_000), skillCount: 2 },
    ],
    skills: [
      { name: "release-review", description: "Review a release candidate.", plugin: "demo-tools", forged: false, active: true, createdAt: null, sourceSession: null, project: null, path: "/demo/plugins/demo-tools/skills/release-review/SKILL.md", content: "# Release review\n\nReview tests, changes, and operational risk." },
    ],
    forged: [
      { name: "verify-local-service", description: "Verify a local service safely.", plugin: "odin-forged", forged: true, active: true, createdAt: isoAgo(5 * 86_400_000), sourceSession: "demo-session-01", project: "atlas", path: "/demo/skills/active/verify-local-service/SKILL.md", content: "# Verify local service\n\n1. Check health.\n2. Inspect logs.\n3. Report evidence." },
      { name: "prepare-migration", description: "Prepare a migration plan.", plugin: "odin-forged", forged: true, active: false, createdAt: isoAgo(2 * 86_400_000), sourceSession: "demo-session-02", project: "relay", path: "/demo/skills/staged/prepare-migration/SKILL.md", content: "# Prepare migration\n\n1. Inventory state.\n2. Define rollback.\n3. Test the transition." },
    ],
    stats: { plugins: 1, skills: 1, forged: 2 },
  };

  const conversationSessions: ConverseSession[] = [
    { id: "11111111-1111-4111-8111-111111111111", provider: "claude-code", nativeSessionId: "demo-session-01", title: "Plan the Atlas release", cwd: PROJECTS[0].path, project: "Atlas", model: "sonnet", permissionMode: "default", createdAt: isoAgo(86_400_000), updatedAt: isoAgo(3_600_000) },
    { id: "22222222-2222-4222-8222-222222222222", provider: "codex", nativeSessionId: "demo-thread-relay", title: "Review Relay retries", cwd: PROJECTS[1].path, project: "Relay", model: "gpt-5-codex", permissionMode: "workspace-write", createdAt: isoAgo(2 * 86_400_000), updatedAt: isoAgo(7_200_000) },
  ];
  const conversations: DemoConversation[] = conversationSessions.map((session, index) => ({
    session,
    records: [
      { kind: "user", text: index === 0 ? "Plan a safe release for Atlas." : "Review the retry strategy in Relay.", at: session.createdAt },
      { kind: "agent", at: session.updatedAt, event: { provider: session.provider, runId: `demo-run-${index + 1}`, type: "text", text: index === 0 ? "The release plan is staged, reversible, and ready for review." : "The retry strategy is bounded and now covers the timeout edge case." } },
      { kind: "agent", at: session.updatedAt, event: { provider: session.provider, runId: `demo-run-${index + 1}`, type: "result", ok: true, result: "Synthetic run complete.", sessionId: session.nativeSessionId } },
    ],
  }));

  const agents: AgentInfo[] = [
    { id: "agent_demo_atlas", provider: "claude-code", title: "Atlas release", cwd: PROJECTS[0].path, project: "Atlas", model: "sonnet", permissionMode: "default", status: "idle", sessionId: "demo-session-01", createdAt: isoAgo(7 * 86_400_000), lastActivity: isoAgo(8 * 60_000), lastRunId: null, lastSummary: "Release checks passed; deployment notes are ready for review." },
    { id: "agent_demo_relay", provider: "codex", title: "Relay reliability", cwd: PROJECTS[1].path, project: "Relay", model: "gpt-5-codex", permissionMode: "workspace-write", status: "working", sessionId: "demo-thread-relay", createdAt: isoAgo(5 * 86_400_000), lastActivity: isoAgo(45_000), lastRunId: "demo-run-active", lastSummary: "Checking the bounded retry path..." },
    { id: "agent_demo_northstar", provider: "claude-code", title: "Northstar onboarding", cwd: PROJECTS[2].path, project: "Northstar", model: "haiku", permissionMode: "plan", status: "idle", sessionId: "demo-session-03", createdAt: isoAgo(4 * 86_400_000), lastActivity: isoAgo(47 * 60_000), lastRunId: null, lastSummary: "Mapped the first-run flow and identified three documentation gaps." },
  ];

  const rateLimit = {
    status: "allowed",
    resetsAt: Math.floor(now / 1_000) + 7_200,
    rateLimitType: "five_hour",
    overageStatus: "disabled",
    isUsingOverage: false,
  };
  const capabilities = {
    runtime: { mode: "demo", readOnly: true },
    providers: providers.map(({ id, label, available, authenticated }) => ({ id, label, available, authenticated })),
    brain: { persistent: true, recall: true, remember: true },
    notes: { enabled: true, available: true, forge: "Synthetic Research" },
    skills: { enabled: true, active: skills.forged.filter((skill) => skill.active).length },
    conversations: { persistent: true },
    fleet: { persistent: true },
  };
  const overview = {
    sessions: { total: sessions.length, activeNow: 1 },
    usage: { todayCost: usage.today.costUsd, monthCost: usage.month.costUsd },
    mcp: { total: mcp.length, needsAuth: mcp.filter((server) => server.needsAuth).length },
    projects: { total: projects.length },
    rateLimit,
    at: anchor.toISOString(),
  };
  const plan = {
    account: {
      email: "demo-user@example.invalid",
      organizationUuid: "00000000-0000-4000-8000-000000000000",
      billingType: "subscription",
      memberSince: "2025-01-01T00:00:00.000Z",
      hasExtraUsage: false,
      extraUsageDisabledReason: null,
      guestPassesRemaining: 2,
      opusDefault: false,
    },
    rateLimits: { five_hour: rateLimit },
  };
  const liveSessions: LiveSession[] = [
    {
      id: sessions[0].id,
      project: sessions[0].project,
      projectDir: sessions[0].projectDir,
      gitBranch: sessions[0].gitBranch,
      model: sessions[0].model,
      lastActivity: sessions[0].endedAt,
      userText: sessions[0].title,
      nowText: "Verifying the final release checklist.",
      nowTool: { name: "Read", hint: "README.md" },
      nowIsTool: false,
    },
  ];

  return {
    providers,
    capabilities,
    overview,
    rateLimit,
    plan,
    sessions,
    sessionDetails,
    liveSessions,
    usage,
    mcp,
    projects,
    memories,
    brain,
    graph,
    skills,
    conversations,
    agents,
  };
}

export function demoResponse(data: DemoData, requestUrl: string): unknown | undefined {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const path = url.pathname;
  if (path === "/api/health") return { ok: true, service: "odin", mode: "demo", readOnly: true };
  if (path === "/api/providers") return data.providers;
  if (path === "/api/capabilities") return data.capabilities;
  if (path === "/api/overview") return data.overview;
  if (path === "/api/ratelimit") return { rateLimit: data.rateLimit };
  if (path === "/api/plan") return data.plan;
  if (path === "/api/sessions") return data.sessions;
  if (path === "/api/sessions/live") return data.liveSessions;
  if (path.startsWith("/api/sessions/")) {
    return data.sessionDetails.get(decodeURIComponent(path.slice("/api/sessions/".length)));
  }
  if (path === "/api/usage") return data.usage;
  if (path === "/api/mcp") return data.mcp;
  if (path === "/api/projects") return data.projects;
  if (path === "/api/brain") return data.brain;
  if (path === "/api/brain/memories") return data.memories;
  if (path === "/api/brain/graph") return data.graph;
  if (path === "/api/brain/search") {
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!query) return [];
    return data.memories.filter((memory) => memory.title.toLowerCase().includes(query) || memory.body.toLowerCase().includes(query));
  }
  if (path.startsWith("/api/brain/memories/")) {
    const slug = decodeURIComponent(path.slice("/api/brain/memories/".length));
    return data.memories.find((memory) => memory.slug === slug);
  }
  if (path === "/api/skills") return data.skills;
  if (path === "/api/converse/sessions") return data.conversations.map(({ session }) => session);
  if (path.startsWith("/api/converse/sessions/")) {
    const id = decodeURIComponent(path.slice("/api/converse/sessions/".length));
    return data.conversations.find((conversation) => conversation.session.id === id);
  }
  if (path === "/api/agents") return data.agents;
  return undefined;
}
