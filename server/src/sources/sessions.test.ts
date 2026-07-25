import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLatest } from "./sessions.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "odin-sess-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write a minimal Claude-style JSONL transcript. */
async function writeJsonl(lines: object[]): Promise<string> {
  const path = join(dir, "s.jsonl");
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return path;
}

describe("parseLatest", () => {
  it("extracts the latest user prompt and the most-recent activity (tool last)", async () => {
    const path = await writeJsonl([
      { type: "user", message: { content: "fix the login bug" } },
      { type: "assistant", message: { content: [{ type: "text", text: "Looking at auth.ts" }] } },
      { type: "user", message: { content: "now run the tests" } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } },
    ]);
    const r = await parseLatest(path);
    expect(r.userText).toBe("now run the tests");
    expect(r.nowIsTool).toBe(true);
    expect(r.nowTool).toEqual({ name: "Bash", hint: "npm test" });
  });
  it("reports text as the latest activity when text comes last", async () => {
    const path = await writeJsonl([
      { type: "user", message: { content: "hi" } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a/b.ts" } }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "Done — all good." }] } },
    ]);
    const r = await parseLatest(path);
    expect(r.nowIsTool).toBe(false);
    expect(r.nowText).toBe("Done — all good.");
  });
  it("ignores tool_result user echoes when picking the user prompt", async () => {
    const path = await writeJsonl([
      { type: "user", message: { content: "real prompt" } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x" }] } },
    ]);
    const r = await parseLatest(path);
    expect(r.userText).toBe("real prompt");
  });
});
