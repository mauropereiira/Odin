// @ts-nocheck
/**
 * Odin's fleet-control MCP server.
 *
 * This is a small stdio MCP server that the Converse "orchestrator" Odin loads
 * (via `claude --mcp-config`). It gives Odin the tools to command his own fleet
 * so a request to "spin up an agent on this project" can be carried out. Each
 * tool calls Odin's own local HTTP API (the same one
 * the dashboard uses), so the dispatched agents show up everywhere in the UI.
 *
 * Runs as a plain-node subprocess of the spawned `claude`; no build step.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { z } from "zod";

const PORT = process.env.ODIN_PORT || "7420";
const BASE = `http://127.0.0.1:${PORT}`;
const DEFAULT_PROVIDER = process.env.ODIN_PROVIDER === "codex" ? "codex" : "claude-code";
const ACCESS_LEVEL = ["read-only", "guarded", "full"].includes(process.env.ODIN_ACCESS_LEVEL)
  ? process.env.ODIN_ACCESS_LEVEL
  : "guarded";

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

const text = (t) => ({ content: [{ type: "text", text: t }] });

/** Resolve a project name-or-path to an absolute cwd + a friendly label. */
async function resolveProject(project) {
  const projects = await api("/api/projects");
  if (project.startsWith("/")) {
    const requested = resolve(project);
    const exact = projects.find((candidate) => resolve(candidate.path) === requested);
    if (!exact) throw new Error("Fleet agents can only use projects discovered by Odin.");
    return { cwd: exact.path, label: exact.label };
  }
  const q = project.toLowerCase();
  const match =
    projects.find((p) => p.label.toLowerCase() === q) ||
    projects.find((p) => p.label.toLowerCase().includes(q) || p.path.toLowerCase().endsWith(`/${q}`));
  if (!match) {
    const names = projects.map((p) => p.label).join(", ");
    throw new Error(`No project matches "${project}". Known projects: ${names}`);
  }
  return { cwd: match.path, label: match.label };
}

function permissionMode(provider) {
  if (ACCESS_LEVEL === "read-only") return provider === "codex" ? "read-only" : "plan";
  if (ACCESS_LEVEL === "full") {
    return provider === "codex" ? "danger-full-access" : "bypassPermissions";
  }
  return provider === "codex" ? "workspace-write" : "default";
}

function agentAccessLevel(agent) {
  if (agent.provider === "codex") {
    if (agent.permissionMode === "read-only") return "read-only";
    if (agent.permissionMode === "danger-full-access") return "full";
    return "guarded";
  }
  if (agent.permissionMode === "plan") return "read-only";
  if (agent.permissionMode === "bypassPermissions") return "full";
  return "guarded";
}

function canControl(agent) {
  const rank = { "read-only": 0, guarded: 1, full: 2 };
  return rank[agentAccessLevel(agent)] <= rank[ACCESS_LEVEL];
}

const server = new McpServer({ name: "odin", version: "0.1.0" });

server.tool(
  "dispatch_agent",
  "Spin up a new worker agent to autonomously work on a task inside one of the user's projects. Returns the agent id. Use this when asked to work on, build, or fix something in a specific project.",
  {
    project: z.string().describe("Project name (e.g. 'Moldavite') or an absolute path"),
    task: z.string().describe("Clear, complete instructions for the agent to carry out"),
    provider: z.enum(["claude-code", "codex"]).optional().describe("Execution provider (default: same provider as the orchestrator)"),
    model: z.string().max(100).optional().describe("Provider model id (default: provider default)"),
    title: z.string().optional().describe("Short label for the agent card"),
  },
  async ({ project, task, provider, model, title }) => {
    const { cwd, label } = await resolveProject(project);
    const targetProvider = provider || DEFAULT_PROVIDER;
    const agent = await api("/api/agents", {
      method: "POST",
      body: {
        provider: targetProvider,
        cwd,
        project: label,
        title: title || label,
        model,
        permissionMode: permissionMode(targetProvider),
        message: task,
      },
    });
    return text(
      `Dispatched agent "${agent.title}" (id: ${agent.id}) in project ${label}. It is now working on the task. It will appear on the Fleet page; you can check on it with list_agents or give it more instructions with prompt_agent.`,
    );
  },
);

server.tool(
  "list_agents",
  "List all of Odin's worker agents and their current status (idle/working/error) and last activity.",
  {},
  async () => {
    const agents = await api("/api/agents");
    if (!agents.length) return text("No agents are currently dispatched.");
    const lines = agents.map(
      (a) => `• ${a.title} (${a.id}) — ${a.project} — ${a.status} — ${a.lastSummary}`,
    );
    return text(`Fleet (${agents.length}):\n${lines.join("\n")}`);
  },
);

server.tool(
  "prompt_agent",
  "Send a follow-up instruction to an existing worker agent (by id). The agent keeps its conversation context.",
  {
    id: z.string().describe("The agent id (from dispatch_agent or list_agents)"),
    message: z.string().describe("The follow-up instruction"),
  },
  async ({ id, message }) => {
    const agents = await api("/api/agents");
    const agent = agents.find((candidate) => candidate.id === id);
    if (!agent) throw new Error(`Agent ${id} was not found.`);
    if (!canControl(agent)) {
      throw new Error("This conversation cannot prompt an agent with a broader access mode.");
    }
    await api(`/api/agents/${encodeURIComponent(id)}/prompt`, { method: "POST", body: { message } });
    return text(`Sent to agent ${id}. It is now working on it.`);
  },
);

server.tool(
  "stop_agent",
  "Stop a worker agent's current run (by id).",
  { id: z.string().describe("The agent id") },
  async ({ id }) => {
    const r = await api(`/api/agents/${encodeURIComponent(id)}/stop`, { method: "POST" });
    return text(r.stopped ? `Stopped agent ${id}.` : `Agent ${id} was not running.`);
  },
);

await server.connect(new StdioServerTransport());
