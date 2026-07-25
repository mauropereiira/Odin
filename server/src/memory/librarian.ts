import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brain } from "../sources/brain.js";
import { appendDailyBullet, readMemory, slugify, writeMemory } from "./forge.js";
import { writeForgedSkill } from "../skills/forge.js";
import type { Memory } from "../types.js";
import type { ProviderId } from "../providers/types.js";

/**
 * The librarian: after a run finishes, a cheap Haiku pass distills durable facts
 * from the turn and writes them as memory notes. Conservative by design — a
 * missing memory is better than a noisy or wrong one.
 */

const CLAUDE_BIN = process.env.ODIN_CLAUDE_BIN || process.env.HELM_CLAUDE_BIN || "claude";
const VALID_TYPES = new Set(["person", "preference", "project", "decision", "fact", "reference"]);

// Blast-radius caps for a single distill pass (defense against a runaway or
// injected model flooding / bloating the brain).
const MAX_CANDIDATES = 6;
const MAX_TITLE = 120;
const MAX_BODY = 1200;
const MAX_LINKS = 12;
const activeLibrarians = new Set<ChildProcess>();
let stopping = false;

export function stopLibrarians(): void {
  stopping = true;
  for (const child of activeLibrarians) child.kill("SIGTERM");
}

/** Sources the auto-remember loop is allowed to update. Anything else — manual
 * notes, MOCs, seeds — is human territory and must never be overwritten. */
function isAutoSource(v: unknown): boolean {
  return v === "converse" || v === "fleet";
}

/** Redact common secret shapes so credentials in a turn don't leak to the
 * Haiku sink or get persisted into a memory note. Best-effort, not exhaustive. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/\b(gh[posu]|github_pat)_[A-Za-z0-9_]{16,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, "[REDACTED]")
    .replace(/(authorization|api[_-]?key|token|secret|password|passwd|pwd)(\s*[:=]\s*)("?)\S+/gi,
      "$1$2$3[REDACTED]");
}

/** Strip control chars / weird symbols and cap length so attacker-controlled
 * prior titles can't smuggle instructions into the librarian prompt. */
function sanitizeTitles(titles: string[]): string {
  const cleaned = titles
    .slice(0, 60)
    .map((t) =>
      t
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[^\p{L}\p{N}\s\-|'".,:]/gu, "")
        .trim()
        .slice(0, 80),
    )
    .filter(Boolean);
  return cleaned.join("; ").slice(0, 2000) || "(none)";
}

export interface DistillPayload {
  provider?: ProviderId;
  userMessage: string;
  assistantText: string;
  cwd: string;
  project?: string;
  sessionId: string | null;
  kind: "converse" | "fleet";
}

export interface Candidate {
  type: string;
  title: string;
  body: string;
  links?: string[];
  pinned?: boolean;
}

/** Extract the first JSON array from model output and keep well-formed candidates. */
export function parseCandidates(modelOutput: string): Candidate[] {
  const start = modelOutput.indexOf("[");
  const end = modelOutput.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(modelOutput.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Candidate[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const type = typeof c.type === "string" ? c.type : "";
    const title = typeof c.title === "string" ? c.title.trim() : "";
    const body = typeof c.body === "string" ? c.body.trim() : "";
    if (!VALID_TYPES.has(type) || !title || !body) continue;
    out.push({
      type,
      title,
      body,
      links: Array.isArray(c.links) ? c.links.filter((l): l is string => typeof l === "string") : [],
      pinned: c.pinned === true,
    });
  }
  return out;
}

export interface SkillCandidate {
  name: string;
  description: string;
  steps: string[];
}

function extractJson(text: string, open: string, close: string): string | null {
  const s = text.indexOf(open);
  const e = text.lastIndexOf(close);
  return s === -1 || e === -1 || e < s ? null : text.slice(s, e + 1);
}

/**
 * Parse the librarian's output into memory + skill candidates. Tolerates a bare
 * memory array (old format) and an object { memories, skills } (new format).
 */
export function parseLibrarianOutput(text: string): {
  memories: Candidate[];
  skills: SkillCandidate[];
} {
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  // Only take the object path when an object is the top-level shape — i.e. a `{`
  // appears before any `[`. Otherwise it's the bare-array (memories-only) form.
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    const obj = extractJson(text, "{", "}");
    if (obj) {
      try {
        const parsed = JSON.parse(obj) as Record<string, unknown>;
        const memories = parseCandidates(JSON.stringify(parsed.memories ?? []));
        const skills = parseSkillCandidates(parsed.skills);
        return { memories, skills };
      } catch {
        /* fall through to array */
      }
    }
  }
  return { memories: parseCandidates(text), skills: [] };
}

const MAX_SKILL_NAME = 80;
const MAX_SKILL_DESC = 200;
const MAX_STEP = 200;
const MAX_STEPS = 12;

function parseSkillCandidates(raw: unknown): SkillCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillCandidate[] = [];
  for (const item of raw.slice(0, MAX_CANDIDATES)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const name = (typeof c.name === "string" ? c.name.trim() : "").slice(0, MAX_SKILL_NAME);
    const description = (typeof c.description === "string" ? c.description.trim() : "").slice(
      0,
      MAX_SKILL_DESC,
    );
    const steps = Array.isArray(c.steps)
      ? c.steps
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, MAX_STEP))
          .slice(0, MAX_STEPS)
      : [];
    if (!name || !description || steps.length === 0) continue;
    out.push({ name, description, steps });
  }
  return out;
}

function buildPrompt(payload: DistillPayload, existingTitles: string[]): string {
  return [
    "You are Odin's memory librarian. From the conversation turn below, extract ONLY durable, general facts worth remembering across future sessions:",
    "who the user is, lasting preferences, project facts/goals, and decisions with their rationale.",
    "Do NOT record ephemeral task chatter, one-off requests, secrets/credentials, or anything already known unchanged.",
    "Be conservative: if nothing is worth saving, return [].",
    "",
    `Existing memory titles (reuse the EXACT title to update one): ${sanitizeTitles(existingTitles)}`,
    "",
    "Also extract any genuinely REUSABLE procedure worth invoking again (a repeatable how-to), as skills. Return [] for skills unless there's a clearly reusable procedure.",
    "Output ONLY a JSON object, no prose:",
    '{ "memories": [ { "type": "person|preference|project|decision|fact|reference", "title": "Short Name", "body": "1-3 sentences.", "links": ["Other Title"] } ], "skills": [ { "name": "Short Skill Name", "description": "when to use this", "steps": ["step 1", "step 2"] } ] }',
    "",
    "=== USER ===",
    payload.userMessage.slice(0, 6000),
    "=== ODIN ===",
    payload.assistantText.slice(0, 6000),
  ].join("\n");
}

/**
 * Run one headless Haiku pass; resolves to the model's result text (or "").
 * The prompt (which contains conversation text) is fed via stdin, not argv, so
 * it never appears in the process table.
 */
async function runHaiku(prompt: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "odin-librarian-"));
  try {
    return await new Promise((resolve) => {
      let child;
      try {
        child = spawn(
          CLAUDE_BIN,
          [
            "-p",
            "--model",
            "haiku",
            "--output-format",
            "json",
            "--safe-mode",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--tools",
            "",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--permission-mode",
            "plan",
            "--system-prompt",
            "You are a constrained JSON extraction process. You have no tools.",
          ],
          {
            cwd: directory,
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      } catch {
        resolve("");
        return;
      }
      activeLibrarians.add(child);
      let stdout = "";
      let settled = false;
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish("");
      }, 60_000);
      child.stdout?.on("data", (c) => {
        if (stdout.length < 1_000_000) stdout += c.toString();
      });
      child.on("error", () => {
        activeLibrarians.delete(child);
        finish("");
      });
      child.on("close", () => {
        activeLibrarians.delete(child);
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>;
          finish(typeof parsed.result === "string" ? parsed.result : "");
        } catch {
          finish(stdout);
        }
      });
      child.stdin?.on("error", () => finish(""));
      child.stdin?.end(prompt);
    });
  } catch {
    return "";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runCodexLibrarian(prompt: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "odin-librarian-"));
  try {
    const override = process.env.ODIN_CODEX_BIN || process.env.HELM_CODEX_BIN;
    const bundled = createRequire(import.meta.url).resolve("@openai/codex/bin/codex.js");
    const command = override || process.execPath;
    const args = [
      ...(override ? [] : [bundled]),
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "-c",
      "features.memories=false",
      "-c",
      "features.shell_tool=false",
      "-c",
      "features.multi_agent=false",
      ...(process.env.ODIN_CODEX_LIBRARIAN_MODEL
        ? ["--model", process.env.ODIN_CODEX_LIBRARIAN_MODEL]
        : []),
      "-",
    ];
    return await new Promise<string>((resolve) => {
      let stdout = "";
      let settled = false;
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const child = spawn(command, args, {
        cwd: directory,
        env: process.env,
        stdio: ["pipe", "pipe", "ignore"],
      });
      activeLibrarians.add(child);
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish("");
      }, 60_000);
      child.stdout?.on("data", (chunk) => {
        if (stdout.length < 1_000_000) stdout += chunk.toString();
      });
      child.on("error", () => {
        activeLibrarians.delete(child);
        finish("");
      });
      child.on("close", () => {
        activeLibrarians.delete(child);
        let final = "";
        for (const line of stdout.split("\n")) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            const item = event.item as Record<string, unknown> | undefined;
            if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
              final = item.text;
            }
          } catch {
            // Ignore non-JSON noise from the isolated CLI.
          }
        }
        finish(final);
      });
      child.stdin?.on("error", () => finish(""));
      child.stdin?.end(prompt);
    });
  } catch {
    return "";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Write/update candidates as memory notes. Exposed for tests.
 *
 * Security: the auto-remember loop distills conversation content, which can
 * include text Odin read from untrusted sources (web pages, repo files, tool
 * output). So a candidate's title is attacker-influenceable. To prevent memory
 * poisoning we (1) only ever update notes the loop itself wrote
 * (`source: converse|fleet`) — human/manual notes, MOCs, and seeds are
 * immutable here; (2) never overwrite a pinned memory; (3) never pin an
 * auto-written note (pinning is a human action); (4) cap count and sizes.
 */
export async function writeCandidates(
  candidates: Candidate[],
  payload: DistillPayload,
): Promise<Memory[]> {
  if (stopping) return [];
  const written: Memory[] = [];
  for (const c of candidates.slice(0, MAX_CANDIDATES)) {
    const title = c.title.slice(0, MAX_TITLE);
    const slug = slugify(title);
    if (!slug || slug === "untitled") continue;

    const prior = await readMemory(slug);
    // Never let auto-distillation clobber human-authored / pinned memories.
    if (prior && (prior.frontmatter.pinned === true || !isAutoSource(prior.frontmatter.source))) {
      continue;
    }

    const now = new Date().toISOString();
    const projectTag = payload.project ? `project-${slugify(payload.project)}` : null;
    const frontmatter: Record<string, unknown> = {
      title,
      type: c.type,
      created: (prior?.frontmatter.created as string) ?? now,
      updated: now,
      source: payload.kind,
      provider: payload.provider,
      session: payload.sessionId ?? undefined,
      pinned: false, // auto-written memories are never pinned; pinning is human-only
      tags: ["odin-memory", ...(projectTag ? [projectTag] : [])],
      ...(payload.project ? { project: slugify(payload.project) } : {}),
    };
    const links = (c.links ?? []).slice(0, MAX_LINKS);
    const linkLine = links.length ? `\n\nRelated: ${links.map((l) => `[[${l}]]`).join(" ")}` : "";
    const body = c.body.slice(0, MAX_BODY);
    await writeMemory({ slug, frontmatter, body: `# ${title}\n\n${body}${linkLine}` });
    await appendDailyBullet(now.slice(0, 10), `- Learned [[${title}]] _(${payload.kind})_`);
    brain.invalidate();
    const m = await brain.get(slug);
    if (m) written.push(m);
  }
  return written;
}

/**
 * Full remember pass: one Haiku call distills durable facts (brain) AND
 * reusable procedures (forged skills). Guarded + best-effort. `emitChange` is
 * fired with the source(s) that actually changed so the dashboard refreshes.
 */
export async function distill(
  payload: DistillPayload,
  emitChange?: (source: "brain" | "skills") => void,
): Promise<Memory[]> {
  if (stopping || process.env.ODIN_LIBRARIAN_ENABLED === "0") return [];
  const remember = process.env.ODIN_BRAIN_REMEMBER !== "0";
  const forge = process.env.ODIN_SKILLS_ENABLED !== "0";
  if (!remember && !forge) return [];
  if (!payload.assistantText.trim() && !payload.userMessage.trim()) return [];

  const existing = await brain.list();
  if (stopping) return [];
  const safePayload: DistillPayload = {
    ...payload,
    userMessage: redactSecrets(payload.userMessage),
    assistantText: redactSecrets(payload.assistantText),
  };
  const prompt = buildPrompt(safePayload, existing.map((m) => m.title));
  const output =
    safePayload.provider === "codex"
      ? await runCodexLibrarian(prompt)
      : await runHaiku(prompt);
  if (stopping) return [];
  const { memories, skills } = parseLibrarianOutput(output);

  // Output-side redaction: a secret the input redactor missed could be echoed
  // by the model into a note/skill on disk (which is later re-fed to models).
  // Redact again before anything is persisted.
  const safeMemories = memories.map((m) => ({
    ...m,
    title: redactSecrets(m.title),
    body: redactSecrets(m.body),
    links: m.links?.map(redactSecrets),
  }));
  const safeSkills = skills.map((s) => ({
    name: redactSecrets(s.name),
    description: redactSecrets(s.description),
    steps: s.steps.map(redactSecrets),
  }));

  let written: Memory[] = [];
  if (remember && safeMemories.length > 0) {
    written = await writeCandidates(safeMemories, payload);
    if (written.length > 0) {
      brain.invalidate();
      emitChange?.("brain");
    }
  }

  if (forge && safeSkills.length > 0) {
    let anyForged = false;
    for (const s of safeSkills) {
      const path = await writeForgedSkill({
        name: s.name,
        description: s.description,
        steps: s.steps,
        sourceSession: payload.sessionId,
        project: payload.project,
      });
      if (path) anyForged = true;
    }
    if (anyForged) emitChange?.("skills");
  }

  return written;
}
