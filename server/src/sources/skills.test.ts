import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skills } from "./skills.js";

let claude: string;
let odin: string;
beforeEach(async () => {
  claude = await mkdtemp(join(tmpdir(), "odin-claude-"));
  odin = await mkdtemp(join(tmpdir(), "odin-skills-"));
  process.env.HELM_CLAUDE_DIR = claude;
  process.env.ODIN_SKILLS_DIR = odin;
  skills.invalidate();
});
afterEach(async () => {
  delete process.env.HELM_CLAUDE_DIR;
  delete process.env.ODIN_SKILLS_DIR;
  await rm(claude, { recursive: true, force: true });
  await rm(odin, { recursive: true, force: true });
});

async function seedPlugin() {
  const base = join(claude, "plugins");
  await mkdir(base, { recursive: true });
  await writeFile(
    join(base, "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "superpowers@claude-plugins-official": [
          {
            scope: "user",
            installPath: join(base, "cache", "sp"),
            version: "6.1.1",
            installedAt: "2026-01-19T20:25:25.842Z",
          },
        ],
      },
    }),
    "utf8",
  );
  const skillDir = join(base, "cache", "sp", "skills", "systematic-debugging");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: systematic-debugging\ndescription: Use when debugging\n---\n# Systematic Debugging\nbody",
    "utf8",
  );
}

async function seedForged() {
  const active = join(odin, "skills", "deploy-web");
  await mkdir(active, { recursive: true });
  await writeFile(
    join(active, "SKILL.md"),
    "---\nname: deploy-web\ndescription: Deploy the web app\nforged: true\ncreated: 2026-07-16T10:00:00Z\nsource_session: s1\n---\n# Deploy web\n1. build",
    "utf8",
  );
  const staged = join(odin, "staged", "run-tests");
  await mkdir(staged, { recursive: true });
  await writeFile(
    join(staged, "SKILL.md"),
    "---\nname: run-tests\ndescription: Run the tests\nforged: true\ncreated: 2026-07-16T11:00:00Z\n---\n# Run tests\n1. npm test",
    "utf8",
  );
}

describe("skills source", () => {
  it("lists installed plugins and their skills", async () => {
    await seedPlugin();
    const r = await skills.report();
    expect(r.plugins.map((p) => p.name)).toContain("superpowers");
    const sp = r.plugins.find((p) => p.name === "superpowers")!;
    expect(sp.marketplace).toBe("claude-plugins-official");
    expect(sp.skillCount).toBe(1);
    expect(r.skills.find((s) => s.name === "systematic-debugging")?.description).toBe(
      "Use when debugging",
    );
  });
  it("includes forged skills with provenance + activation state", async () => {
    await seedForged();
    const r = await skills.report();
    const active = r.forged.find((s) => s.name === "deploy-web");
    expect(active?.forged).toBe(true);
    expect(active?.active).toBe(true);
    expect(active?.sourceSession).toBe("s1");
    const staged = r.forged.find((s) => s.name === "run-tests");
    expect(staged?.active).toBe(false);
    expect(r.stats.forged).toBe(2);
  });
  it("is resilient to a missing plugins file", async () => {
    const r = await skills.report();
    expect(r.plugins).toEqual([]);
    expect(r.skills).toEqual([]);
  });
});
