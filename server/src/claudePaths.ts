import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical locations of Claude Code's on-disk state. Everything Helm reads
 * lives under here; nothing is ever written. Override the root with
 * HELM_CLAUDE_DIR (useful for tests / fixtures).
 */
const root = process.env.HELM_CLAUDE_DIR || join(homedir(), ".claude");

export const paths = {
  root,
  /** Per-project session transcript directories (encoded cwd → *.jsonl). */
  projects: join(root, "projects"),
  /** Global config: mcpServers, projects, githubRepoPaths, account, flags. */
  configJson: join(homedir(), ".claude.json"),
  /** Precomputed daily activity (messages, sessions, tool calls). */
  statsCache: join(root, "stats-cache.json"),
  /** Cache of which MCP servers still need auth. */
  mcpAuthCache: join(root, "mcp-needs-auth-cache.json"),
  settings: join(root, "settings.json"),
  todos: join(root, "todos"),
  tasks: join(root, "tasks"),
  plugins: join(root, "plugins"),
};

/**
 * Claude encodes a project's cwd into a directory name by replacing every
 * path separator and dot with a dash: `/example/work/App` →
 * `-Users-me-Desktop-App`. This reverses that to a best-effort display path.
 * The transform is lossy (a literal dash and a separator both become `-`), so
 * this is for display only, never for filesystem access.
 */
export function decodeProjectDir(name: string): string {
  return name.replace(/-/g, "/");
}

/** Short, human-friendly project label from an encoded dir name. */
export function projectLabel(name: string): string {
  const worktreeMarker = name.toLowerCase().indexOf("claude-worktrees");
  if (worktreeMarker >= 0) {
    // Worktree suffixes end in agent ids; the useful label is the project just before the marker.
    const parent = lastPathSegment(name.slice(0, worktreeMarker).replace(/-+$/, ""));
    if (parent) return `${parent} · worktree`;
  }

  // UUID suffixes are recognizable before decoding, while their dashes are still intact.
  const uuidSuffix = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidSuffix.test(name)) {
    const withoutUuid = name.replace(uuidSuffix, "");
    if (/(?:^|-)user-workflow$/i.test(withoutUuid)) return "user-workflow";
    const stripped = lastPathSegment(withoutUuid);
    if (stripped) return stripped;
  }

  const decoded = decodeProjectDir(name);
  const segments = decoded.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && looksOpaque(last)) {
    // Bare hashes are implementation details; fall back to their containing project.
    return segments[segments.length - 2] || name;
  }
  return last || name;
}

function lastPathSegment(encoded: string): string | null {
  const segments = decodeProjectDir(encoded).split("/").filter(Boolean);
  return segments[segments.length - 1] || null;
}

function looksOpaque(segment: string): boolean {
  if (/^[0-9a-f]{12,}$/i.test(segment)) return true;
  return segment.length >= 16 && /^[a-z0-9]+$/i.test(segment) && /\d/.test(segment);
}
