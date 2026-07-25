import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseNote } from "../memory/forge.js";
import { skillsRoot, stagedRoot } from "../skills/forge.js";
import type { InstalledPlugin, SkillInfo, SkillsReport } from "../types.js";

/**
 * Read-only view of the machine's Claude Code skills & plugins: installed
 * plugins (from installed_plugins.json), the skills each provides, and Odin's
 * own forged skills. Pure reads, mtime-cached like the other sources.
 */

function pluginsDir(): string {
  return join(process.env.HELM_CLAUDE_DIR || join(homedir(), ".claude"), "plugins");
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Find SKILL.md files under a dir (skills live at <dir>/skills/<name>/SKILL.md). */
async function findSkillFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name === "SKILL.md") out.push(p);
    }
  }
  await walk(root, 0);
  return out;
}

async function parseSkillFile(
  path: string,
  plugin: string,
  forged: boolean,
  active: boolean,
): Promise<SkillInfo | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const { frontmatter } = parseNote(raw);
  const name = str(frontmatter.name) ?? path.split("/").slice(-2, -1)[0] ?? "skill";
  const description = str(frontmatter.description) ?? "";
  return {
    name,
    description,
    plugin,
    forged,
    active,
    createdAt: str(frontmatter.created),
    sourceSession: str(frontmatter.source_session),
    project: str(frontmatter.project),
    path,
    content: raw.slice(0, 20_000),
  };
}

interface Cached {
  key: string;
  report: SkillsReport;
}
let cache: Cached | null = null;
let lastGood: SkillsReport | null = null;

async function cacheKey(): Promise<string> {
  // Cheap freshness key: mtimes of the two roots we read.
  const parts: string[] = [];
  for (const p of [join(pluginsDir(), "installed_plugins.json"), skillsRoot(), stagedRoot()]) {
    try {
      parts.push(`${p}:${(await stat(p)).mtimeMs}`);
    } catch {
      parts.push(`${p}:0`);
    }
  }
  return parts.join("|");
}

async function build(): Promise<SkillsReport> {
  const plugins: InstalledPlugin[] = [];
  const skillList: SkillInfo[] = [];

  let installed: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(
      await readFile(join(pluginsDir(), "installed_plugins.json"), "utf8"),
    ) as Record<string, unknown>;
    installed = (raw?.plugins as Record<string, unknown>) || {};
  } catch {
    installed = {};
  }

  for (const [key, valUnknown] of Object.entries(installed)) {
    const entry = Array.isArray(valUnknown) ? (valUnknown[0] as Record<string, unknown>) : null;
    if (!entry) continue;
    const at = key.lastIndexOf("@");
    const name = at > 0 ? key.slice(0, at) : key;
    const marketplace = at > 0 ? key.slice(at + 1) : "";
    const installPath = str(entry.installPath) ?? "";
    const files = installPath ? await findSkillFiles(installPath) : [];
    for (const f of files) {
      const s = await parseSkillFile(f, name, false, true);
      if (s) skillList.push(s);
    }
    plugins.push({
      key,
      name,
      marketplace,
      version: str(entry.version) ?? "unknown",
      scope: str(entry.scope) ?? "user",
      installPath,
      installedAt: str(entry.installedAt),
      skillCount: files.length,
    });
  }

  const forged: SkillInfo[] = [];
  for (const [root, active] of [
    [skillsRoot(), true],
    [stagedRoot(), false],
  ] as const) {
    for (const f of await findSkillFiles(root)) {
      const s = await parseSkillFile(f, "odin-forged", true, active);
      if (s) forged.push(s);
    }
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name));
  skillList.sort((a, b) => a.name.localeCompare(b.name));
  forged.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return {
    plugins,
    skills: skillList,
    forged,
    stats: { plugins: plugins.length, skills: skillList.length, forged: forged.length },
  };
}

export const skills = {
  id: "skills",
  async report(): Promise<SkillsReport> {
    try {
      const key = await cacheKey();
      if (cache?.key === key) return cache.report;
      const report = await build();
      cache = { key, report };
      lastGood = report;
      return report;
    } catch {
      return (
        lastGood ?? {
          plugins: [],
          skills: [],
          forged: [],
          stats: { plugins: 0, skills: 0, forged: 0 },
        }
      );
    }
  },
  invalidate() {
    cache = null;
  },
};
