import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendConverseRecord,
  createConverseSession,
  getConverseSession,
  recordConverseSession,
  readConverseRecords,
  listConverseSessions,
  removeConverseSession,
} from "./converse.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "odin-converse-"));
  process.env.ODIN_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.ODIN_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("converse registry", () => {
  it("inserts a session with a title from the first message", async () => {
    await recordConverseSession({
      id: "s1",
      message: "Help me refactor the auth code please",
      cwd: "/x",
      project: "x",
    });
    const list = await listConverseSessions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("s1");
    expect(list[0].title).toBe("Help me refactor the auth code please");
  });
  it("keeps the original title and bumps updatedAt on later turns", async () => {
    await recordConverseSession({ id: "s1", message: "first message", cwd: "/x", project: "x" });
    const t1 = (await listConverseSessions())[0].updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await recordConverseSession({ id: "s1", message: "a much later follow-up", cwd: "/x", project: "x" });
    const s = (await listConverseSessions())[0];
    expect(s.title).toBe("first message");
    expect(s.updatedAt >= t1).toBe(true);
  });
  it("lists newest-updated first", async () => {
    await recordConverseSession({ id: "a", message: "a", cwd: "/x", project: "x" });
    await new Promise((r) => setTimeout(r, 5));
    await recordConverseSession({ id: "b", message: "b", cwd: "/x", project: "x" });
    expect((await listConverseSessions()).map((s) => s.id)).toEqual(["b", "a"]);
  });
  it("truncates long titles to 80 chars", async () => {
    await recordConverseSession({ id: "s", message: "x".repeat(200), cwd: "/x", project: "x" });
    expect((await listConverseSessions())[0].title.length).toBe(80);
  });
  it("removes by id and is resilient to a missing file", async () => {
    expect(await listConverseSessions()).toEqual([]);
    await recordConverseSession({ id: "s", message: "hi", cwd: "/x", project: "x" });
    expect(await removeConverseSession("s")).toBe(true);
    expect(await removeConverseSession("s")).toBe(false);
    expect(await listConverseSessions()).toEqual([]);
  });
  it("creates provider-owned conversations and persists normalized records", async () => {
    const session = await createConverseSession({
      provider: "codex",
      message: "Organize these ideas",
      cwd: "/x",
      project: "x",
      permissionMode: "read-only",
    });
    expect(session.id).not.toBe(session.nativeSessionId);
    expect((await getConverseSession(session.id))?.provider).toBe("codex");
    await appendConverseRecord(session.id, { kind: "user", text: "hello", at: "now" });
    await appendConverseRecord(session.id, {
      kind: "agent",
      at: "later",
      event: { runId: "r", provider: "codex", type: "text", text: "hi" },
    });
    expect(await readConverseRecords(session.id)).toHaveLength(2);
  });
  it("normalizes legacy registry entries as Claude sessions", async () => {
    await recordConverseSession({ id: "legacy", message: "old", cwd: "/x", project: "x" });
    const session = (await listConverseSessions())[0];
    expect(session.provider).toBe("claude-code");
    expect(session.nativeSessionId).toBe("legacy");
  });
  it("preserves a corrupt registry instead of overwriting it", async () => {
    const path = join(dir, "converse-sessions.json");
    await writeFile(path, "not json", "utf8");
    await expect(createConverseSession({
      provider: "codex",
      message: "hello",
      cwd: "/x",
      project: "x",
    })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("not json");
  });
  it("rejects traversal-like conversation ids", async () => {
    await recordConverseSession({ id: "../escape", message: "x", cwd: "/x", project: "x" });
    expect(await listConverseSessions()).toEqual([]);
    await expect(
      appendConverseRecord("../escape", { kind: "user", text: "x", at: "now" }),
    ).rejects.toThrow("Invalid conversation id");
    expect(await readConverseRecords("../escape")).toEqual([]);
    expect(await removeConverseSession("../escape")).toBe(false);
  });
  it("refuses a symlinked conversation directory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "odin-converse-outside-"));
    try {
      await symlink(outside, join(dir, "conversations"));
      await expect(
        appendConverseRecord("safe-id", { kind: "user", text: "x", at: "now" }),
      ).rejects.toThrow("Refusing non-directory private path");
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
