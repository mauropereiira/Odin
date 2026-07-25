import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMemory } from "./forge.js";
import { brain } from "../sources/brain.js";
import { rankMemories, buildRecallBlock } from "./recall.js";
import type { Memory } from "../types.js";

function mem(p: Partial<Memory>): Memory {
  return {
    slug: p.slug ?? "x",
    title: p.title ?? "X",
    type: p.type ?? "fact",
    body: p.body ?? "",
    excerpt: p.excerpt ?? "",
    created: p.created ?? null,
    updated: p.updated ?? null,
    source: null,
    session: null,
    pinned: p.pinned ?? false,
    tags: p.tags ?? [],
    links: [],
    color: null,
  };
}

describe("rankMemories", () => {
  it("orders pinned > project > keyword > recency", () => {
    const pinned = mem({ slug: "pin", title: "Pinned", pinned: true });
    const proj = mem({ slug: "proj", title: "Proj", tags: ["project-os"] });
    const kw = mem({ slug: "kw", title: "Deployment guide", body: "deployment steps" });
    const recent = mem({ slug: "recent", title: "Recent", updated: "2026-07-15T10:00:00Z" });
    const ranked = rankMemories([recent, kw, proj, pinned], {
      message: "how do I do a deployment",
      project: "os",
      kind: "converse",
    });
    expect(ranked[0].slug).toBe("pin");
    const idx = (s: string) => ranked.findIndex((m) => m.slug === s);
    expect(idx("proj")).toBeLessThan(idx("recent"));
    expect(ranked.map((m) => m.slug)).toContain("kw");
  });
});

describe("buildRecallBlock", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "odin-recall-"));
    process.env.ODIN_BRAIN_DIR = dir;
    brain.invalidate();
  });
  afterEach(async () => {
    delete process.env.ODIN_BRAIN_DIR;
    delete process.env.ODIN_BRAIN_RECALL;
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty string when there are no memories", async () => {
    expect(await buildRecallBlock({ message: "hi", kind: "converse" })).toBe("");
  });
  it("includes pinned memories in the block", async () => {
    await writeMemory({
      slug: "alex-rivera",
      frontmatter: { title: "Alex Rivera", type: "person", pinned: true },
      body: "# Alex Rivera\nThe operator.",
    });
    const block = await buildRecallBlock({ message: "who am I", kind: "converse" });
    expect(block).toContain("Odin's memory");
    expect(block).toContain("Alex Rivera");
  });
  it("is disabled by ODIN_BRAIN_RECALL=0", async () => {
    process.env.ODIN_BRAIN_RECALL = "0";
    await writeMemory({
      slug: "x",
      frontmatter: { title: "X", type: "fact", pinned: true },
      body: "# X\nbody",
    });
    expect(await buildRecallBlock({ message: "x", kind: "converse" })).toBe("");
  });
});
