import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { odinSkillsDir, skillsRoot } from "../skills/forge.js";

type ConfigValue = string | number | boolean | ConfigValue[] | { [key: string]: ConfigValue };

const ODIN_MCP_PATH =
  process.env.HELM_ODIN_MCP || fileURLToPath(new URL("../odin-mcp.mjs", import.meta.url));

export const FLEET_TOOLS = [
  "mcp__odin__dispatch_agent",
  "mcp__odin__list_agents",
  "mcp__odin__prompt_agent",
  "mcp__odin__stop_agent",
];

export const MOLDAVITE_TOOL_NAMES = [
  "search_notes",
  "read_note",
  "list_notes",
  "get_backlinks",
  "create_note",
  "append_to_daily_note",
  "write_note",
];

export const MOLDAVITE_TOOLS = MOLDAVITE_TOOL_NAMES.map((name) => `mcp__moldavite__${name}`);

export function moldaviteBin(): string {
  return (
    process.env.ODIN_MOLDAVITE_BIN ||
    process.env.HELM_MOLDAVITE_BIN ||
    "/Applications/Moldavite.app/Contents/MacOS/moldavite"
  );
}

export function notesForge(): string {
  return process.env.ODIN_NOTES_FORGE || "Default";
}

type ProviderId = "claude-code" | "codex";
type AccessLevel = "read-only" | "guarded" | "full";

function accessLevel(provider: ProviderId, permissionMode?: string): AccessLevel {
  if (provider === "codex") {
    if (permissionMode === "read-only") return "read-only";
    if (permissionMode === "danger-full-access") return "full";
    return "guarded";
  }
  if (permissionMode === "plan") return "read-only";
  if (permissionMode === "bypassPermissions") return "full";
  return "guarded";
}

export function buildMcp(options: {
  orchestrator?: boolean;
  provider?: ProviderId;
  permissionMode?: string;
}): {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  allowed: string[];
} {
  const mcpServers: Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  > = {};
  const allowed: string[] = [];
  if (process.env.ODIN_NOTES_ENABLED !== "0" && existsSync(moldaviteBin())) {
    mcpServers.moldavite = { command: moldaviteBin(), args: ["--mcp", "--forge", notesForge()] };
    allowed.push(...MOLDAVITE_TOOLS);
  }
  if (options.orchestrator) {
    mcpServers.odin = {
      command: process.execPath,
      args: [ODIN_MCP_PATH],
      env: {
        ODIN_PORT: process.env.HELM_PORT || "7420",
        ODIN_PROVIDER: options.provider ?? "claude-code",
        ODIN_ACCESS_LEVEL: accessLevel(
          options.provider ?? "claude-code",
          options.permissionMode,
        ),
      },
    };
    allowed.push(...FLEET_TOOLS);
  }
  return { mcpServers, allowed };
}

export function codexMcpConfig(
  orchestrator = false,
  permissionMode?: string,
): { [key: string]: ConfigValue } {
  const { mcpServers } = buildMcp({ orchestrator, provider: "codex", permissionMode });
  const config: { [key: string]: ConfigValue } = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    config[name] = {
      ...server,
      required: false,
      default_tools_approval_mode: "auto",
      ...(name === "moldavite" ? { enabled_tools: MOLDAVITE_TOOL_NAMES } : {}),
    };
  }
  return config;
}

export function codexSkillConfig(): { path: string; enabled: boolean }[] {
  if (process.env.ODIN_SKILLS_ENABLED === "0" || !existsSync(skillsRoot())) return [];
  try {
    return readdirSync(skillsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot(), entry.name, "SKILL.md")))
      .map((entry) => ({ path: join(skillsRoot(), entry.name), enabled: true }));
  } catch {
    return [];
  }
}

export { odinSkillsDir };
