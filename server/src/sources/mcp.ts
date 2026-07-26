import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { paths } from "../claudePaths.js";
import type { McpServer } from "../types.js";

/** Read global, project, and installed-plugin MCP configuration as plain DTOs. */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function serverMap(value: unknown): Record<string, unknown> {
  const root = record(value);
  if (!root) return {};
  return record(root.mcpServers) || root;
}

function authNames(value: unknown): Set<string> {
  const names = new Set<string>();
  const containers = new Set(["servers", "mcpServers", "needsAuth", "needs_auth", "authRequired"]);
  const metadata = new Set(["version", "timestamp", "updatedAt", "lastUpdated"]);

  const visit = (node: unknown, entriesAreNames: boolean) => {
    if (typeof node === "string") {
      names.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, false);
      return;
    }
    const item = record(node);
    if (!item) return;

    const directName =
      typeof item.name === "string"
        ? item.name
        : typeof item.serverName === "string"
          ? item.serverName
          : null;
    if (directName && item.needsAuth !== false) names.add(directName);

    for (const [key, child] of Object.entries(item)) {
      if (containers.has(key)) {
        visit(child, true);
      } else if (entriesAreNames && !metadata.has(key)) {
        const details = record(child);
        if (child === true || (details && details.needsAuth !== false)) names.add(key);
      }
    }
  };

  visit(value, true);
  return names;
}

function toServer(
  name: string,
  value: unknown,
  scope: McpServer["scope"],
  needsAuth: Set<string>,
  projectDir?: string,
): McpServer | null {
  const config = record(value);
  if (!config) return null;
  const command = typeof config.command === "string" ? config.command : undefined;
  const url = typeof config.url === "string" ? config.url : undefined;
  const transport: McpServer["transport"] = command
    ? "stdio"
    : url?.toLowerCase().includes("/sse")
      ? "sse"
      : url
        ? "http"
        : "unknown";
  return {
    name,
    scope,
    ...(projectDir ? { projectDir } : {}),
    transport,
    ...(command ? { command } : {}),
    ...(url ? { url } : {}),
    needsAuth: needsAuth.has(name),
  };
}

async function pluginServers(needsAuth: Set<string>): Promise<McpServer[]> {
  const installed = record(await readJson(join(paths.plugins, "installed_plugins.json")));
  const plugins = record(installed?.plugins);
  if (!plugins) return [];

  const servers: McpServer[] = [];
  for (const installs of Object.values(plugins)) {
    if (!Array.isArray(installs)) continue;
    for (const install of installs) {
      const details = record(install);
      if (typeof details?.installPath !== "string") continue;
      const config = await readJson(join(details.installPath, ".mcp.json"));
      for (const [name, value] of Object.entries(serverMap(config))) {
        const server = toServer(name, value, "plugin", needsAuth);
        if (server) servers.push(server);
      }
    }
  }
  return servers;
}

export const mcp = {
  id: "mcp",
  watchPaths: [paths.configJson, paths.mcpAuthCache, paths.plugins],

  async list(): Promise<McpServer[]> {
    try {
      const [configValue, authValue] = await Promise.all([
        readJson(paths.configJson),
        readJson(paths.mcpAuthCache),
      ]);
      const config = record(configValue);
      const needsAuth = authNames(authValue);
      const servers: McpServer[] = [];

      for (const [name, value] of Object.entries(serverMap(config?.mcpServers))) {
        const server = toServer(name, value, "global", needsAuth);
        if (server) servers.push(server);
      }

      const configuredProjects = record(config?.projects);
      if (configuredProjects) {
        for (const [cwd, projectValue] of Object.entries(configuredProjects)) {
          const project = record(projectValue);
          const projectDir = basename(cwd) || cwd;
          for (const [name, value] of Object.entries(serverMap(project?.mcpServers))) {
            const server = toServer(name, value, "project", needsAuth, projectDir);
            if (server) servers.push(server);
          }
        }
      }

      servers.push(...(await pluginServers(needsAuth)));
      const deduped = new Map<string, McpServer>();
      for (const server of servers) {
        const key = `${server.scope}\0${server.name}\0${server.projectDir || ""}`;
        if (!deduped.has(key)) deduped.set(key, server);
      }
      return [...deduped.values()];
    } catch {
      return [];
    }
  },

  async summary() {
    const all = await this.list();
    return { total: all.length, needsAuth: all.filter((server) => server.needsAuth).length };
  },

  invalidate() {
    // Reads are uncached so plugin configs outside Claude's watched roots stay fresh.
  },
};
