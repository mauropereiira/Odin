import { chmod, readdir, rename, rm, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseNote, serializeNote, slugify } from "../memory/forge.js";
import {
  ensurePrivateDirectory,
  ensurePrivateTextFile,
  hardenPrivateFile,
  readPrivateTextFile,
  writePrivateTextFile,
} from "../private-file.js";
import { isSafeSlug } from "../validation.js";

/**
 * The forge — the only writer of Odin's own skills plugin. Forged skills are a
 * real Claude Code plugin (`.claude-plugin/plugin.json` + skills/<slug>/SKILL.md)
 * loaded into Odin's runs via --plugin-dir.
 *
 * Safety: newly-forged skills land in `staged/` (which --plugin-dir does NOT
 * load — only `skills/` is a plugin skills dir), so a model-authored skill can't
 * run until you activate it (move it into `skills/`). It never touches skills it
 * didn't forge (provenance: `forged: true`).
 */

export function odinSkillsDir(): string {
  return process.env.ODIN_SKILLS_DIR || join(homedir(), ".claude", "odin-skills");
}
/** Active (loaded) skills live here — this is the plugin's real skills dir. */
export function skillsRoot(): string {
  return join(odinSkillsDir(), "skills");
}
/** Staged (forged, not yet activated) skills — invisible to --plugin-dir. */
export function stagedRoot(): string {
  return join(odinSkillsDir(), "staged");
}

/** True iff `target` resolves to `base` or something inside it (anti-traversal). */
function contains(base: string, target: string): boolean {
  const b = resolve(base);
  const t = resolve(target);
  return t === b || t.startsWith(b + sep);
}

/**
 * Like `contains`, but follows symlinks via realpath — so a symlink planted
 * inside a root can't make a move/delete escape it. Both paths must exist.
 */
async function realContained(base: string, target: string): Promise<boolean> {
  try {
    const b = await realpath(base);
    const t = await realpath(target);
    return t === b || t.startsWith(b + sep);
  } catch {
    return false;
  }
}

/**
 * Minor cleanup: strip URLs from forged-skill text. NOT a security boundary —
 * the real controls are the activation gate (a staged skill can't run until you
 * approve it) and Odin's permission gating on tool use.
 */
function scrubUrls(text: string): string {
  return text.replace(/(?:\bhttps?:\/\/|\bwww\.|\/\/)[^\s<>()]+/gi, "[link removed]");
}

const MANIFEST = JSON.stringify(
  {
    name: "odin-skills",
    version: "0.1.0",
    description: "Skills Odin has forged from your conversations. Managed by the Odin dashboard.",
  },
  null,
  2,
);

export async function ensureOdinPlugin(): Promise<void> {
  await privateDir(odinSkillsDir());
  await privateDir(skillsRoot());
  await privateDir(stagedRoot());
  const manifestDir = join(odinSkillsDir(), ".claude-plugin");
  await privateDir(manifestDir);
  const manifest = join(manifestDir, "plugin.json");
  await ensurePrivateTextFile(manifest, `${MANIFEST}\n`);
  await Promise.all([hardenSkillRoot(skillsRoot()), hardenSkillRoot(stagedRoot())]);
}

async function privateDir(path: string): Promise<void> {
  await ensurePrivateDirectory(path);
}

async function hardenSkillRoot(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const file = join(dir, "SKILL.md");
    await chmod(dir, 0o700);
    await hardenPrivateFile(file);
  }
}

export interface ForgeSkillInput {
  name: string;
  description: string;
  steps: string[];
  sourceSession: string | null;
  project?: string;
}

/** True if a SKILL.md in `dir` exists and was NOT forged by us. */
async function isProtectedDir(dir: string): Promise<boolean> {
  const stored = await readPrivateTextFile(join(dir, "SKILL.md"));
  if (!stored) return false;
  const { frontmatter } = parseNote(stored.contents);
  return frontmatter.forged !== true;
}

async function isForgedDir(dir: string): Promise<boolean> {
  const stored = await readPrivateTextFile(join(dir, "SKILL.md"));
  if (!stored) return false;
  const { frontmatter } = parseNote(stored.contents);
  return frontmatter.forged === true;
}

export async function writeForgedSkill(input: ForgeSkillInput): Promise<string | null> {
  const slug = slugify(input.name);
  if (!isSafeSlug(slug) || slug === "untitled") return null;

  await ensureOdinPlugin();
  // Never shadow a non-forged skill the user keeps in the active dir.
  if (await isProtectedDir(join(skillsRoot(), slug))) return null;

  // ALWAYS write to staging — new skills AND updates require (re-)activation, so
  // a model-driven update can never bypass the human gate by landing active.
  const targetDir = join(stagedRoot(), slug);
  if (!contains(stagedRoot(), targetDir)) return null;

  await privateDir(targetDir);
  const path = join(targetDir, "SKILL.md");

  const now = new Date().toISOString();
  let created = now;
  // Preserve the original created date from a prior staged or active version.
  for (const prior of [path, join(skillsRoot(), slug, "SKILL.md")]) {
    const stored = await readPrivateTextFile(prior);
    if (stored) {
      const fm = parseNote(stored.contents).frontmatter;
      if (typeof fm.created !== "string") continue;
      created = fm.created;
      break;
    }
  }

  const frontmatter: Record<string, unknown> = {
    name: slug,
    description: scrubUrls(input.description.slice(0, 300)),
    forged: true,
    created,
    updated: now,
    source_session: input.sourceSession ?? undefined,
    ...(input.project ? { project: slugify(input.project) } : {}),
  };
  const steps = input.steps
    .slice(0, 20)
    .map((s, i) => `${i + 1}. ${scrubUrls(s)}`)
    .join("\n");
  const body = `# ${scrubUrls(input.name)}\n\n## Steps\n${steps}`;
  await writePrivateTextFile(path, serializeNote(frontmatter, body));
  return path;
}

/** Every forged skill (staged + active) with its activation state. */
export async function listForgedSlugs(): Promise<{ slug: string; active: boolean }[]> {
  const out: { slug: string; active: boolean }[] = [];
  for (const [base, active] of [
    [skillsRoot(), true],
    [stagedRoot(), false],
  ] as const) {
    try {
      const entries = await readdir(base, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || !isSafeSlug(e.name)) continue;
        try {
          if (await isForgedDir(join(base, e.name))) out.push({ slug: e.name, active });
        } catch {
          /* skip unsafe or unreadable skill entries without hiding valid siblings */
        }
      }
    } catch {
      /* dir absent */
    }
  }
  return out;
}

/** Move a staged skill into the loaded plugin dir. */
export async function activateSkill(slug: string): Promise<boolean> {
  if (!isSafeSlug(slug)) return false;
  const from = join(stagedRoot(), slug);
  const to = join(skillsRoot(), slug);
  if (!contains(stagedRoot(), from) || !contains(skillsRoot(), to)) return false;
  if (!(await realContained(stagedRoot(), from))) return false; // symlink guard
  if (!(await isForgedDir(from))) return false;
  if (await isProtectedDir(to)) return false; // never replace a non-forged active skill
  await privateDir(skillsRoot());
  await rm(to, { recursive: true, force: true });
  await rename(from, to);
  await chmod(to, 0o700);
  return true;
}

/** Move an active skill back to staging (no longer loaded). */
export async function deactivateSkill(slug: string): Promise<boolean> {
  if (!isSafeSlug(slug)) return false;
  const from = join(skillsRoot(), slug);
  const to = join(stagedRoot(), slug);
  if (!contains(skillsRoot(), from) || !contains(stagedRoot(), to)) return false;
  if (!(await realContained(skillsRoot(), from))) return false; // symlink guard
  if (!(await isForgedDir(from))) return false;
  await privateDir(stagedRoot());
  await rm(to, { recursive: true, force: true });
  await rename(from, to);
  await chmod(to, 0o700);
  return true;
}

/** Soft-delete a forged skill (staged or active) → .trash. */
export async function deleteForgedSkill(slug: string): Promise<boolean> {
  if (!isSafeSlug(slug)) return false;
  for (const base of [skillsRoot(), stagedRoot()]) {
    const dir = join(base, slug);
    if (!contains(base, dir)) continue; // anti-traversal
    if (!(await realContained(base, dir))) continue; // symlink guard
    if (!(await isForgedDir(dir))) continue;
    const trash = join(odinSkillsDir(), ".trash");
    await privateDir(trash);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(dir, join(trash, `${slug}-${stamp}`));
    return true;
  }
  return false;
}
