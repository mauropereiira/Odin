import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendPrivateTextFile,
  ensurePrivateTextFile,
  hardenPrivateFile,
  readPrivateTextFile,
  updatePrivateTextFile,
  writePrivateTextFile,
} from "./private-file.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "odin-private-file-"));
  roots.push(path);
  return path;
}

describe("private files", () => {
  it("creates once without clobbering existing contents", async () => {
    const path = join(await root(), "state.json");
    await ensurePrivateTextFile(path, "first\n");
    await ensurePrivateTextFile(path, "second\n");
    expect(await readFile(path, "utf8")).toBe("first\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("hardens existing regular files", async () => {
    const path = join(await root(), "state.json");
    await writeFile(path, "existing\n", "utf8");
    await chmod(path, 0o644);
    expect(await hardenPrivateFile(path)).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("reads, replaces, appends, and updates through no-follow handles", async () => {
    const path = join(await root(), "state.json");
    await writePrivateTextFile(path, "first");
    await appendPrivateTextFile(path, " second");
    await updatePrivateTextFile(path, (current) => `${current} third`);
    expect((await readPrivateTextFile(path))?.contents).toBe("first second third");
  });

  it("refuses to follow symlinks", async () => {
    const dir = await root();
    const target = join(dir, "target");
    const link = join(dir, "link");
    await writeFile(target, "outside\n", "utf8");
    await chmod(target, 0o644);
    await symlink(target, link);
    await expect(ensurePrivateTextFile(link, "replacement\n")).rejects.toThrow();
    await expect(writePrivateTextFile(link, "replacement\n")).rejects.toThrow();
    await expect(appendPrivateTextFile(link, "replacement\n")).rejects.toThrow();
    await expect(updatePrivateTextFile(link, () => "replacement\n")).rejects.toThrow();
    await expect(readPrivateTextFile(link)).rejects.toThrow();
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toBe("outside\n");
    expect((await stat(target)).mode & 0o777).toBe(0o644);
  });
});
