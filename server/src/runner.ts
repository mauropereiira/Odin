import type { DistillPayload } from "./memory/librarian.js";
import { ClaudeRuntime } from "./providers/claude.js";
import { CodexRuntime } from "./providers/codex.js";
import { buildMcp } from "./providers/tools.js";
import {
  ProviderError,
  type AgentEvent,
  type AgentRuntime,
  type ConversationOptions,
  type ProviderCapability,
  type ProviderId,
  type RuntimeRun,
} from "./providers/types.js";

export type ConverseOptions = ConversationOptions;
export type { AgentEvent, ProviderCapability, ProviderId } from "./providers/types.js";
export { ProviderError as ConverseError, buildMcp };

const runtimes = new Map<ProviderId, AgentRuntime>();
runtimes.set("claude-code", new ClaudeRuntime());
runtimes.set("codex", new CodexRuntime());

interface ActiveRun {
  runtime: RuntimeRun;
  provider: ProviderId;
}

const runs = new Map<string, ActiveRun>();
let counter = 0;
let acceptingRuns = true;

type RememberHook = (payload: DistillPayload) => void;
let rememberHook: RememberHook | null = null;

export function setRememberHook(fn: RememberHook): void {
  rememberHook = fn;
}

export async function listProviderCapabilities(): Promise<ProviderCapability[]> {
  return Promise.all([...runtimes.values()].map((runtime) => runtime.capabilities()));
}

export function validateConversation(options: ConversationOptions): void {
  if (!acceptingRuns) throw new ProviderError("Odin is shutting down.");
  const provider = options.provider ?? "claude-code";
  const runtime = runtimes.get(provider);
  if (!runtime) throw new ProviderError(`Unsupported provider: ${String(provider)}`);
  runtime.validate(options);
}

/**
 * Provider-neutral entry point used by Converse and Fleet. Odin owns the run,
 * identity, memory lifecycle, and normalized events; each runtime only adapts
 * its native CLI protocol.
 */
export function startConversation(
  options: ConversationOptions,
  emit: (event: AgentEvent) => void,
): { runId: string } {
  if (!acceptingRuns) throw new ProviderError("Odin is shutting down.");
  const provider = options.provider ?? "claude-code";
  const runtime = runtimes.get(provider);
  if (!runtime) throw new ProviderError(`Unsupported provider: ${String(provider)}`);
  runtime.validate(options);

  const runId = `run_${Date.now().toString(36)}_${counter++}`;
  let assistantText = "";
  let nativeSessionId = options.resumeSessionId ?? null;
  let remembered = false;

  const handleEvent = (raw: Omit<AgentEvent, "provider">) => {
    const event = { ...raw, provider } as AgentEvent;
    if (typeof event.sessionId === "string" && event.sessionId) nativeSessionId = event.sessionId;
    if (event.type === "text" && typeof event.text === "string") {
      assistantText = assistantText ? `${assistantText}\n\n${event.text}` : event.text;
    }
    if (event.type === "result" && !remembered && event.ok !== false) {
      remembered = true;
      const finalText =
        typeof event.result === "string" && event.result.trim() ? event.result : assistantText;
      if (rememberHook && (finalText.trim() || options.message.trim())) {
        rememberHook({
          provider,
          userMessage: options.message,
          assistantText: finalText,
          cwd: options.cwd,
          project: options.project,
          sessionId: nativeSessionId,
          kind: options.orchestrator ? "converse" : "fleet",
        });
      }
    }
    emit(event);
    if (event.type === "exit") runs.delete(runId);
  };

  const run = runtime.start(runId, { ...options, provider }, handleEvent);
  runs.set(runId, { runtime: run, provider });
  return { runId };
}

export function stopConversation(runId: string): boolean {
  return runs.get(runId)?.runtime.stop() ?? false;
}

export async function stopAllConversations(): Promise<void> {
  acceptingRuns = false;
  const active = [...runs.values()];
  for (const run of active) run.runtime.stop();
  await Promise.race([
    Promise.allSettled(active.map((run) => run.runtime.done)),
    new Promise((resolve) => setTimeout(resolve, 2_500)),
  ]);
  runs.clear();
}
