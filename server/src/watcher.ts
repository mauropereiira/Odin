import chokidar from "chokidar";
import { homedir } from "node:os";
import { join } from "node:path";
import { paths } from "./claudePaths.js";
import { brainDir } from "./memory/forge.js";
import type { ChangeEvent } from "./types.js";

type Listener = (evt: ChangeEvent) => void;

/**
 * Watches Claude's on-disk state and emits debounced change events tagged with
 * the source they affect. Consumers (the WS hub) rebroadcast these so the UI can
 * refetch exactly what changed — start a session in a terminal and it shows up
 * without a manual refresh.
 */
export function startWatcher(onChange: Listener) {
  const brainPath = brainDir();
  const claudeRoot = process.env.HELM_CLAUDE_DIR || join(homedir(), ".claude");
  const pluginsFile = join(claudeRoot, "plugins", "installed_plugins.json");
  const odinSkills = process.env.ODIN_SKILLS_DIR || join(claudeRoot, "odin-skills");
  const watcher = chokidar.watch(
    [
      paths.projects,
      paths.configJson,
      paths.statsCache,
      paths.mcpAuthCache,
      brainPath,
      pluginsFile,
      odinSkills,
    ],
    {
      ignoreInitial: true,
      persistent: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    },
  );

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const emit = (source: string) => {
    const prev = pending.get(source);
    if (prev) clearTimeout(prev);
    pending.set(
      source,
      setTimeout(() => {
        pending.delete(source);
        onChange({ source, at: new Date().toISOString() });
      }, 500),
    );
  };

  const route = (path: string) => {
    if (path.startsWith(odinSkills) || path === pluginsFile) {
      emit("skills");
    } else if (path.startsWith(brainPath)) {
      emit("brain");
    } else if (path.startsWith(paths.projects)) {
      emit("sessions");
      emit("usage");
      emit("projects");
    } else if (path === paths.statsCache) {
      emit("usage");
    } else if (path === paths.configJson || path === paths.mcpAuthCache) {
      emit("mcp");
      emit("projects");
    }
  };

  watcher.on("add", route).on("change", route).on("unlink", route);
  return watcher;
}
