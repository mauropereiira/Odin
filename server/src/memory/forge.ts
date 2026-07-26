import { readFileSync } from "node:fs";
import { lstat, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import YAML from "yaml";
import {
  ensurePrivateDirectory,
  ensurePrivateTextFile,
  hardenPrivateFile,
  readPrivateTextFile,
  updatePrivateTextFile,
  writePrivateTextFile,
} from "../private-file.js";
import { isSafeSlug } from "../validation.js";

/** True iff `target` resolves to `base` or something inside it (anti-traversal). */
function contains(base: string, target: string): boolean {
  const b = resolve(base);
  const t = resolve(target);
  return t === b || t.startsWith(b + sep);
}

/**
 * Storage layer for Odin's brain — the ONLY module that writes to the Odin
 * Forge. A Forge is plain Markdown on disk (Moldavite's format); we mirror its
 * slug rule exactly so [[wiki links]] resolve in the app.
 */

const MOLDAVITE_CONFIG = join(
  homedir(),
  "Library",
  "Application Support",
  "Moldavite",
  "config.json",
);

/** Moldavite's forges root, read from its config; falls back to the default. */
export function resolveForgesRoot(): string {
  try {
    const raw = JSON.parse(readFileSync(MOLDAVITE_CONFIG, "utf8")) as Record<string, unknown>;
    if (typeof raw.forgesRoot === "string" && raw.forgesRoot) return raw.forgesRoot;
  } catch {
    /* fall through to default */
  }
  return join(homedir(), "Documents", "Moldavite");
}

export function brainDir(): string {
  return process.env.ODIN_BRAIN_DIR || join(resolveForgesRoot(), "Odin");
}
export function notesDir(): string {
  return join(brainDir(), "notes");
}
export function dailyDir(): string {
  return join(brainDir(), "daily");
}

/** MUST match Moldavite's slugifyNoteName (src/lib/fileSystem.ts). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFC")
    .replace(/\.md$/, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Alphabetic}\p{N}-]/gu, "");
  return slug === "" ? "untitled" : slug;
}

/**
 * Parse a note into frontmatter + body. Uses a real YAML parser because
 * Moldavite re-serializes frontmatter through full YAML (block sequences,
 * sorted keys) whenever it touches a note, so our minimal inline parser would
 * silently lose array fields like `tags`.
 */
export function parseNote(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---", 4);
    if (end !== -1) {
      const fmText = raw.slice(4, end);
      const body = raw.slice(end + 4).replace(/^\r?\n/, "");
      let frontmatter: Record<string, unknown> = {};
      try {
        const parsed = YAML.parse(fmText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          frontmatter = parsed as Record<string, unknown>;
        }
      } catch {
        /* malformed frontmatter → treat as none */
      }
      return { frontmatter, body };
    }
  }
  return { frontmatter: {}, body: raw };
}

/**
 * Serialize frontmatter + body into a Moldavite-friendly note. Keys are sorted
 * (as Moldavite writes them) so our writes and Moldavite's re-saves converge and
 * the vault's diffs stay clean.
 */
export function serializeNote(frontmatter: Record<string, unknown>, body: string): string {
  const entries = Object.entries(frontmatter).filter(([, v]) => v !== undefined && v !== null);
  const trimmedBody = body.trimEnd();
  if (entries.length === 0) return `${trimmedBody}\n`;
  const fm = YAML.stringify(Object.fromEntries(entries), { sortMapEntries: true }).trimEnd();
  return `---\n${fm}\n---\n\n${trimmedBody}\n`;
}

/** Outbound wiki-link targets as slugs, deduped in first-seen order. */
export function extractWikiLinks(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const inner = m[1];
    const target = inner.includes("|") ? inner.slice(inner.indexOf("|") + 1) : inner;
    const slug = slugify(target);
    if (!seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

export interface StoredMemory {
  slug: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mtimeMs: number;
}

const AGENTS_MD = `# AGENTS.md - Odin Brain

This Forge is Odin's persistent memory. Each note in \`notes/\` is one durable
fact about the user, their projects, preferences, and decisions. Plain Markdown
with optional YAML frontmatter is the source of truth. Odin recalls these notes
before acting and writes new ones after meaningful work.

Never edit \`*.md.locked\`; never touch \`.trash/\`, \`.plugins/\`, \`.index/\`,
or \`.odin-trash/\`.
`;

const GITIGNORE = ".trash/\n.plugins/\n.index/\n.odin-trash/\n.DS_Store\n";

async function privateDir(path: string): Promise<void> {
  await ensurePrivateDirectory(path);
}

async function hardenMarkdownFiles(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      await hardenPrivateFile(join(path, entry.name));
    }
  }
}

/** Create the Odin Forge skeleton if missing. Never clobbers existing files. */
export async function ensureForge(): Promise<void> {
  await privateDir(brainDir());
  await privateDir(notesDir());
  await privateDir(dailyDir());
  const agents = join(brainDir(), "AGENTS.md");
  await ensurePrivateTextFile(agents, AGENTS_MD);
  const gi = join(brainDir(), ".gitignore");
  await ensurePrivateTextFile(gi, GITIGNORE);
  await Promise.all([hardenMarkdownFiles(notesDir()), hardenMarkdownFiles(dailyDir())]);
}

export async function writeMemory(m: {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
}): Promise<string> {
  if (!isSafeSlug(m.slug)) throw new Error("Invalid memory slug.");
  await ensureForge();
  const path = join(notesDir(), `${m.slug}.md`);
  await writePrivateTextFile(path, serializeNote(m.frontmatter, m.body));
  return path;
}

export async function readMemory(slug: string): Promise<StoredMemory | null> {
  if (!isSafeSlug(slug)) return null;
  const path = join(notesDir(), `${slug}.md`);
  try {
    const stored = await readPrivateTextFile(path);
    if (!stored) return null;
    const { frontmatter, body } = parseNote(stored.contents);
    return { slug, path, frontmatter, body, mtimeMs: stored.mtimeMs };
  } catch {
    return null;
  }
}

/** Slugs of every visible memory note (skips dotfiles and *.md.locked). */
export async function listMemorySlugs(): Promise<{ slug: string; path: string; mtimeMs: number }[]> {
  let entries: string[];
  try {
    entries = await readdir(notesDir());
  } catch {
    return [];
  }
  const out: { slug: string; path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".") || !entry.endsWith(".md")) continue;
    const slug = entry.replace(/\.md$/, "");
    if (!isSafeSlug(slug)) continue;
    const path = join(notesDir(), entry);
    try {
      const st = await lstat(path);
      if (!st.isFile()) continue;
      out.push({ slug, path, mtimeMs: st.mtimeMs });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/** Append one bullet to today's daily note; no duplicate lines. */
export async function appendDailyBullet(dateISO: string, bullet: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new Error("Invalid daily note date.");
  await ensureForge();
  const path = join(dailyDir(), `${dateISO}.md`);
  await updatePrivateTextFile(path, (existing) => {
    if (existing.includes(bullet)) return existing;
    return existing.trim()
      ? `${existing.trimEnd()}\n${bullet}\n`
      : `# ${dateISO}\n\n${bullet}\n`;
  });
}

/** Soft-delete: move a note into an Odin-managed .odin-trash (Moldavite ignores dotdirs). */
export async function trashMemory(slug: string): Promise<boolean> {
  if (!isSafeSlug(slug)) return false;
  const src = join(notesDir(), `${slug}.md`);
  if (!contains(notesDir(), src)) return false; // anti-traversal
  const trashDir = join(brainDir(), ".odin-trash");
  await privateDir(trashDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await rename(src, join(trashDir, `${slug}-${stamp}.md`));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
