import { readFile, readdir, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { decodeProjectDir, paths, projectLabel } from "../claudePaths.js";
import { addTokens, emptyTokens } from "../pricing.js";
import { sessions } from "./sessions.js";
import type { ProjectCard, SessionSummary } from "../types.js";

/** Build one read-only project card for every encoded Claude project directory. */

let configCache: Record<string, unknown> | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readConfig(): Promise<Record<string, unknown>> {
  if (configCache) return configCache;
  try {
    const parsed = record(JSON.parse(await readFile(paths.configJson, "utf8")) as unknown) || {};
    configCache = parsed;
    return parsed;
  } catch {
    configCache = null;
    return {};
  }
}

async function projectDirs(): Promise<string[]> {
  try {
    const entries = await readdir(paths.projects, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function encodeProjectPath(path: string): string {
  return path.replace(/[/.]/g, "-");
}

function githubPaths(value: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      if (node.startsWith("/")) found.add(normalize(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const item = record(node);
    if (!item) return;
    for (const [key, child] of Object.entries(item)) {
      if (key.startsWith("/")) found.add(normalize(key));
      visit(child);
    }
  };
  visit(value);
  return found;
}

async function hasGitDir(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, ".git"))).isDirectory();
  } catch {
    return false;
  }
}

function groupSessions(all: SessionSummary[]): Map<string, SessionSummary[]> {
  const grouped = new Map<string, SessionSummary[]>();
  for (const session of all) {
    const group = grouped.get(session.projectDir) || [];
    group.push(session);
    grouped.set(session.projectDir, group);
  }
  return grouped;
}

export const projects = {
  id: "projects",
  watchPaths: [paths.projects, paths.configJson],

  async list(): Promise<ProjectCard[]> {
    try {
      const [dirs, allSessions, config] = await Promise.all([
        projectDirs(),
        sessions.list().catch(() => []),
        readConfig(),
      ]);
      const grouped = groupSessions(allSessions);
      const configuredProjects = record(config.projects) || {};
      const pathsByDir = new Map<string, string>();
      for (const path of Object.keys(configuredProjects)) {
        const dir = encodeProjectPath(path);
        if (!pathsByDir.has(dir)) pathsByDir.set(dir, path);
      }
      const repos = githubPaths(config.githubRepoPaths);

      const cards = await Promise.all(
        dirs.map(async (dir): Promise<ProjectCard> => {
          const projectSessions = grouped.get(dir) || [];
          let tokens = emptyTokens();
          let costUsd = 0;
          let lastActive: string | null = null;
          for (const session of projectSessions) {
            tokens = addTokens(tokens, session.tokens);
            costUsd += session.costUsd;
            if (session.endedAt && (!lastActive || session.endedAt > lastActive)) {
              lastActive = session.endedAt;
            }
          }

          const path = pathsByDir.get(dir) || decodeProjectDir(dir);
          const isGitRepo = repos.has(normalize(path)) || (await hasGitDir(path));
          return {
            dir,
            label: projectLabel(dir),
            path,
            sessionCount: projectSessions.length,
            lastActive,
            tokens,
            costUsd,
            isGitRepo,
          };
        }),
      );
      return cards.sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));
    } catch {
      return [];
    }
  },

  async summary() {
    const all = await this.list();
    return { total: all.length };
  },

  invalidate() {
    configCache = null;
  },
};
