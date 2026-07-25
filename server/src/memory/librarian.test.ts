import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseCandidates,
  writeCandidates,
  redactSecrets,
  parseLibrarianOutput,
} from "./librarian.js";
import { writeMemory } from "./forge.js";
import { brain } from "../sources/brain.js";

const CONV = { userMessage: "", assistantText: "", cwd: "", sessionId: "s", kind: "converse" } as const;

describe("parseCandidates", () => {
  it("extracts a JSON array even with surrounding prose", () => {
    const out = 'Sure!\n[{"type":"fact","title":"T","body":"B","pinned":false}]\nDone.';
    const cs = parseCandidates(out);
    expect(cs).toHaveLength(1);
    expect(cs[0].title).toBe("T");
  });
  it("drops malformed entries", () => {
    const out = '[{"title":"Missing type"},{"type":"fact","title":"OK","body":"x"}]';
    expect(parseCandidates(out).map((c) => c.title)).toEqual(["OK"]);
  });
  it("returns [] on non-JSON", () => {
    expect(parseCandidates("no json here")).toEqual([]);
  });
});

describe("redactSecrets", () => {
  it("masks common secret shapes", () => {
    expect(redactSecrets("key sk-abcdefghijklmnopqrstuvwx")).toContain("[REDACTED]");
    expect(redactSecrets("token=supersecretvalue123")).toContain("[REDACTED]");
    expect(redactSecrets("Authorization: Bearer abcdef123456")).toContain("[REDACTED]");
    expect(redactSecrets("ghp_0123456789abcdefghijklmnopqrstuvwx")).toContain("[REDACTED]");
  });
  it("leaves ordinary text alone", () => {
    expect(redactSecrets("Alex prefers dark mode")).toBe("Alex prefers dark mode");
  });
});

describe("parseLibrarianOutput", () => {
  it("parses an object with memories and skills", () => {
    const out =
      'ok {"memories":[{"type":"fact","title":"T","body":"B"}],"skills":[{"name":"Deploy","description":"d","steps":["a","b"]}]} done';
    const r = parseLibrarianOutput(out);
    expect(r.memories.map((m) => m.title)).toEqual(["T"]);
    expect(r.skills.map((s) => s.name)).toEqual(["Deploy"]);
  });
  it("treats a bare array as memories (backward compatible)", () => {
    const r = parseLibrarianOutput('[{"type":"fact","title":"T","body":"B"}]');
    expect(r.memories).toHaveLength(1);
    expect(r.skills).toEqual([]);
  });
  it("drops malformed skills (missing steps)", () => {
    const r = parseLibrarianOutput('{"memories":[],"skills":[{"name":"X","description":"d"}]}');
    expect(r.skills).toEqual([]);
  });
  it("caps skill name, step length, and step count", () => {
    const longName = "n".repeat(200);
    const longStep = "s".repeat(500);
    const manySteps = Array.from({ length: 30 }, () => longStep);
    const r = parseLibrarianOutput(
      JSON.stringify({ memories: [], skills: [{ name: longName, description: "d", steps: manySteps }] }),
    );
    expect(r.skills[0].name.length).toBe(80);
    expect(r.skills[0].steps.length).toBe(12);
    expect(r.skills[0].steps[0].length).toBe(200);
  });
});

describe("writeCandidates", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "odin-lib-"));
    process.env.ODIN_BRAIN_DIR = dir;
    brain.invalidate();
  });
  afterEach(async () => {
    delete process.env.ODIN_BRAIN_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a note and updates it on a second pass (same slug)", async () => {
    await writeCandidates([{ type: "fact", title: "Coffee order", body: "Flat white." }], {
      userMessage: "",
      assistantText: "",
      cwd: "",
      sessionId: "s1",
      kind: "converse",
    });
    brain.invalidate();
    let m = await brain.get("coffee-order");
    expect(m?.body).toContain("Flat white.");
    const created = m?.created;

    await writeCandidates(
      [{ type: "fact", title: "Coffee order", body: "Flat white, oat milk." }],
      { userMessage: "", assistantText: "", cwd: "", sessionId: "s2", kind: "converse" },
    );
    brain.invalidate();
    m = await brain.get("coffee-order");
    expect(m?.body).toContain("oat milk");
    expect(m?.created).toBe(created); // created preserved on update
  });

  it("refuses to overwrite a pinned or human-authored memory (injection guard)", async () => {
    await writeMemory({
      slug: "alex-rivera",
      frontmatter: { title: "Alex Rivera", type: "person", pinned: true, source: "manual" },
      body: "# Alex Rivera\nCanonical.",
    });
    brain.invalidate();
    await writeCandidates([{ type: "person", title: "Alex Rivera", body: "POISONED" }], CONV);
    brain.invalidate();
    const m = await brain.get("alex-rivera");
    expect(m?.body).toContain("Canonical.");
    expect(m?.body).not.toContain("POISONED");
    expect(m?.pinned).toBe(true);
  });

  it("refuses to overwrite a human note even when unpinned (source manual)", async () => {
    await writeMemory({
      slug: "preferences",
      frontmatter: { title: "Preferences", type: "reference", source: "manual" },
      body: "# Preferences\nMOC.",
    });
    brain.invalidate();
    await writeCandidates([{ type: "preference", title: "Preferences", body: "OVERWRITE" }], CONV);
    brain.invalidate();
    expect((await brain.get("preferences"))?.body).toContain("MOC.");
  });

  it("never pins an auto-written memory", async () => {
    await writeCandidates([{ type: "fact", title: "New Fact", body: "x", pinned: true }], CONV);
    brain.invalidate();
    expect((await brain.get("new-fact"))?.pinned).toBe(false);
  });
});
