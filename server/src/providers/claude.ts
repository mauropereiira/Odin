import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { composeOdinInstructions } from "../identity.js";
import { buildMcp, odinSkillsDir } from "./tools.js";
import {
  ProviderError,
  type AgentRuntime,
  type ConversationOptions,
  type ProviderCapability,
  type RuntimeEmit,
  type RuntimeRun,
} from "./types.js";
import { executableJson, executableVersion, resolveExecutable, validateCwd, validateMessage } from "./utils.js";

const MODEL_ALIASES = new Set(["opus", "sonnet", "haiku"]);

function claudeBin(): string {
  return process.env.ODIN_CLAUDE_BIN || process.env.HELM_CLAUDE_BIN || "claude";
}

function permissionModes(): Set<string> {
  return new Set(
    process.env.ODIN_ALLOW_BYPASS === "1"
      ? ["plan", "default", "acceptEdits", "bypassPermissions"]
      : ["plan", "default", "acceptEdits"],
  );
}

interface ClaudeRun {
  child: ChildProcess;
  sessionId: string | null;
}

export class ClaudeRuntime implements AgentRuntime {
  readonly id = "claude-code" as const;

  async capabilities(): Promise<ProviderCapability> {
    const executable = resolveExecutable(claudeBin());
    const [version, auth] = await Promise.all([
      executableVersion(claudeBin()),
      executable ? executableJson(claudeBin(), ["auth", "status", "--json"]) : null,
    ]);
    const allowBypass = process.env.ODIN_ALLOW_BYPASS === "1";
    return {
      id: this.id,
      label: "Claude Code",
      available: Boolean(executable),
      version,
      authenticated: auth?.loggedIn === true,
      models: [
        { id: "opus", label: "Opus" },
        { id: "sonnet", label: "Sonnet" },
        { id: "haiku", label: "Haiku" },
      ],
      accessModes: [
        { id: "plan", label: "Plan", description: "Read and reason without making changes." },
        { id: "default", label: "Default", description: "Claude's standard guarded permissions." },
        { id: "acceptEdits", label: "Auto-edit", description: "Allow edits while retaining tool safeguards." },
        ...(allowBypass
          ? [
              {
                id: "bypassPermissions",
                label: "Full auto",
                description: "Run tools without permission checks.",
                dangerous: true,
              },
            ]
          : []),
      ],
      defaultAccessMode: "default",
    };
  }

  validate(options: ConversationOptions): void {
    validateClaudeOptions(options);
  }

  start(
    runId: string,
    options: ConversationOptions,
    emit: RuntimeEmit,
  ): RuntimeRun {
    const { message, cwd, mode } = validateClaudeOptions(options);

    const mcp = buildMcp({
      orchestrator: options.orchestrator,
      provider: this.id,
      permissionMode: mode,
    });
    const instructions = composeOdinInstructions({
      provider: this.id,
      orchestrator: options.orchestrator,
      notesEnabled: "moldavite" in mcp.mcpServers,
      recall: options.recall,
    });
    const args = ["-p", message, "--output-format", "stream-json", "--verbose"];
    args.push("--append-system-prompt", instructions, "--permission-mode", mode);
    if (options.model) args.push("--model", options.model);
    if (options.resumeSessionId) args.push("--resume", options.resumeSessionId);
    if (process.env.ODIN_SKILLS_ENABLED !== "0") args.push("--plugin-dir", odinSkillsDir());
    if (Object.keys(mcp.mcpServers).length) {
      args.push("--mcp-config", JSON.stringify({ mcpServers: mcp.mcpServers }));
      args.push("--allowedTools", ...mcp.allowed);
    }

    let child: ChildProcess;
    try {
      child = spawn(claudeBin(), args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new ProviderError(`Failed to launch Claude Code: ${(error as Error).message}`);
    }

    const run: ClaudeRun = { child, sessionId: options.resumeSessionId ?? null };
    emit({ runId, type: "start", cwd, model: options.model ?? "default", permissionMode: mode });
    let sawResult = false;
    let stopped = false;
    let stderr = "";
    let finishRun!: () => void;
    const done = new Promise<void>((resolve) => {
      finishRun = resolve;
    });

    if (child.stdout) {
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => {
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(line.trim()) as Record<string, unknown>;
        } catch {
          return;
        }
        for (const event of normalizeClaudeEvent(runId, run, row)) {
          if (event.type === "result") sawResult = true;
          emit(event);
        }
      });
    }
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
    });
    child.on("error", (error) => emit({ runId, type: "error", message: error.message }));
    child.on("close", (code) => {
      if (code && !sawResult && !stopped) {
        emit({
          runId,
          type: "error",
          message: stderr.trim().slice(-800) || `Claude Code exited with code ${code}`,
        });
      }
      emit({
        runId,
        type: "exit",
        code: stopped ? 130 : code ?? 0,
        stopped,
        sessionId: run.sessionId,
      });
      finishRun();
    });

    return {
      done,
      stop: () => {
        if (stopped) return false;
        stopped = true;
        return child.kill("SIGTERM");
      },
    };
  }
}

function validateClaudeOptions(options: ConversationOptions): {
  message: string;
  cwd: string;
  mode: string;
} {
  const message = validateMessage(options.message);
  const cwd = validateCwd(options.cwd);
  if (options.model && !MODEL_ALIASES.has(options.model)) {
    throw new ProviderError(`Unsupported Claude model: ${options.model}`);
  }
  const mode = options.permissionMode || "default";
  if (!permissionModes().has(mode)) {
    if (mode === "bypassPermissions") {
      throw new ProviderError(
        "Full-auto is disabled. Restart Odin with ODIN_ALLOW_BYPASS=1 to enable it.",
      );
    }
    throw new ProviderError(`Unsupported Claude permission mode: ${mode}`);
  }
  return { message, cwd, mode };
}

export function normalizeClaudeEvent(
  runId: string,
  run: { sessionId: string | null },
  row: Record<string, unknown>,
): Array<Parameters<RuntimeEmit>[0]> {
  const out: Array<Parameters<RuntimeEmit>[0]> = [];
  const type = row.type;
  if (typeof row.session_id === "string" && !run.sessionId) run.sessionId = row.session_id;

  if (type === "system" && row.subtype === "init") {
    out.push({
      runId,
      type: "init",
      sessionId: row.session_id ?? run.sessionId,
      model: row.model,
      cwd: row.cwd,
    });
  } else if (type === "assistant") {
    const content = (row.message as Record<string, unknown>)?.content;
    if (Array.isArray(content)) {
      for (const raw of content) {
        if (!raw || typeof raw !== "object") continue;
        const block = raw as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          out.push({ runId, type: "text", text: block.text });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          out.push({ runId, type: "thinking", text: block.thinking });
        } else if (block.type === "tool_use") {
          out.push({
            runId,
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
    }
  } else if (type === "user") {
    const content = (row.message as Record<string, unknown>)?.content;
    if (Array.isArray(content)) {
      for (const raw of content) {
        if (!raw || typeof raw !== "object") continue;
        const block = raw as Record<string, unknown>;
        if (block.type === "tool_result") {
          out.push({
            runId,
            type: "tool_result",
            id: block.tool_use_id,
            isError: block.is_error === true,
            output: block.content,
          });
        }
      }
    }
  } else if (type === "rate_limit_event") {
    out.push({ runId, type: "rate_limit", info: row.rate_limit_info });
  } else if (type === "result") {
    out.push({
      runId,
      type: "result",
      ok: row.is_error !== true,
      result: typeof row.result === "string" ? row.result : null,
      costUsd: Number(row.total_cost_usd) || 0,
      durationMs: Number(row.duration_ms) || 0,
      numTurns: Number(row.num_turns) || 0,
      sessionId: row.session_id ?? run.sessionId,
    });
  }
  return out;
}
