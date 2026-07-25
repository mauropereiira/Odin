import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, ProviderId } from "./providers/types.js";

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

function dataDir(): string {
  return process.env.ODIN_DATA_DIR || join(homedir(), ".odin");
}

function storePath(): string {
  return join(dataDir(), "converse-sessions.json");
}

function transcriptDir(): string {
  return join(dataDir(), "conversations");
}

function transcriptPath(id: string): string {
  return join(transcriptDir(), `${id}.jsonl`);
}

function normalizeSession(raw: unknown): ConverseSession | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const provider: ProviderId = value.provider === "codex" ? "codex" : "claude-code";
  return {
    id: value.id,
    provider,
    nativeSessionId:
      typeof value.nativeSessionId === "string"
        ? value.nativeSessionId
        : provider === "claude-code"
          ? value.id
          : null,
    title: typeof value.title === "string" && value.title ? value.title : "New chat",
    cwd: typeof value.cwd === "string" ? value.cwd : "",
    project: typeof value.project === "string" ? value.project : "",
    model: typeof value.model === "string" ? value.model : undefined,
    permissionMode:
      typeof value.permissionMode === "string" ? value.permissionMode : undefined,
    createdAt:
      typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  };
}

async function loadAll(): Promise<ConverseSession[]> {
  try {
    const raw = JSON.parse(await readFile(storePath(), "utf8")) as unknown;
    if (!Array.isArray(raw)) throw new Error("Conversation registry must be an array.");
    return raw.map(normalizeSession).filter((session): session is ConverseSession => Boolean(session));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

let metadataWrite = Promise.resolve();
function mutateAll(
  mutate: (sessions: ConverseSession[]) => void | boolean,
): Promise<ConverseSession[]> {
  const operation = metadataWrite.then(async () => {
    const sessions = await loadAll();
    mutate(sessions);
    await mkdir(dataDir(), { recursive: true, mode: 0o700 });
    await chmod(dataDir(), 0o700);
    const temp = `${storePath()}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(sessions, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temp, storePath());
    await chmod(storePath(), 0o600);
    return sessions;
  });
  metadataWrite = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export async function createConverseSession(input: {
  provider: ProviderId;
  message: string;
  cwd: string;
  project: string;
  model?: string;
  permissionMode?: string;
}): Promise<ConverseSession> {
  const now = new Date().toISOString();
  const session: ConverseSession = {
    id: randomUUID(),
    provider: input.provider,
    nativeSessionId: null,
    title: input.message.trim().slice(0, 80) || "New chat",
    cwd: input.cwd,
    project: input.project,
    model: input.model,
    permissionMode: input.permissionMode,
    createdAt: now,
    updatedAt: now,
  };
  await mutateAll((sessions) => {
    sessions.push(session);
  });
  return session;
}

/** Legacy-compatible upsert used by migration tests and older callers. */
export async function recordConverseSession(input: {
  id: string;
  provider?: ProviderId;
  nativeSessionId?: string | null;
  message: string;
  cwd: string;
  project: string;
  model?: string;
  permissionMode?: string;
}): Promise<void> {
  if (!input.id) return;
  await mutateAll((sessions) => {
    const now = new Date().toISOString();
    const existing = sessions.find((session) => session.id === input.id);
    if (existing) {
      existing.updatedAt = now;
      existing.nativeSessionId = input.nativeSessionId ?? existing.nativeSessionId;
      existing.model = input.model ?? existing.model;
      existing.permissionMode = input.permissionMode ?? existing.permissionMode;
      return;
    }
    const provider = input.provider ?? "claude-code";
    sessions.push({
      id: input.id,
      provider,
      nativeSessionId: input.nativeSessionId ?? (provider === "claude-code" ? input.id : null),
      title: input.message.trim().slice(0, 80) || "New chat",
      cwd: input.cwd,
      project: input.project,
      model: input.model,
      permissionMode: input.permissionMode,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export async function updateConverseSession(
  id: string,
  patch: Partial<Pick<ConverseSession, "nativeSessionId" | "model" | "permissionMode">>,
): Promise<void> {
  await mutateAll((sessions) => {
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session) return;
    if (patch.nativeSessionId !== undefined) session.nativeSessionId = patch.nativeSessionId;
    if (patch.model !== undefined) session.model = patch.model;
    if (patch.permissionMode !== undefined) session.permissionMode = patch.permissionMode;
    session.updatedAt = new Date().toISOString();
  });
}

export async function getConverseSession(id: string): Promise<ConverseSession | null> {
  await metadataWrite;
  return (await loadAll()).find((session) => session.id === id) ?? null;
}

export async function listConverseSessions(): Promise<ConverseSession[]> {
  await metadataWrite;
  return (await loadAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const transcriptWrites = new Map<string, Promise<void>>();
const deletedConversations = new Set<string>();
export function appendConverseRecord(id: string, record: ConverseRecord): Promise<void> {
  if (deletedConversations.has(id)) return Promise.reject(new Error("Conversation was deleted."));
  const previous = transcriptWrites.get(id) ?? Promise.resolve();
  const operation = previous.then(async () => {
    if (deletedConversations.has(id)) throw new Error("Conversation was deleted.");
    await mkdir(transcriptDir(), { recursive: true, mode: 0o700 });
    await chmod(transcriptDir(), 0o700);
    await appendFile(transcriptPath(id), `${JSON.stringify(limitValue(record, 0))}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(transcriptPath(id), 0o600);
  });
  const tracked = operation.catch(() => undefined).finally(() => {
    if (transcriptWrites.get(id) === tracked) transcriptWrites.delete(id);
  });
  transcriptWrites.set(id, tracked);
  return operation;
}

export async function readConverseRecords(id: string): Promise<ConverseRecord[]> {
  try {
    await transcriptWrites.get(id);
    const records: ConverseRecord[] = [];
    for (const line of (await readFile(transcriptPath(id), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as ConverseRecord;
        if (record?.kind === "user" || record?.kind === "agent") records.push(record);
      } catch {
        // Keep valid records before a truncated final line.
      }
    }
    return records;
  } catch {
    return [];
  }
}

export async function removeConverseSession(id: string): Promise<boolean> {
  let removed = false;
  await mutateAll((sessions) => {
    const index = sessions.findIndex((session) => session.id === id);
    if (index >= 0) {
      sessions.splice(index, 1);
      removed = true;
    }
  });
  if (removed) {
    deletedConversations.add(id);
    await transcriptWrites.get(id);
    await rm(transcriptPath(id), { force: true });
  }
  return removed;
}

export async function flushConversePersistence(): Promise<void> {
  await metadataWrite;
  await Promise.all([...transcriptWrites.values()]);
}

function limitValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.slice(0, 100_000);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => limitValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    out[key] = limitValue(item, depth + 1);
  }
  return out;
}
