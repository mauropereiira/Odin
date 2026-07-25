import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { z } from "zod";
import { sessions } from "./sources/sessions.js";
import { usage } from "./sources/usage.js";
import { mcp } from "./sources/mcp.js";
import { projects } from "./sources/projects.js";
import { plan } from "./sources/plan.js";
import { brain } from "./sources/brain.js";
import { skills } from "./sources/skills.js";
import { ensureForge, slugify, trashMemory, writeMemory } from "./memory/forge.js";
import { activateSkill, deactivateSkill, deleteForgedSkill, ensureOdinPlugin } from "./skills/forge.js";
import { buildRecallBlock } from "./memory/recall.js";
import {
  appendConverseRecord,
  createConverseSession,
  flushConversePersistence,
  getConverseSession,
  listConverseSessions,
  readConverseRecords,
  removeConverseSession,
  updateConverseSession,
} from "./converse.js";
import { startWatcher } from "./watcher.js";
import {
  ConverseError,
  listProviderCapabilities,
  setRememberHook,
  startConversation,
  stopAllConversations,
  stopConversation,
  validateConversation,
} from "./runner.js";
import type { AgentEvent } from "./runner.js";
import type { ProviderId } from "./runner.js";
import { moldaviteBin, notesForge } from "./providers/tools.js";
import { distill, stopLibrarians } from "./memory/librarian.js";
import {
  FleetError,
  createAgent,
  flushFleetPersistence,
  initializeFleet,
  listAgents,
  promptAgent,
  removeAgent,
  setFleetEmit,
  stopAgent,
} from "./fleet.js";
import type { ChangeEvent } from "./types.js";

const PORT = Number(process.env.HELM_PORT || 7420);
const CHECKOUT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");

/** Minimal structural view of the ws socket we actually use. */
interface Sock {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  close(): void;
  on(event: string, cb: () => void): void;
}

const app = Fastify({ logger: false });

/**
 * Loopback-only guard. Odin drives a real agent with tool access, so we must
 * ensure requests actually originate from this machine's browser — not from a
 * malicious page using DNS-rebinding (which defeats binding to 127.0.0.1 alone)
 * or a cross-origin fetch. We reject any request whose Host, or Origin when
 * present, is not a loopback address. Runs for the API and the WS upgrade.
 */
function isLoopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  let host = value.trim();
  if (host.startsWith("[")) {
    host = host.slice(1, host.indexOf("]")); // [::1]:7420 → ::1
  } else {
    const colon = host.lastIndexOf(":");
    if (colon !== -1 && host.indexOf(":") === colon) host = host.slice(0, colon);
  }
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

app.addHook("onRequest", async (req, reply) => {
  if (!isLoopbackHost(req.headers.host)) {
    return reply.code(403).send({ error: "Forbidden: non-loopback host" });
  }
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      ok = isLoopbackHost(new URL(origin).host);
    } catch {
      ok = false;
    }
    if (!ok) return reply.code(403).send({ error: "Forbidden: cross-origin request" });
  }
});

/**
 * A safe note/skill slug: our slugs are Unicode letters/numbers/hyphens only
 * (Moldavite's rule). This rejects path-traversal payloads (`..`, `/`, `\`, null
 * bytes, dots) before a slug is ever joined into a filesystem path.
 */
const SAFE_SLUG = /^[\p{L}\p{N}-]{1,128}$/u;
function isSafeSlug(slug: string): boolean {
  return SAFE_SLUG.test(slug);
}

await app.register(websocket);

/** Connected dashboard clients, for pushing live change events. */
const clients = new Set<Sock>();

/** Latest Claude subscription rate-limit snapshot, harvested from the stream. */
let latestRateLimit: unknown = null;
/** All rate-limit windows seen, keyed by type (e.g. "five_hour", "weekly"). */
const rateLimitsByType: Record<string, unknown> = {};

function broadcast(evt: ChangeEvent) {
  send({ kind: "change", ...evt });
}

/** Forward an agent event to all clients, capturing quota info as it flows by. */
function emitAgent(evt: Record<string, unknown>) {
  if (evt.type === "rate_limit" && evt.info) {
    latestRateLimit = evt.info;
    const info = evt.info as Record<string, unknown>;
    const type = typeof info.rateLimitType === "string" ? info.rateLimitType : "session";
    rateLimitsByType[type] = info;
  }
  send({ kind: "agent", ...evt });
}

function broadcastAgent(evt: AgentEvent) {
  emitAgent(evt);
}

// Fleet events flow through the same tagged agent channel.
setFleetEmit(emitAgent);

// After each completed turn, the librarian distills durable facts into the
// brain. Best-effort: a failure here must never break the conversation.
let rememberQueue = Promise.resolve();
setRememberHook((payload) => {
  rememberQueue = rememberQueue
    .then(() =>
      distill(payload, (source) => broadcast({ source, at: new Date().toISOString() })),
    )
    .then(() => undefined)
    .catch(() => undefined);
});

function send(message: object) {
  const payload = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

// --- Sources: invalidate caches when their files change --------------------
const sourceById: Record<string, { invalidate?: () => void }> = {
  sessions,
  usage,
  mcp,
  projects,
  brain,
  skills,
};

// Odin's brain lives in a Moldavite Forge; make sure it exists before we serve.
await ensureForge();
// Odin's forged-skills plugin — ensure it exists so --plugin-dir loads cleanly.
await ensureOdinPlugin();
await initializeFleet();

const watcher = startWatcher((evt) => {
  sourceById[evt.source]?.invalidate?.();
  broadcast(evt);
});

// --- REST API --------------------------------------------------------------
app.get("/api/health", async () => ({
  ok: true,
  service: "odin",
  port: PORT,
  instanceId: process.env.ODIN_INSTANCE_ID ?? null,
  checkoutRoot: CHECKOUT_ROOT,
}));

app.get("/api/providers", async () => listProviderCapabilities());

app.get("/api/capabilities", async () => {
  const [providers, skillsReport] = await Promise.all([
    listProviderCapabilities(),
    skills.report(),
  ]);
  return {
    providers: providers.map(({ id, label, available, authenticated }) => ({
      id,
      label,
      available,
      authenticated,
    })),
    brain: {
      persistent: true,
      recall: process.env.ODIN_BRAIN_RECALL !== "0",
      remember:
        process.env.ODIN_LIBRARIAN_ENABLED !== "0" &&
        process.env.ODIN_BRAIN_REMEMBER !== "0",
    },
    notes: {
      enabled: process.env.ODIN_NOTES_ENABLED !== "0",
      available: existsSync(moldaviteBin()),
      forge: notesForge(),
    },
    skills: {
      enabled: process.env.ODIN_SKILLS_ENABLED !== "0",
      active: skillsReport.forged.filter((skill) => skill.active).length,
    },
    conversations: { persistent: true },
    fleet: { persistent: true },
  };
});

app.get("/api/overview", async () => {
  const [s, u, m, p] = await Promise.all([
    sessions.summary(),
    usage.summary(),
    mcp.summary(),
    projects.summary(),
  ]);
  return {
    sessions: s,
    usage: u,
    mcp: m,
    projects: p,
    rateLimit: latestRateLimit,
    at: new Date().toISOString(),
  };
});

app.get("/api/ratelimit", async () => ({ rateLimit: latestRateLimit }));

app.get("/api/plan", async () => ({
  account: await plan.get(),
  rateLimits: rateLimitsByType,
}));

app.get("/api/sessions", async () => sessions.list());
app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
  const detail = await sessions.get(req.params.id);
  if (!detail) return reply.code(404).send({ error: "session not found" });
  return detail;
});

app.get("/api/sessions/live", async () => sessions.live());
app.get("/api/usage", async () => usage.report());
app.get("/api/mcp", async () => mcp.list());
app.get("/api/projects", async () => projects.list());

// --- Brain: Odin's memory, stored in a Moldavite Forge ---------------------
app.get("/api/brain", async () => brain.summary());
app.get("/api/brain/memories", async () => brain.list());
app.get("/api/brain/graph", async () => brain.graph());
app.get<{ Querystring: { q?: string } }>("/api/brain/search", async (req) =>
  brain.search(req.query.q ?? ""),
);
app.get<{ Params: { slug: string } }>("/api/brain/memories/:slug", async (req, reply) => {
  if (!isSafeSlug(req.params.slug)) return reply.code(400).send({ error: "invalid slug" });
  const m = await brain.get(req.params.slug);
  if (!m) return reply.code(404).send({ error: "memory not found" });
  return m;
});

const addMemoryBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  type: z.enum(["fact", "idea", "decision", "project", "preference", "person", "reference"]).default("fact"),
  body: z.string().max(20_000).default(""),
  pinned: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});
app.post<{ Body: unknown }>("/api/brain/memories", async (req, reply) => {
  const parsed = addMemoryBodySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid memory." });
  const body = parsed.data;
  const title = body.title;
  const slug = slugify(title);
  if (await brain.get(slug)) {
    return reply.code(409).send({ error: "A memory with this title already exists." });
  }
  const now = new Date().toISOString();
  await writeMemory({
    slug,
    frontmatter: {
      title,
      type: body.type,
      created: now,
      updated: now,
      source: "manual",
      pinned: body.pinned,
      tags: ["odin-memory", ...body.tags],
    },
    body: `# ${title}\n\n${body.body.trim()}`,
  });
  brain.invalidate();
  broadcast({ source: "brain", at: now });
  const created = await brain.get(slug);
  return reply.code(201).send(created);
});

app.delete<{ Params: { slug: string } }>("/api/brain/memories/:slug", async (req, reply) => {
  if (!isSafeSlug(req.params.slug)) return reply.code(400).send({ error: "invalid slug" });
  const removed = await trashMemory(req.params.slug);
  if (removed) {
    brain.invalidate();
    broadcast({ source: "brain", at: new Date().toISOString() });
  }
  return { removed };
});

// --- Skills & Plugins ------------------------------------------------------
app.get("/api/skills", async () => skills.report());

app.delete<{ Params: { slug: string } }>("/api/skills/forged/:slug", async (req, reply) => {
  if (!isSafeSlug(req.params.slug)) return reply.code(400).send({ error: "invalid slug" });
  const removed = await deleteForgedSkill(req.params.slug);
  if (removed) {
    skills.invalidate();
    broadcast({ source: "skills", at: new Date().toISOString() });
  }
  return { removed };
});

app.post<{ Params: { slug: string } }>("/api/skills/forged/:slug/activate", async (req, reply) => {
  if (!isSafeSlug(req.params.slug)) return reply.code(400).send({ error: "invalid slug" });
  const ok = await activateSkill(req.params.slug);
  if (ok) {
    skills.invalidate();
    broadcast({ source: "skills", at: new Date().toISOString() });
  }
  return { activated: ok };
});

app.post<{ Params: { slug: string } }>("/api/skills/forged/:slug/deactivate", async (req, reply) => {
  if (!isSafeSlug(req.params.slug)) return reply.code(400).send({ error: "invalid slug" });
  const ok = await deactivateSkill(req.params.slug);
  if (ok) {
    skills.invalidate();
    broadcast({ source: "skills", at: new Date().toISOString() });
  }
  return { deactivated: ok };
});

// --- Converse: provider-neutral Odin conversations --------------------------
const converseBodySchema = z.object({
  provider: z.enum(["claude-code", "codex"]).optional(),
  message: z.string().trim().min(1).max(100_000),
  cwd: z.string().min(1).max(4_096),
  model: z.string().max(100).optional(),
  permissionMode: z.string().max(100).optional(),
  conversationId: z.string().uuid().optional(),
  // Legacy clients sent the provider-native id directly.
  sessionId: z.string().max(200).optional(),
});
const activeConversations = new Map<string, string>();

app.post<{ Body: unknown }>("/api/converse", async (req, reply) => {
  const parsed = converseBodySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid conversation request." });
  const body = parsed.data;
  let created = false;
  let conversation = body.conversationId
    ? await getConverseSession(body.conversationId)
    : body.sessionId
      ? await getConverseSession(body.sessionId)
      : null;
  if (body.conversationId && !conversation) {
    return reply.code(404).send({ error: "Conversation not found." });
  }
  if (conversation && body.provider && body.provider !== conversation.provider) {
    return reply.code(409).send({ error: "A conversation cannot change providers after it starts." });
  }

  const provider: ProviderId = conversation?.provider ?? body.provider ?? "claude-code";
  const project = basename(body.cwd.replace(/\/$/, "")) || "Home";
  let startedRunId: string | null = null;
  let requestClosed = false;
  reply.raw.once("close", () => {
    if (reply.raw.writableEnded) return;
    requestClosed = true;
    if (startedRunId) stopConversation(startedRunId);
  });
  try {
    validateConversation({
      provider,
      message: body.message,
      cwd: body.cwd,
      model: body.model,
      permissionMode: body.permissionMode,
    });
    if (!conversation) {
      conversation = await createConverseSession({
        provider,
        message: body.message,
        cwd: body.cwd,
        project,
        model: body.model,
        permissionMode: body.permissionMode,
      });
      created = true;
    }
    if (activeConversations.has(conversation.id)) {
      return reply.code(409).send({ error: "This conversation is already running." });
    }
    const conversationId = conversation.id;
    activeConversations.set(conversationId, "starting");
    const recall = await buildRecallBlock({
      message: body.message,
      project,
      kind: "converse",
    });
    if (requestClosed) throw new ConverseError("Conversation request was cancelled.");
    let nativeSessionId = conversation.nativeSessionId;
    let recordsReady = false;
    let exitedBeforeRecords: string | null = null;
    const pendingRecords: Array<Parameters<typeof appendConverseRecord>[1]> = [];
    const emit = (evt: AgentEvent) => {
      broadcastAgent(evt);
      const record: Parameters<typeof appendConverseRecord>[1] = {
        kind: "agent",
        event: evt,
        at: new Date().toISOString(),
      };
      if (recordsReady) {
        void appendConverseRecord(conversationId, record)
          .catch((error) => console.error("Unable to persist conversation event", error));
      } else {
        pendingRecords.push(record);
      }
      if (typeof evt.sessionId === "string" && evt.sessionId !== nativeSessionId) {
        nativeSessionId = evt.sessionId;
        void updateConverseSession(conversationId, {
          nativeSessionId,
          model: body.model,
          permissionMode: body.permissionMode,
        })
          .then(() => broadcast({ source: "converse", at: new Date().toISOString() }))
          .catch((error) => console.error("Unable to persist conversation metadata", error));
      } else if (evt.type === "result" || evt.type === "exit") {
        void updateConverseSession(conversationId, {
          model: body.model,
          permissionMode: body.permissionMode,
        })
          .then(() => broadcast({ source: "converse", at: new Date().toISOString() }))
          .catch((error) => console.error("Unable to persist conversation metadata", error));
      }
      if (evt.type === "exit" && activeConversations.get(conversationId) === evt.runId) {
        if (recordsReady) activeConversations.delete(conversationId);
        else exitedBeforeRecords = evt.runId;
      }
    };

    const { runId } = startConversation(
      {
        provider,
        message: body.message,
        cwd: body.cwd,
        model: body.model,
        permissionMode: body.permissionMode,
        resumeSessionId: conversation.nativeSessionId ?? body.sessionId,
        orchestrator: true,
        recall,
        project,
      },
      emit,
    );
    startedRunId = runId;
    activeConversations.set(conversationId, runId);
    await appendConverseRecord(conversationId, {
      kind: "user",
      text: body.message,
      at: new Date().toISOString(),
    });
    recordsReady = true;
    for (const record of pendingRecords) {
      void appendConverseRecord(conversationId, record)
        .catch((error) => console.error("Unable to persist conversation event", error));
    }
    if (exitedBeforeRecords && activeConversations.get(conversationId) === exitedBeforeRecords) {
      activeConversations.delete(conversationId);
    }
    if (created) broadcast({ source: "converse", at: new Date().toISOString() });
    return { runId, conversationId };
  } catch (err) {
    if (startedRunId) stopConversation(startedRunId);
    if (conversation) activeConversations.delete(conversation.id);
    if (created && conversation) await removeConverseSession(conversation.id).catch(() => undefined);
    if (err instanceof ConverseError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.get("/api/converse/sessions", async () => listConverseSessions());
app.get<{ Params: { id: string } }>("/api/converse/sessions/:id", async (req, reply) => {
  const session = await getConverseSession(req.params.id);
  if (!session) return reply.code(404).send({ error: "conversation not found" });
  return { session, records: await readConverseRecords(session.id) };
});
app.delete<{ Params: { id: string } }>("/api/converse/sessions/:id", async (req, reply) => {
  if (activeConversations.has(req.params.id)) {
    return reply.code(409).send({ error: "Stop this conversation before deleting it." });
  }
  const removed = await removeConverseSession(req.params.id);
  if (removed) broadcast({ source: "converse", at: new Date().toISOString() });
  return { removed };
});

app.post<{ Params: { runId: string } }>("/api/converse/:runId/stop", async (req) => {
  return { stopped: stopConversation(req.params.runId) };
});

// --- Fleet: Odin's roster of managed agents --------------------------------
const createAgentBodySchema = z.object({
  provider: z.enum(["claude-code", "codex"]).default("claude-code"),
  cwd: z.string().min(1).max(4_096),
  project: z.string().max(200).optional(),
  title: z.string().max(120).optional(),
  model: z.string().max(100).optional(),
  permissionMode: z.string().max(100).optional(),
  message: z.string().max(100_000).optional(),
});
const promptAgentBodySchema = z.object({ message: z.string().min(1).max(100_000) });

app.get("/api/agents", async () => listAgents());

app.post<{ Body: unknown }>("/api/agents", async (req, reply) => {
  const parsed = createAgentBodySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid agent request." });
  const body = parsed.data;
  try {
    const agent = await createAgent({
      provider: body.provider,
      cwd: body.cwd ?? "",
      project: body.project,
      title: body.title,
      model: body.model,
      permissionMode: body.permissionMode,
    });
    // Optional first order — dispatch it immediately.
    if (body.message?.trim()) {
      try {
        await promptAgent(agent.id, body.message);
      } catch (error) {
        await removeAgent(agent.id).catch(() => false);
        throw error;
      }
    }
    return agent;
  } catch (err) {
    if (err instanceof FleetError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post<{ Params: { id: string }; Body: unknown }>(
  "/api/agents/:id/prompt",
    async (req, reply) => {
      const parsed = promptAgentBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "A message is required." });
      try {
        return await promptAgent(req.params.id, parsed.data.message);
    } catch (err) {
      if (err instanceof FleetError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  },
);

app.post<{ Params: { id: string } }>("/api/agents/:id/stop", async (req) => ({
  stopped: stopAgent(req.params.id),
}));

app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
  try {
    return { removed: await removeAgent(req.params.id) };
  } catch (err) {
    if (err instanceof FleetError) return reply.code(500).send({ error: err.message });
    throw err;
  }
});

// --- WebSocket: live change feed -------------------------------------------
app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket: Sock) => {
    clients.add(socket);
    socket.send(JSON.stringify({ kind: "hello", at: new Date().toISOString() }));
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });
});

// --- Serve the built web UI (production single-process mode) ----------------
// Resolves to <repo>/web/dist from both src (dev) and dist (prod). Absent in
// dev (no build) → skipped, so Vite's proxy keeps handling the UI there.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  // wildcard: true (the default) serves files dynamically from disk per request,
  // so a fresh `npm run build` is picked up without restarting the server.
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
      return reply.sendFile("index.html"); // SPA client routes (/brain, /skills, …)
    }
    return reply.code(404).send({ error: "not found" });
  });
  console.log(`ᛟ Serving web UI from ${webDist}`);
}

try {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  // eslint-disable-next-line no-console
  console.log(`ᛟ Odin server ready on http://127.0.0.1:${PORT}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopAllConversations();
  for (const socket of clients) socket.close();
  await watcher.close().catch(() => undefined);
  await app.close().catch(() => undefined);
  await Promise.race([
    rememberQueue,
    new Promise((resolve) => setTimeout(resolve, 1_500)),
  ]);
  stopLibrarians();
  await rememberQueue;
  await flushConversePersistence().catch((error) => console.error("Unable to flush conversations", error));
  await flushFleetPersistence().catch((error) => console.error("Unable to flush Fleet state", error));
}

function handleSignal(): void {
  const forceExit = setTimeout(() => process.exit(0), 6_000);
  forceExit.unref();
  void shutdown().finally(() => process.exit(0));
}

process.once("SIGTERM", handleSignal);
process.once("SIGINT", handleSignal);
