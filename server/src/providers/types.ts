export type ProviderId = "claude-code" | "codex";

export interface ProviderModel {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export interface ProviderAccessMode {
  id: string;
  label: string;
  description: string;
  dangerous?: boolean;
}

export interface ProviderCapability {
  id: ProviderId;
  label: string;
  available: boolean;
  version?: string;
  authenticated?: boolean;
  models: ProviderModel[];
  accessModes: ProviderAccessMode[];
  defaultAccessMode: string;
}

export interface ConversationOptions {
  provider?: ProviderId;
  message: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  resumeSessionId?: string;
  orchestrator?: boolean;
  recall?: string;
  project?: string;
}

export interface AgentEvent {
  runId: string;
  provider: ProviderId;
  type:
    | "start"
    | "init"
    | "thinking"
    | "text"
    | "tool_use"
    | "tool_result"
    | "result"
    | "rate_limit"
    | "error"
    | "exit";
  [key: string]: unknown;
}

export interface RuntimeRun {
  stop(): boolean;
  done: Promise<void>;
}

export type RuntimeEmit = (event: Omit<AgentEvent, "provider">) => void;

export interface AgentRuntime {
  id: ProviderId;
  validate(options: ConversationOptions): void;
  start(runId: string, options: ConversationOptions, emit: RuntimeEmit): RuntimeRun;
  capabilities(): Promise<ProviderCapability>;
}

export class ProviderError extends Error {}
