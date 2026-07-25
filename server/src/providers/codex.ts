import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  Codex,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
} from "@openai/codex-sdk";
import { composeOdinInstructions } from "../identity.js";
import { codexMcpConfig, codexSkillConfig } from "./tools.js";
import {
  ProviderError,
  type AgentRuntime,
  type ConversationOptions,
  type ProviderCapability,
  type ProviderModel,
  type RuntimeEmit,
  type RuntimeRun,
} from "./types.js";
import { executableVersion, resolveExecutable, validateCwd, validateMessage } from "./utils.js";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

function codexBin(): string | undefined {
  return process.env.ODIN_CODEX_BIN || process.env.HELM_CODEX_BIN || undefined;
}

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

function allowedAccessModes(): Set<string> {
  return new Set(
    process.env.ODIN_ALLOW_BYPASS === "1"
      ? ["read-only", "workspace-write", "danger-full-access"]
      : ["read-only", "workspace-write"],
  );
}

export class CodexRuntime implements AgentRuntime {
  readonly id = "codex" as const;

  async capabilities(): Promise<ProviderCapability> {
    const configuredBin = codexBin();
    const detectedBin = configuredBin ? resolveExecutable(configuredBin) : null;
    const version = detectedBin ? await executableVersion(detectedBin) : bundledCodexVersion();
    const models = await readCodexModels();
    const allowBypass = process.env.ODIN_ALLOW_BYPASS === "1";
    return {
      id: this.id,
      label: "Codex",
      available: configuredBin ? Boolean(detectedBin) : bundledCodexAvailable(),
      version,
      authenticated:
        existsSync(join(codexHome(), "auth.json")) || Boolean(process.env.CODEX_API_KEY)
          ? true
          : false,
      models,
      accessModes: [
        {
          id: "read-only",
          label: "Read only",
          description: "Inspect and reason without writing to the workspace.",
        },
        {
          id: "workspace-write",
          label: "Workspace write",
          description: "Build and edit inside the selected project sandbox.",
        },
        ...(allowBypass
          ? [
              {
                id: "danger-full-access",
                label: "Full access",
                description: "Run without filesystem sandbox restrictions.",
                dangerous: true,
              },
            ]
          : []),
      ],
      defaultAccessMode: "workspace-write",
    };
  }

  validate(options: ConversationOptions): void {
    validateCodexOptions(options);
  }

  start(runId: string, options: ConversationOptions, emit: RuntimeEmit): RuntimeRun {
    const { message, cwd, mode } = validateCodexOptions(options);

    const mcpServers = codexMcpConfig(options.orchestrator, mode);
    const instructions = composeOdinInstructions({
      provider: this.id,
      orchestrator: options.orchestrator,
      notesEnabled: "moldavite" in mcpServers,
      recall: options.recall,
    });
    const skills = codexSkillConfig();
    const override = codexBin();
    const codex = new Codex({
      ...(override ? { codexPathOverride: override } : {}),
      config: {
        developer_instructions: instructions,
        mcp_servers: mcpServers,
        features: { memories: false },
        ...(skills.length ? { skills: { config: skills } } : {}),
      },
    });
    const threadOptions: ThreadOptions = {
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: mode as ThreadOptions["sandboxMode"],
      approvalPolicy: "never",
      networkAccessEnabled: mode === "danger-full-access",
      ...(options.model ? { model: options.model } : {}),
    };
    const controller = new AbortController();
    let nativeSessionId = options.resumeSessionId ?? null;
    let stopped = false;

    emit({ runId, type: "start", cwd, model: options.model ?? "default", permissionMode: mode });

    const done = (async () => {
      const startedAt = Date.now();
      let resultText = "";
      let completed = false;
      let failed = false;
      const startedTools = new Set<string>();
      try {
        const thread = options.resumeSessionId
          ? codex.resumeThread(options.resumeSessionId, threadOptions)
          : codex.startThread(threadOptions);
        const { events } = await thread.runStreamed(message, { signal: controller.signal });
        for await (const event of events) {
          if (event.type === "thread.started") {
            nativeSessionId = event.thread_id;
            emit({
              runId,
              type: "init",
              sessionId: nativeSessionId,
              model: options.model ?? "default",
              cwd,
            });
            continue;
          }
          for (const normalized of normalizeCodexEvent(runId, event, startedTools)) {
            if (normalized.type === "text" && typeof normalized.text === "string") {
              resultText = resultText ? `${resultText}\n\n${normalized.text}` : normalized.text;
            }
            if (normalized.type === "result") {
              completed = true;
              normalized.sessionId = nativeSessionId;
              normalized.result = resultText;
              normalized.durationMs = Date.now() - startedAt;
            }
            if (normalized.type === "error") failed = true;
            emit(normalized);
          }
        }
        if (!completed && !failed && !stopped) {
          completed = true;
          emit({
            runId,
            type: "result",
            ok: true,
            result: resultText,
            durationMs: Date.now() - startedAt,
            sessionId: nativeSessionId,
          });
        }
      } catch (error) {
        if (!stopped && !completed) {
          failed = true;
          emit({
            runId,
            type: "error",
            message: `Codex failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } finally {
        emit({
          runId,
          type: "exit",
          code: stopped ? 130 : completed && !failed ? 0 : 1,
          stopped,
          sessionId: nativeSessionId,
        });
      }
    })();

    return {
      done,
      stop: () => {
        if (stopped) return false;
        stopped = true;
        controller.abort();
        return true;
      },
    };
  }
}

function bundledCodexVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("@openai/codex/package.json") as { version?: string };
    return pkg.version ? `codex-cli ${pkg.version}` : "Codex SDK bundled runtime";
  } catch {
    return "Codex SDK bundled runtime";
  }
}

function bundledCodexAvailable(): boolean {
  try {
    const platformPackages: Record<string, string> = {
      "darwin-arm64": "@openai/codex-darwin-arm64",
      "darwin-x64": "@openai/codex-darwin-x64",
      "linux-arm64": "@openai/codex-linux-arm64",
      "linux-x64": "@openai/codex-linux-x64",
      "win32-arm64": "@openai/codex-win32-arm64",
      "win32-x64": "@openai/codex-win32-x64",
    };
    const platformPackage = platformPackages[`${process.platform}-${process.arch}`];
    if (!platformPackage) return false;
    const require = createRequire(import.meta.url);
    require.resolve("@openai/codex/bin/codex.js");
    require.resolve(`${platformPackage}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function validateCodexOptions(options: ConversationOptions): {
  message: string;
  cwd: string;
  mode: string;
} {
  const message = validateMessage(options.message);
  const cwd = validateCwd(options.cwd);
  if (options.model && !MODEL_ID.test(options.model)) {
    throw new ProviderError(`Unsupported Codex model id: ${options.model}`);
  }
  const mode = options.permissionMode || "workspace-write";
  if (!allowedAccessModes().has(mode)) {
    if (mode === "danger-full-access") {
      throw new ProviderError(
        "Codex full access is disabled. Restart Odin with ODIN_ALLOW_BYPASS=1 to enable it.",
      );
    }
    throw new ProviderError(`Unsupported Codex access mode: ${mode}`);
  }
  return { message, cwd, mode };
}

export function normalizeCodexEvent(
  runId: string,
  event: ThreadEvent,
  startedTools = new Set<string>(),
): Array<Parameters<RuntimeEmit>[0]> {
  if (event.type === "turn.completed") {
    return [
      {
        runId,
        type: "result",
        ok: true,
        usage: {
          input: event.usage.input_tokens,
          cachedInput: event.usage.cached_input_tokens,
          cacheWriteInput: event.usage.cache_write_input_tokens,
          output: event.usage.output_tokens,
          reasoningOutput: event.usage.reasoning_output_tokens,
        },
      },
    ];
  }
  if (event.type === "turn.failed") {
    return [{ runId, type: "error", message: event.error.message }];
  }
  if (event.type === "error") return [{ runId, type: "error", message: event.message }];
  if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") {
    return [];
  }

  const terminal = event.type === "item.completed";
  const item = event.item;
  if (item.type === "agent_message") {
    return terminal && item.text.trim() ? [{ runId, type: "text", text: item.text }] : [];
  }
  if (item.type === "reasoning") {
    return terminal && item.text.trim() ? [{ runId, type: "thinking", text: item.text }] : [];
  }
  if (item.type === "error") {
    if (!terminal) return [];
    return [
      { runId, type: "tool_use", id: item.id, name: "Codex warning", input: {} },
      { runId, type: "tool_result", id: item.id, isError: true, output: item.message },
    ];
  }
  return normalizeCodexTool(runId, item, terminal, startedTools);
}

function normalizeCodexTool(
  runId: string,
  item: ThreadItem,
  terminal: boolean,
  startedTools: Set<string>,
): Array<Parameters<RuntimeEmit>[0]> {
  let name: string;
  let input: unknown;
  let failed = false;
  let output: unknown;

  switch (item.type) {
    case "command_execution":
      name = "Shell";
      input = { command: item.command };
      failed = item.status === "failed";
      output = item.aggregated_output;
      break;
    case "file_change":
      name = "File changes";
      input = { changes: item.changes };
      failed = item.status === "failed";
      break;
    case "mcp_tool_call":
      name = `${item.server}.${item.tool}`;
      input = item.arguments;
      failed = item.status === "failed";
      output = item.result ?? item.error;
      break;
    case "web_search":
      name = "Web search";
      input = { query: item.query };
      break;
    case "todo_list":
      name = "Plan";
      input = { items: item.items };
      break;
    default:
      return [];
  }

  const out: Array<Parameters<RuntimeEmit>[0]> = [];
  if (!startedTools.has(item.id)) {
    startedTools.add(item.id);
    out.push({ runId, type: "tool_use", id: item.id, name, input });
  }
  if (terminal) out.push({ runId, type: "tool_result", id: item.id, isError: failed, output });
  return out;
}

async function readCodexModels(): Promise<ProviderModel[]> {
  try {
    const parsed = JSON.parse(await readFile(join(codexHome(), "models_cache.json"), "utf8")) as {
      models?: Array<Record<string, unknown>>;
    };
    return (parsed.models ?? [])
      .filter((model) => model.visibility === "list" && typeof model.slug === "string")
      .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
      .map((model, index) => ({
        id: String(model.slug),
        label: typeof model.display_name === "string" ? model.display_name : String(model.slug),
        description: typeof model.description === "string" ? model.description : undefined,
        isDefault: index === 0,
      }));
  } catch {
    return [];
  }
}
