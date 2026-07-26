import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureForge,
  writeMemory,
  readMemory,
  listMemorySlugs,
  appendDailyBullet,
  trashMemory,
} from "./forge.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "odin-brain-"));
  process.env.ODIN_BRAIN_DIR = dir;
});
afterEach(async () => {
  delete process.env.ODIN_BRAIN_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("ensureForge", () => {
  it("creates notes/, daily/, AGENTS.md, .gitignore idempotently", async () => {
    await ensureForge();
    await ensureForge(); // second call must not throw or clobber
    const entries = await readdir(dir);
    expect(entries).toContain("notes");
    expect(entries).toContain("daily");
    expect(entries).toContain("AGENTS.md");
    expect(entries).toContain(".gitignore");
  });
  it("does not overwrite an existing AGENTS.md", async () => {
    await ensureForge();
    const p = join(dir, "AGENTS.md");
    await writeFile(p, "MINE", "utf8");
    await ensureForge();
    expect(await readFile(p, "utf8")).toBe("MINE");
  });
  it("refuses a symlinked Forge subdirectory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "odin-brain-outside-"));
    try {
      await mkdir(outside, { recursive: true });
      await symlink(outside, join(dir, "notes"));
      await expect(ensureForge()).rejects.toThrow("Refusing non-directory private path");
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("write / read / list", () => {
  it("writes a memory and reads it back", async () => {
    const path = await writeMemory({
      slug: "alex-rivera",
      frontmatter: { title: "Alex Rivera", type: "person", pinned: true, tags: ["odin-memory"] },
      body: "# Alex Rivera\nA person.",
    });
    expect(path).toContain(join("notes", "alex-rivera.md"));
    const m = await readMemory("alex-rivera");
    expect(m?.frontmatter.type).toBe("person");
    expect(m?.body).toContain("A person.");
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it("lists slugs", async () => {
    await writeMemory({ slug: "a", frontmatter: { type: "fact" }, body: "x" });
    await writeMemory({ slug: "b", frontmatter: { type: "fact" }, body: "y" });
    const slugs = (await listMemorySlugs()).map((s) => s.slug).sort();
    expect(slugs).toEqual(["a", "b"]);
  });
  it("round-trips slugs containing Unicode combining marks", async () => {
    await writeMemory({ slug: "বাংলা", frontmatter: { type: "fact" }, body: "Unicode" });
    expect((await readMemory("বাংলা"))?.body).toContain("Unicode");
    expect((await listMemorySlugs()).map((memory) => memory.slug)).toContain("বাংলা");
  });
  it("returns null for a missing memory", async () => {
    expect(await readMemory("nope")).toBeNull();
  });
  it("rejects unsafe slugs before filesystem access", async () => {
    await expect(writeMemory({ slug: "../escape", frontmatter: {}, body: "x" })).rejects.toThrow(
      "Invalid memory slug",
    );
    expect(await readMemory("../escape")).toBeNull();
    expect(await trashMemory("../escape")).toBe(false);
  });
});

describe("appendDailyBullet", () => {
  it("creates the daily note and appends without duplicating", async () => {
    await appendDailyBullet("2026-07-15", "- learned X");
    await appendDailyBullet("2026-07-15", "- learned X"); // dup ignored
    await appendDailyBullet("2026-07-15", "- learned Y");
    const raw = await readFile(join(dir, "daily", "2026-07-15.md"), "utf8");
    expect(raw.match(/learned X/g)?.length).toBe(1);
    expect(raw).toContain("learned Y");
  });
});

describe("trashMemory", () => {
  it("moves the note into .odin-trash and removes it from notes/", async () => {
    await writeMemory({ slug: "gone", frontmatter: { type: "fact" }, body: "z" });
    expect(await trashMemory("gone")).toBe(true);
    expect(await readMemory("gone")).toBeNull();
    const trash = await readdir(join(dir, ".odin-trash"));
    expect(trash.some((f) => f.startsWith("gone"))).toBe(true);
  });
  it("returns false when the note is absent", async () => {
    expect(await trashMemory("absent")).toBe(false);
  });
  it("refuses a path-traversal slug", async () => {
    await writeFile(join(dir, "outside.md"), "secret", "utf8");
    expect(await trashMemory("../outside")).toBe(false);
    expect(await readFile(join(dir, "outside.md"), "utf8")).toBe("secret");
  });
});
