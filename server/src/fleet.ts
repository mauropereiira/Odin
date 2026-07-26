import { statSync } from "node:fs";
import { rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { startConversation, stopConversation, type AgentEvent } from "./runner.js";
import type { ProviderId } from "./providers/types.js";
import { buildRecallBlock } from "./memory/recall.js";
import {
  ensurePrivateDirectory,
  readPrivateTextFile,
  writePrivateTextFile,
} from "./private-file.js";

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

export class FleetError extends Error {}

type Emit = (message: Record<string, unknown>) => void;
let emit: Emit = () => {};
export function setFleetEmit(fn: Emit): void {
  emit = fn;
}

const agents = new Map<string, AgentInfo>();
const nowISO = () => new Date().toISOString();

function dataPath(): string {
  const root = process.env.ODIN_DATA_DIR || join(homedir(), ".odin");
  return join(root, "fleet.json");
}

let persistQueue = Promise.resolve();
let persistError: unknown = null;
function persistFleet(): Promise<void> {
  const snapshot = [...agents.values()].map((agent) => ({
    ...agent,
    status: agent.status === "working" ? "idle" : agent.status,
    lastRunId: null,
  }));
  const operation = persistQueue.then(async () => {
      const path = dataPath();
      await ensurePrivateDirectory(dirname(path));
      const temp = `${path}.${process.pid}.tmp`;
      await writePrivateTextFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`);
      await rename(temp, path);
    });
  persistQueue = operation.then(
    () => {
      persistError = null;
    },
    (error) => {
      persistError = error;
      console.error("Unable to persist Fleet state", error);
    },
  );
  return operation;
}

export async function initializeFleet(): Promise<void> {
  await ensurePrivateDirectory(dirname(dataPath()));
  try {
    const stored = await readPrivateTextFile(dataPath());
    if (!stored) return;
    const parsed = JSON.parse(stored.contents) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Fleet state must be an array.");
    for (const raw of parsed) {
      if (!raw || typeof raw !== "object") continue;
      const value = raw as Partial<AgentInfo>;
      if (!value.id || !value.cwd || !value.title) continue;
      agents.set(value.id, {
        id: value.id,
        provider: value.provider === "codex" ? "codex" : "claude-code",
        title: value.title,
        cwd: value.cwd,
        project: value.project || basename(value.cwd),
        model: value.model,
        permissionMode: value.permissionMode,
        status: value.status === "error" ? "error" : "idle",
        sessionId: value.sessionId ?? null,
        createdAt: value.createdAt || nowISO(),
        lastActivity: value.lastActivity || nowISO(),
        lastRunId: null,
        lastSummary: value.lastSummary || "Ready for orders",
      });
    }
  } catch (error) {
    const backup = `${dataPath()}.corrupt-${Date.now()}`;
    await rename(dataPath(), backup).catch(() => undefined);
    console.error(`Unable to load Fleet state; preserved it at ${backup}`, error);
  }
}

export function listAgents(): AgentInfo[] {
  return [...agents.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export async function createAgent(options: {
  provider?: ProviderId;
  cwd: string;
  project?: string;
  title?: string;
  model?: string;
  permissionMode?: string;
}): Promise<AgentInfo> {
  const cwd = (options.cwd || "").trim();
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new FleetError(`Working directory not found: ${cwd || "(empty)"}`);
  }
  const project = options.project?.trim() || basename(cwd) || cwd;
  const timestamp = nowISO();
  const agent: AgentInfo = {
    id: `agent_${randomUUID()}`,
    provider: options.provider ?? "claude-code",
    title: options.title?.trim().slice(0, 120) || project,
    cwd,
    project,
    model: options.model,
    permissionMode: options.permissionMode,
    status: "idle",
    sessionId: null,
    createdAt: timestamp,
    lastActivity: timestamp,
    lastRunId: null,
    lastSummary: "Ready for orders",
  };
  agents.set(agent.id, agent);
  try {
    await persistFleet();
  } catch (error) {
    agents.delete(agent.id);
    throw new FleetError(
      `Unable to persist Fleet agent: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  emit({ type: "created", agentId: agent.id, agent });
  return agent;
}

export async function promptAgent(id: string, message: string): Promise<{ runId: string }> {
  const agent = agents.get(id);
  if (!agent) throw new FleetError("Agent not found.");
  if (!message?.trim()) throw new FleetError("Message is empty.");
  if (agent.lastRunId) throw new FleetError("Agent is already working.");

  agent.status = "working";
  const reservation = `starting_${randomUUID()}`;
  agent.lastRunId = reservation;
  agent.lastSummary = "Preparing context...";
  agent.lastActivity = nowISO();
  try {
    try {
      await persistFleet();
    } catch (error) {
      throw new FleetError(
        `Unable to persist Fleet agent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    emit({
      type: "status",
      agentId: id,
      provider: agent.provider,
      status: agent.status,
      lastSummary: agent.lastSummary,
    });
    const recall = await buildRecallBlock({ message, project: agent.project, kind: "fleet" });
    if (agents.get(id) !== agent || agent.lastRunId !== reservation) {
      throw new FleetError("Agent was removed before its run started.");
    }
    const { runId } = startConversation(
      {
        provider: agent.provider,
        message,
        cwd: agent.cwd,
        model: agent.model,
        permissionMode: agent.permissionMode,
        resumeSessionId: agent.sessionId ?? undefined,
        recall,
        project: agent.project,
      },
      (event) => handleEvent(agent, event),
    );
    agent.status = "working";
    agent.lastRunId = runId;
    agent.lastSummary = "Working...";
    agent.lastActivity = nowISO();
    try {
      await persistFleet();
    } catch (error) {
      throw new FleetError(
        `Unable to persist Fleet agent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    emit({
      type: "status",
      agentId: id,
      provider: agent.provider,
      status: agent.status,
      lastSummary: agent.lastSummary,
      runId,
    });
    return { runId };
  } catch (error) {
    if (agents.get(id) === agent) {
      if (agent.lastRunId && !agent.lastRunId.startsWith("starting_")) {
        stopConversation(agent.lastRunId);
      }
      agent.status = "error";
      agent.lastRunId = null;
      agent.lastSummary = error instanceof Error ? error.message : "Unable to start agent.";
      agent.lastActivity = nowISO();
      void persistFleet().catch(() => undefined);
    }
    throw error instanceof FleetError
      ? error
      : new FleetError(error instanceof Error ? error.message : "Unable to start agent.");
  }
}

export function stopAgent(id: string): boolean {
  const agent = agents.get(id);
  if (!agent?.lastRunId) return false;
  const stopped = stopConversation(agent.lastRunId);
  if (stopped) {
    agent.lastSummary = "Stopping...";
    agent.lastActivity = nowISO();
    emit({ type: "status", agentId: id, status: agent.status, lastSummary: agent.lastSummary });
  }
  return stopped;
}

export async function removeAgent(id: string): Promise<boolean> {
  const agent = agents.get(id);
  if (!agent) return false;
  if (agent.lastRunId) return false;
  agents.delete(id);
  try {
    await persistFleet();
  } catch (error) {
    agents.set(id, agent);
    throw new FleetError(
      `Unable to persist Fleet removal: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  emit({ type: "removed", agentId: id });
  return true;
}

export async function flushFleetPersistence(): Promise<void> {
  await persistQueue;
  if (persistError) throw persistError;
}

function handleEvent(agent: AgentInfo, event: AgentEvent): void {
  if (agent.lastRunId && event.runId !== agent.lastRunId && event.type !== "start") return;
  switch (event.type) {
    case "init":
      if (typeof event.sessionId === "string") agent.sessionId = event.sessionId;
      break;
    case "text":
      if (typeof event.text === "string" && event.text.trim()) {
        agent.lastSummary = event.text.replace(/\s+/g, " ").trim().slice(0, 240);
      }
      break;
    case "tool_use":
      agent.lastSummary = `> ${String(event.name)}${toolHint(event.input)}`;
      break;
    case "result":
      if (typeof event.sessionId === "string") agent.sessionId = event.sessionId;
      if (event.ok === false) agent.status = "error";
      break;
    case "error":
      agent.status = "error";
      if (typeof event.message === "string") agent.lastSummary = event.message.slice(0, 240);
      break;
    case "exit":
      if (agent.status !== "error") agent.status = "idle";
      agent.lastRunId = null;
      break;
  }
  agent.lastActivity = nowISO();
  if (event.type === "init" || event.type === "result" || event.type === "error" || event.type === "exit") {
    void persistFleet().catch((error) => {
      if (agents.get(agent.id) !== agent) return;
      agent.status = "error";
      agent.lastSummary = `Unable to persist Fleet state: ${error instanceof Error ? error.message : String(error)}`.slice(0, 240);
      emit({
        type: "error",
        agentId: agent.id,
        provider: agent.provider,
        status: agent.status,
        message: agent.lastSummary,
      });
    });
  }
  emit({ ...event, agentId: agent.id, status: agent.status });
}

function toolHint(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const value = input as Record<string, unknown>;
  const hint =
    (typeof value.command === "string" && value.command) ||
    (typeof value.file_path === "string" && basename(value.file_path)) ||
    (typeof value.path === "string" && basename(value.path)) ||
    (typeof value.pattern === "string" && value.pattern) ||
    (typeof value.description === "string" && value.description) ||
    "";
  return hint ? ` ${String(hint).slice(0, 100)}` : "";
}
