import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type {
  AgentEvent,
  ConverseRecord,
  ProviderId,
  TranscriptTurn,
} from "./types";

export type ConversationStatus = "idle" | "running" | "error";

export type ConversationPart =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      output?: unknown;
      done: boolean;
      isError: boolean;
    };

export interface ConversationResult {
  ok?: boolean;
  result?: string | null;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  usage?: unknown;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  parts: ConversationPart[];
  thinking?: string;
  error?: string;
  result?: ConversationResult;
  costUsd?: number;
  durationMs?: number;
  done?: boolean;
}

interface WebSocketAgentEvent extends AgentEvent {
  kind: "agent";
}

interface LoadedConversation {
  messages: ConversationMessage[];
  conversationId: string;
  nativeSessionId: string | null;
}

export function useConversation({
  provider,
  cwd,
  model,
  permissionMode,
}: {
  provider: ProviderId;
  cwd: string;
  model?: string;
  permissionMode: string;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [status, setStatus] = useState<ConversationStatus>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [nativeSessionId, setNativeSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout>>();
  const activeRunRef = useRef<string | null>(null);
  const activeProviderRef = useRef<ProviderId | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const nativeSessionIdRef = useRef<string | null>(null);
  const awaitingRunRef = useRef(false);
  const sendingRef = useRef(false);
  const failedRunRef = useRef(false);
  const connectionLostRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const bufferedEventsRef = useRef<WebSocketAgentEvent[]>([]);

  const updateAssistant = useCallback(
    (update: (message: ConversationMessage) => ConversationMessage) => {
      setMessages((current) => {
        let index = current.length - 1;
        while (index >= 0 && current[index].role !== "assistant") index -= 1;
        if (index < 0) return current;
        const next = [...current];
        next[index] = update(next[index]);
        return next;
      });
    },
    [],
  );

  const captureNativeSession = useCallback((value: unknown) => {
    if (typeof value !== "string" || !value) return;
    nativeSessionIdRef.current = value;
    setNativeSessionId(value);
  }, []);

  const captureConversation = useCallback((value: string) => {
    conversationIdRef.current = value;
    setConversationId(value);
  }, []);

  const processEvent = useCallback((event: WebSocketAgentEvent) => {
    const expectedProvider = activeProviderRef.current;
    if (!expectedProvider || event.provider !== expectedProvider) return;
    const providerName = providerLabel(expectedProvider);

    if (event.type === "init") {
      captureNativeSession(event.sessionId);
    } else if (event.type === "thinking" && typeof event.text === "string") {
      const thinking = event.text;
      updateAssistant((message) => ({
        ...message,
        thinking: message.thinking ? `${message.thinking}\n\n${thinking}` : thinking,
      }));
    } else if (event.type === "text" && typeof event.text === "string") {
      const text = event.text;
      updateAssistant((message) => ({
        ...message,
        parts: [...message.parts, { kind: "text", text }],
      }));
    } else if (
      event.type === "tool_use" &&
      typeof event.id === "string" &&
      typeof event.name === "string"
    ) {
      const id = event.id;
      const name = event.name;
      updateAssistant((message) => ({
        ...message,
        parts: [
          ...message.parts,
          { kind: "tool", id, name, input: event.input, done: false, isError: false },
        ],
      }));
    } else if (event.type === "tool_result" && typeof event.id === "string") {
      const id = event.id;
      const output = event.output;
      updateAssistant((message) => ({
        ...message,
        parts: message.parts.some((part) => part.kind === "tool" && part.id === id)
          ? message.parts.map((part) =>
              part.kind === "tool" && part.id === id
                ? { ...part, output, done: true, isError: event.isError === true }
                : part,
            )
          : [
              ...message.parts,
              {
                kind: "tool" as const,
                id,
                name: "Tool",
                input: undefined,
                output,
                done: true,
                isError: event.isError === true,
              },
            ],
      }));
    } else if (event.type === "rate_limit") {
      const info = isRecord(event.info) ? event.info : null;
      if (typeof info?.status === "string" && !info.status.startsWith("allowed")) {
        const message = `${providerName} rate limit reached.`;
        setError(message);
        updateAssistant((assistant) => ({ ...assistant, error: message }));
      }
    } else if (event.type === "result") {
      captureNativeSession(event.sessionId);
      const result = resultMetadata(event);
      updateAssistant((message) => ({
        ...message,
        result,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      }));
      if (event.ok === false) {
        failedRunRef.current = true;
        setError(
          typeof event.result === "string" && event.result
            ? event.result
            : `Odin's ${providerName} provider did not complete the turn.`,
        );
      }
    } else if (event.type === "error") {
      const message = typeof event.message === "string"
        ? event.message
        : `Odin's ${providerName} provider reported an error.`;
      failedRunRef.current = true;
      setError(message);
      setStatus("error");
      updateAssistant((assistant) => ({ ...assistant, error: message, done: true }));
    } else if (event.type === "exit") {
      captureNativeSession(event.sessionId);
      const code = finiteNumber(event.code) ?? 0;
      const stopped = event.stopped === true;
      const failed = !stopped && (failedRunRef.current || code !== 0);
      if (!stopped && code !== 0) setError(`Odin's ${providerName} provider exited with code ${code}.`);
      if (stopped) setError(null);
      setStatus(failed ? "error" : "idle");
      activeRunRef.current = null;
      activeProviderRef.current = null;
      updateAssistant((message) => ({ ...message, done: true }));
    }
  }, [captureNativeSession, updateAssistant]);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socketRef.current = socket;
      socket.onmessage = (frame) => {
        try {
          const value = JSON.parse(String(frame.data)) as unknown;
          if (!isWebSocketAgentEvent(value) || typeof value.agentId === "string") return;
          if (value.provider !== activeProviderRef.current) return;
          if (value.runId === activeRunRef.current) processEvent(value);
          else if (awaitingRunRef.current) bufferedEventsRef.current.push(value);
        } catch {
          /* Ignore malformed or unrelated frames. */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        if (activeRunRef.current || awaitingRunRef.current) {
          const interruptedRun = activeRunRef.current;
          connectionLostRef.current = true;
          awaitingRunRef.current = false;
          bufferedEventsRef.current = [];
          setError("Odin's live provider connection was interrupted.");
          setStatus("error");
          updateAssistant((message) => ({ ...message, done: true }));
          if (interruptedRun) {
            void api.stopConversation(interruptedRun)
              .then((response) => {
                if (response.stopped && activeRunRef.current === interruptedRun) {
                  activeRunRef.current = null;
                  activeProviderRef.current = null;
                } else if (!response.stopped) {
                  setError("Odin lost its live connection; the provider may still be running. Use Stop to retry.");
                  setStatus("running");
                }
              })
              .catch(() => {
                setError("Odin lost its live connection; the provider may still be running. Use Stop to retry.");
                setStatus("running");
              });
          }
        }
        retryRef.current = setTimeout(connect, 1500);
      };
    };

    const stopOnPageHide = () => {
      const runId = activeRunRef.current;
      if (runId) {
        void fetch(`/api/converse/${encodeURIComponent(runId)}/stop`, {
          method: "POST",
          keepalive: true,
        });
      }
    };

    window.addEventListener("pagehide", stopOnPageHide);
    connect();
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", stopOnPageHide);
      clearTimeout(retryRef.current);
      socketRef.current?.close();
    };
  }, [processEvent, updateAssistant]);

  const send = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text || !cwd || sendingRef.current || activeRunRef.current) return;
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError("Odin's live provider connection is not ready. Try again in a moment.");
      setStatus("error");
      return;
    }

    sendingRef.current = true;
    awaitingRunRef.current = true;
    activeProviderRef.current = provider;
    failedRunRef.current = false;
    connectionLostRef.current = false;
    cancelRequestedRef.current = false;
    bufferedEventsRef.current = [];
    setError(null);
    setStatus("running");
    setMessages((current) => [
      ...current,
      { role: "user", parts: [{ kind: "text", text }], done: true },
      { role: "assistant", parts: [], done: false },
    ]);

    try {
      const response = await api.converse({
        provider,
        message: text,
        cwd,
        model,
        permissionMode,
        conversationId: conversationIdRef.current || undefined,
      });
      captureConversation(response.conversationId);
      activeRunRef.current = response.runId;
      awaitingRunRef.current = false;
      const buffered = bufferedEventsRef.current;
      bufferedEventsRef.current = [];
      for (const event of buffered) {
        if (event.runId === response.runId && event.provider === provider) processEvent(event);
      }
      if (connectionLostRef.current || cancelRequestedRef.current) {
        if (!connectionLostRef.current && !activeRunRef.current) return;
        const stopped = await api.stopConversation(response.runId).catch(() => ({ stopped: false }));
        if (connectionLostRef.current || !stopped.stopped) {
          if (activeRunRef.current === response.runId) {
            activeRunRef.current = stopped.stopped ? null : response.runId;
            if (stopped.stopped) activeProviderRef.current = null;
          }
        }
        if (!stopped.stopped) {
          setError(`Odin's ${providerLabel(provider)} provider could not be stopped.`);
          setStatus("running");
        }
        return;
      }
    } catch (cause) {
      awaitingRunRef.current = false;
      activeRunRef.current = null;
      activeProviderRef.current = null;
      bufferedEventsRef.current = [];
      setError(
        cause instanceof Error
          ? cause.message
          : `Unable to start Odin's ${providerLabel(provider)} provider.`,
      );
      setStatus("error");
      updateAssistant((assistant) => ({ ...assistant, done: true }));
    } finally {
      sendingRef.current = false;
    }
  }, [captureConversation, cwd, model, permissionMode, processEvent, provider, updateAssistant]);

  const stop = useCallback(async () => {
    if (awaitingRunRef.current) {
      cancelRequestedRef.current = true;
      setError("Stopping as soon as the provider starts...");
      return;
    }
    const runId = activeRunRef.current;
    if (!runId) return;
    const providerName = providerLabel(activeProviderRef.current ?? provider);
    try {
      const response = await api.stopConversation(runId);
      if (!response.stopped) setError(`Odin's ${providerName} provider could not be stopped.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `Unable to stop Odin's ${providerName} provider.`,
      );
    }
  }, [provider]);

  const reset = useCallback(() => {
    if (activeRunRef.current) return;
    conversationIdRef.current = null;
    nativeSessionIdRef.current = null;
    activeProviderRef.current = null;
    setConversationId(null);
    setNativeSessionId(null);
    setMessages([]);
    setError(null);
    setStatus("idle");
  }, []);

  const load = useCallback((loaded: LoadedConversation) => {
    if (activeRunRef.current) return false;
    conversationIdRef.current = loaded.conversationId;
    nativeSessionIdRef.current = loaded.nativeSessionId;
    activeProviderRef.current = null;
    setConversationId(loaded.conversationId);
    setNativeSessionId(loaded.nativeSessionId);
    setMessages(loaded.messages);
    setError(null);
    setStatus("idle");
    return true;
  }, []);

  return {
    messages,
    status,
    conversationId,
    nativeSessionId,
    error,
    send,
    stop,
    reset,
    load,
  };
}

/** Rebuild an Odin conversation from its provider-normalized event records. */
export function recordsToMessages(
  records: ConverseRecord[],
  provider?: ProviderId,
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  for (const record of records) {
    if (record.kind === "user") {
      if (record.text) {
        messages.push({
          role: "user",
          parts: [{ kind: "text", text: record.text }],
          done: true,
        });
      }
      continue;
    }

    const event = record.event;
    if (provider && event.provider !== provider) continue;
    if (event.type === "start" || event.type === "init") continue;
    const assistant = ensureAssistant(messages);

    if (event.type === "thinking" && typeof event.text === "string") {
      assistant.thinking = assistant.thinking
        ? `${assistant.thinking}\n\n${event.text}`
        : event.text;
    } else if (event.type === "text" && typeof event.text === "string") {
      assistant.parts.push({ kind: "text", text: event.text });
    } else if (
      event.type === "tool_use" &&
      typeof event.id === "string" &&
      typeof event.name === "string"
    ) {
      const existing = assistant.parts.find(
        (part): part is Extract<ConversationPart, { kind: "tool" }> =>
          part.kind === "tool" && part.id === event.id,
      );
      if (existing) {
        existing.name = event.name;
        existing.input = event.input;
      } else {
        assistant.parts.push({
          kind: "tool",
          id: event.id,
          name: event.name,
          input: event.input,
          done: false,
          isError: false,
        });
      }
    } else if (event.type === "tool_result" && typeof event.id === "string") {
      const tool = assistant.parts.find(
        (part): part is Extract<ConversationPart, { kind: "tool" }> =>
          part.kind === "tool" && part.id === event.id,
      );
      if (tool) {
        tool.output = event.output;
        tool.done = true;
        tool.isError = event.isError === true;
      } else {
        assistant.parts.push({
          kind: "tool",
          id: event.id,
          name: "Tool",
          input: undefined,
          output: event.output,
          done: true,
          isError: event.isError === true,
        });
      }
    } else if (event.type === "rate_limit") {
      const info = isRecord(event.info) ? event.info : null;
      if (typeof info?.status === "string" && !info.status.startsWith("allowed")) {
        assistant.error = "Provider rate limit reached.";
      }
    } else if (event.type === "result") {
      const result = resultMetadata(event);
      assistant.result = result;
      assistant.costUsd = result.costUsd;
      assistant.durationMs = result.durationMs;
      assistant.done = true;
      assistant.parts = assistant.parts.map((part) =>
        part.kind === "tool" && !part.done
          ? { ...part, done: true, isError: event.ok === false }
          : part,
      );
      if (event.ok === false && typeof event.result === "string" && event.result) {
        assistant.error = event.result;
      }
    } else if (event.type === "error") {
      assistant.error = typeof event.message === "string"
        ? event.message
        : "The provider reported an error.";
      assistant.done = true;
    } else if (event.type === "exit") {
      assistant.done = true;
      if (event.stopped !== true && (finiteNumber(event.code) ?? 0) !== 0 && !assistant.error) {
        assistant.error = `The provider exited with code ${finiteNumber(event.code) ?? 0}.`;
      }
      assistant.parts = assistant.parts.map((part) =>
        part.kind === "tool" && !part.done ? { ...part, done: true } : part,
      );
    }
  }

  return messages;
}

/** Rebuild a conversation view from a legacy Claude Code transcript. */
export function turnsToMessages(turns: TranscriptTurn[]): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  for (const turn of turns) {
    if (turn.role === "user") {
      if (turn.text) out.push({ role: "user", parts: [{ kind: "text", text: turn.text }], done: true });
    } else if (turn.role === "assistant") {
      const parts: ConversationPart[] = [];
      if (turn.text) parts.push({ kind: "text", text: turn.text });
      (turn.toolCalls ?? []).forEach((call, index) => {
        parts.push({
          kind: "tool",
          id: `${turn.uuid}-${index}`,
          name: call.name,
          input: call.input,
          done: true,
          isError: false,
        });
      });
      if (parts.length) {
        out.push({
          role: "assistant",
          parts,
          done: true,
          costUsd: turn.costUsd,
          result: { costUsd: turn.costUsd },
        });
      }
    }
  }
  return out;
}

function ensureAssistant(messages: ConversationMessage[]): ConversationMessage {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") return last;
  const assistant: ConversationMessage = { role: "assistant", parts: [], done: false };
  messages.push(assistant);
  return assistant;
}

function resultMetadata(event: AgentEvent): ConversationResult {
  return {
    ok: typeof event.ok === "boolean" ? event.ok : undefined,
    result: typeof event.result === "string" || event.result === null ? event.result : undefined,
    costUsd: finiteNumber(event.costUsd),
    durationMs: finiteNumber(event.durationMs),
    numTurns: finiteNumber(event.numTurns),
    usage: event.usage,
  };
}

function isWebSocketAgentEvent(value: unknown): value is WebSocketAgentEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.kind === "agent" &&
    (event.provider === "claude-code" || event.provider === "codex") &&
    typeof event.runId === "string" &&
    typeof event.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerLabel(provider: ProviderId): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
