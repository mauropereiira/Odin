import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMemory } from "../memory/forge.js";
import { brain } from "./brain.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "odin-brain-src-"));
  process.env.ODIN_BRAIN_DIR = dir;
  brain.invalidate();
});
afterEach(async () => {
  delete process.env.ODIN_BRAIN_DIR;
  await rm(dir, { recursive: true, force: true });
});

async function seed() {
  await writeMemory({
    slug: "alex-rivera",
    frontmatter: {
      title: "Alex Rivera",
      type: "person",
      pinned: true,
      tags: ["odin-memory"],
      updated: "2026-07-15T10:00:00Z",
    },
    body: "# Alex Rivera\nOperator of [[Odin]].",
  });
  await writeMemory({
    slug: "odin",
    frontmatter: {
      title: "Odin",
      type: "project",
      tags: ["odin-memory"],
      updated: "2026-07-14T10:00:00Z",
    },
    body: "# Odin\nA control center.",
  });
}

describe("brain source", () => {
  it("lists memories parsed into DTOs", async () => {
    await seed();
    const list = await brain.list();
    const operator = list.find((m) => m.slug === "alex-rivera");
    expect(operator?.title).toBe("Alex Rivera");
    expect(operator?.type).toBe("person");
    expect(operator?.pinned).toBe(true);
    expect(operator?.links).toEqual(["odin"]);
    expect(operator?.excerpt.length).toBeGreaterThan(0);
  });
  it("gets one by slug", async () => {
    await seed();
    expect((await brain.get("odin"))?.title).toBe("Odin");
    expect(await brain.get("missing")).toBeNull();
  });
  it("searches title and body case-insensitively", async () => {
    await seed();
    expect((await brain.search("control")).map((m) => m.slug)).toEqual(["odin"]);
    expect((await brain.search("alex")).map((m) => m.slug)).toEqual(["alex-rivera"]);
  });
  it("builds a graph with edges only to existing nodes", async () => {
    await seed();
    const g = await brain.graph();
    expect(g.nodes.map((n) => n.slug).sort()).toEqual(["alex-rivera", "odin"]);
    expect(g.edges).toContainEqual({ from: "alex-rivera", to: "odin" });
  });
  it("computes stats", async () => {
    await seed();
    const s = await brain.stats();
    expect(s.total).toBe(2);
    expect(s.byType).toContainEqual({ type: "person", count: 1 });
  });
});
