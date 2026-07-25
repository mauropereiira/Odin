import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile, readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureOdinPlugin,
  writeForgedSkill,
  listForgedSlugs,
  activateSkill,
  deactivateSkill,
  deleteForgedSkill,
} from "./forge.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "odin-forge-"));
  process.env.ODIN_SKILLS_DIR = dir;
});
afterEach(async () => {
  delete process.env.ODIN_SKILLS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("ensureOdinPlugin", () => {
  it("writes a valid plugin manifest idempotently", async () => {
    await ensureOdinPlugin();
    await ensureOdinPlugin();
    const manifest = JSON.parse(await readFile(join(dir, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.name).toBe("odin-skills");
    expect(typeof manifest.description).toBe("string");
  });
});

describe("writeForgedSkill (stages new skills)", () => {
  it("writes a NEW skill to staged/<slug>/ — not loaded until activated", async () => {
    const path = await writeForgedSkill({
      name: "Deploy Web",
      description: "Deploy the web app",
      steps: ["build", "push"],
      sourceSession: "s1",
      project: "os",
    });
    expect(path).toContain(join("staged", "deploy-web", "SKILL.md"));
    const raw = await readFile(path as string, "utf8");
    expect(raw).toContain("name: deploy-web");
    expect(raw).toContain("forged: true");
    expect(raw).toContain("1. build");
    expect((await stat(join(dir, "staged", "deploy-web"))).mode & 0o777).toBe(0o700);
    expect((await stat(path as string)).mode & 0o777).toBe(0o600);
    expect(await listForgedSlugs()).toContainEqual({ slug: "deploy-web", active: false });
  });
  it("scrubs common URL forms from staged instructions", async () => {
    const path = await writeForgedSkill({
      name: "Safe links",
      description: "Read https://example.invalid and //cdn.example.invalid",
      steps: ["Open www.example.invalid/path"],
      sourceSession: "s1",
    });
    const raw = await readFile(path as string, "utf8");
    expect(raw).not.toContain("example.invalid");
    expect(raw.match(/\[link removed\]/g)?.length).toBe(3);
  });
  it("stages an update to an already-active skill (gate not bypassed)", async () => {
    await writeForgedSkill({ name: "X", description: "one", steps: ["a"], sourceSession: "s1" });
    await activateSkill("x");
    await writeForgedSkill({ name: "X", description: "two", steps: ["b"], sourceSession: "s2" });
    // Active still shows the version you vetted; the update waits in staging.
    expect(await readFile(join(dir, "skills", "x", "SKILL.md"), "utf8")).toContain("description: one");
    expect(await readFile(join(dir, "staged", "x", "SKILL.md"), "utf8")).toContain("description: two");
    const slugs = await listForgedSlugs();
    expect(slugs).toContainEqual({ slug: "x", active: true });
    expect(slugs).toContainEqual({ slug: "x", active: false });
  });
  it("refuses to forge/shadow a non-forged skill in the active dir", async () => {
    const d = join(dir, "skills", "manual");
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "SKILL.md"), "---\nname: manual\ndescription: hand\n---\n# Manual\nkeep", "utf8");
    const res = await writeForgedSkill({
      name: "manual",
      description: "auto",
      steps: ["x"],
      sourceSession: "s",
    });
    expect(res).toBeNull();
    expect(await readFile(join(d, "SKILL.md"), "utf8")).toContain("keep");
  });
});

describe("activateSkill / deactivateSkill", () => {
  it("activate moves staged → skills (now loadable)", async () => {
    await writeForgedSkill({ name: "Go", description: "d", steps: ["a"], sourceSession: "s" });
    expect(await activateSkill("go")).toBe(true);
    expect(existsSync(join(dir, "skills", "go", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "staged", "go"))).toBe(false);
    expect(await listForgedSlugs()).toContainEqual({ slug: "go", active: true });
  });
  it("deactivate moves skills → staged", async () => {
    await writeForgedSkill({ name: "Go", description: "d", steps: ["a"], sourceSession: "s" });
    await activateSkill("go");
    expect(await deactivateSkill("go")).toBe(true);
    expect(existsSync(join(dir, "staged", "go", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "skills", "go"))).toBe(false);
  });
  it("activate returns false for unknown or traversal slugs", async () => {
    expect(await activateSkill("nope")).toBe(false);
    expect(await activateSkill("../x")).toBe(false);
  });
  it("activate refuses to replace a non-forged active skill", async () => {
    // A hand-authored (non-forged) skill sits in the active dir.
    const active = join(dir, "skills", "keep");
    await mkdir(active, { recursive: true });
    await writeFile(join(active, "SKILL.md"), "---\nname: keep\ndescription: mine\n---\n# Keep\nkeep", "utf8");
    // A staged forged skill with the same slug must not clobber it on activate.
    const staged = join(dir, "staged", "keep");
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, "SKILL.md"), "---\nname: keep\ndescription: auto\nforged: true\n---\n# Keep\nx", "utf8");
    expect(await activateSkill("keep")).toBe(false);
    expect(await readFile(join(active, "SKILL.md"), "utf8")).toContain("mine");
  });
  it("refuses to deactivate a hand-authored skill", async () => {
    const active = join(dir, "skills", "manual");
    await mkdir(active, { recursive: true });
    await writeFile(join(active, "SKILL.md"), "---\nname: manual\n---\n# Keep", "utf8");
    expect(await deactivateSkill("manual")).toBe(false);
    expect(existsSync(join(active, "SKILL.md"))).toBe(true);
  });
});

describe("deleteForgedSkill", () => {
  it("deletes a staged skill", async () => {
    await writeForgedSkill({ name: "Gone", description: "d", steps: ["a"], sourceSession: "s" });
    expect(await deleteForgedSkill("gone")).toBe(true);
    expect(await listForgedSlugs()).not.toContainEqual({ slug: "gone", active: false });
  });
  it("deletes an active skill", async () => {
    await writeForgedSkill({ name: "Gone", description: "d", steps: ["a"], sourceSession: "s" });
    await activateSkill("gone");
    expect(await deleteForgedSkill("gone")).toBe(true);
    const trash = await readdir(join(dir, ".trash"));
    expect(trash.some((f) => f.startsWith("gone"))).toBe(true);
  });
  it("returns false when absent, and refuses traversal", async () => {
    expect(await deleteForgedSkill("nope")).toBe(false);
    await mkdir(join(dir, "outside"), { recursive: true });
    await writeFile(join(dir, "outside", "SKILL.md"), "secret", "utf8");
    expect(await deleteForgedSkill("../outside")).toBe(false);
    expect(await readFile(join(dir, "outside", "SKILL.md"), "utf8")).toBe("secret");
  });
  it("refuses to delete a hand-authored skill inside Odin's roots", async () => {
    const active = join(dir, "skills", "manual");
    await mkdir(active, { recursive: true });
    await writeFile(join(active, "SKILL.md"), "---\nname: manual\n---\n# Keep", "utf8");
    expect(await deleteForgedSkill("manual")).toBe(false);
    expect(existsSync(join(active, "SKILL.md"))).toBe(true);
  });
});
