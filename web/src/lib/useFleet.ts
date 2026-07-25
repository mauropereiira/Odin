import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, qk } from "./api";
import type { CreateAgentRequest } from "./api";
import { providerLabel } from "./format";
import type { AgentInfo, ProviderId } from "./types";

export type FleetActivity =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; done: boolean; isError: boolean }
  | { kind: "error"; text: string };

export interface FleetAgent {
  info: AgentInfo;
  activity: FleetActivity[];
  lastCostUsd?: number;
}

interface FleetEvent extends Record<string, unknown> {
  kind: "agent";
  agentId: string;
  provider?: ProviderId;
  type: string;
}

export type FleetMutation = "prompt" | "stop" | "remove";

const ACTIVITY_LIMIT = 40;

export function useFleet() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.agents, queryFn: api.agents });
  const [records, setRecords] = useState<Record<string, FleetAgent>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, FleetMutation>>({});
  const [dispatching, setDispatching] = useState(false);
  const recordsRef = useRef(records);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    if (!query.data) return;
    setRecords((current) => {
      const next: Record<string, FleetAgent> = {};
      for (const info of query.data) {
        next[info.id] = {
          info,
          activity: current[info.id]?.activity ?? [],
          lastCostUsd: current[info.id]?.lastCostUsd,
        };
      }
      return next;
    });
  }, [query.data]);

  const update = useCallback((id: string, change: (agent: FleetAgent) => FleetAgent) => {
    setRecords((current) => {
      const agent = current[id];
      if (!agent) return current;
      return { ...current, [id]: change(agent) };
    });
  }, []);

  const append = useCallback((id: string, item: FleetActivity) => {
    update(id, (agent) => ({
      ...agent,
      activity: [...agent.activity, item].slice(-ACTIVITY_LIMIT),
      info: { ...agent.info, lastActivity: new Date().toISOString() },
    }));
  }, [update]);

  const processEvent = useCallback((event: FleetEvent) => {
    if (event.type === "created" && isRecord(event.agent) && typeof event.agent.id === "string") {
      const info = event.agent as unknown as AgentInfo;
      setRecords((current) => ({
        ...current,
        [info.id]: {
          info,
          activity: current[info.id]?.activity ?? [],
          lastCostUsd: current[info.id]?.lastCostUsd,
        },
      }));
      return;
    }
    const knownAgent = recordsRef.current[event.agentId];
    if (event.provider && knownAgent && event.provider !== knownAgent.info.provider) return;
    if (event.type === "removed") {
      setRecords((current) => {
        const next = { ...current };
        delete next[event.agentId];
        return next;
      });
      return;
    }
    if (event.type === "status") {
      update(event.agentId, (agent) => ({
        ...agent,
        info: {
          ...agent.info,
          status: agentStatus(event.status) ?? agent.info.status,
          lastSummary: typeof event.lastSummary === "string" ? event.lastSummary : agent.info.lastSummary,
          lastActivity: new Date().toISOString(),
        },
      }));
      return;
    }
    if (event.type === "start") {
      update(event.agentId, (agent) => ({
        ...agent,
        info: {
          ...agent.info,
          status: "working",
          lastRunId: typeof event.runId === "string" ? event.runId : agent.info.lastRunId,
          lastActivity: new Date().toISOString(),
        },
      }));
    } else if (event.type === "init") {
      update(event.agentId, (agent) => ({
        ...agent,
        info: {
          ...agent.info,
          sessionId: stringValue(event.sessionId) ?? agent.info.sessionId,
          model: stringValue(event.model) ?? agent.info.model,
          cwd: stringValue(event.cwd) ?? agent.info.cwd,
        },
      }));
    } else if (event.type === "text" && typeof event.text === "string") {
      append(event.agentId, { kind: "text", text: event.text });
    } else if (
      event.type === "tool_use" &&
      typeof event.id === "string" &&
      typeof event.name === "string"
    ) {
      append(event.agentId, {
        kind: "tool",
        id: event.id,
        name: event.name,
        input: event.input,
        done: false,
        isError: false,
      });
    } else if (event.type === "tool_result" && typeof event.id === "string") {
      update(event.agentId, (agent) => ({
        ...agent,
        activity: agent.activity.map((item) =>
          item.kind === "tool" && item.id === event.id
            ? { ...item, done: true, isError: event.isError === true }
            : item,
        ),
      }));
    } else if (event.type === "result") {
      update(event.agentId, (agent) => ({
        ...agent,
        lastCostUsd: finiteNumber(event.costUsd) ?? agent.lastCostUsd,
        activity: event.ok === false
          ? [
              ...agent.activity,
              {
                kind: "error" as const,
                text: typeof event.result === "string" && event.result
                  ? event.result
                  : "Agent did not complete the turn.",
              },
            ].slice(-ACTIVITY_LIMIT)
          : agent.activity,
        info: {
          ...agent.info,
          status: event.ok === false ? "error" : agent.info.status,
          sessionId: stringValue(event.sessionId) ?? agent.info.sessionId,
          lastSummary: typeof event.result === "string" && event.result
            ? event.result.slice(0, 240)
            : agent.info.lastSummary,
          lastActivity: new Date().toISOString(),
        },
      }));
    } else if (event.type === "rate_limit") {
      const info = isRecord(event.info) ? event.info : null;
      if (typeof info?.status === "string" && !info.status.startsWith("allowed")) {
        const label = providerLabel(
          knownAgent?.info.provider ?? (event.provider === "codex" ? "codex" : "claude-code"),
        );
        const message = `${label} rate limit reached.`;
        append(event.agentId, { kind: "error", text: message });
        update(event.agentId, (agent) => ({
          ...agent,
          info: { ...agent.info, status: "error", lastSummary: message },
        }));
      }
    } else if (event.type === "error") {
      const message = typeof event.message === "string" ? event.message : "Agent reported an error.";
      append(event.agentId, { kind: "error", text: message });
      update(event.agentId, (agent) => ({
        ...agent,
        info: { ...agent.info, status: "error", lastSummary: message },
      }));
    } else if (event.type === "exit") {
      const serverStatus = agentStatus(event.status);
      const failed = serverStatus ? serverStatus === "error" : (finiteNumber(event.code) ?? 0) !== 0;
      update(event.agentId, (agent) => ({
        ...agent,
        activity: [
          ...agent.activity.map((item) =>
            item.kind === "tool" && !item.done ? { ...item, done: true, isError: failed } : item,
          ),
          ...(failed && agent.info.status !== "error"
            ? [{ kind: "error" as const, text: `Agent exited with code ${finiteNumber(event.code) ?? 0}.` }]
            : []),
        ].slice(-ACTIVITY_LIMIT),
        info: {
          ...agent.info,
          status: serverStatus ?? (failed || agent.info.status === "error" ? "error" : "idle"),
          lastRunId: null,
          sessionId: stringValue(event.sessionId) ?? agent.info.sessionId,
          lastActivity: new Date().toISOString(),
        },
      }));
    }
  }, [append, update]);

  useEffect(() => {
    let disposed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => {
        void queryClient.invalidateQueries({ queryKey: qk.agents });
      };
      socket.onmessage = (frame) => {
        try {
          const event = JSON.parse(String(frame.data)) as FleetEvent;
          if (event.kind === "agent" && typeof event.agentId === "string") processEvent(event);
        } catch {
          /* Ignore malformed and unrelated frames. */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (!disposed) retryRef.current = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retryRef.current);
      socketRef.current?.close();
    };
  }, [processEvent, queryClient]);

  const dispatch = useCallback(async (request: CreateAgentRequest) => {
    setMutationError(null);
    setDispatching(true);
    try {
      const info = await api.createAgent(request);
      const userActivity: FleetActivity[] = request.message?.trim()
        ? [{ kind: "user", id: crypto.randomUUID(), text: request.message.trim() }]
        : [];
      setRecords((current) => ({
        ...current,
        [info.id]: {
          info,
          activity: [...userActivity, ...(current[info.id]?.activity ?? [])].slice(-ACTIVITY_LIMIT),
          lastCostUsd: current[info.id]?.lastCostUsd,
        },
      }));
      return info;
    } catch (cause) {
      setMutationError(errorMessage(cause));
      return null;
    } finally {
      setDispatching(false);
    }
  }, []);

  const prompt = useCallback(async (id: string, message: string) => {
    const text = message.trim();
    if (!text) return false;
    const activityId = crypto.randomUUID();
    setMutationError(null);
    setPending((current) => ({ ...current, [id]: "prompt" }));
    append(id, { kind: "user", id: activityId, text });
    update(id, (agent) => ({ ...agent, info: { ...agent.info, status: "working" } }));
    try {
      const result = await api.promptAgent(id, text);
      update(id, (agent) => ({
        ...agent,
        info: { ...agent.info, lastRunId: result.runId, lastActivity: new Date().toISOString() },
      }));
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      setMutationError(message);
      update(id, (agent) => ({
        ...agent,
        activity: [
          ...agent.activity.filter((item) => item.kind !== "user" || item.id !== activityId),
          { kind: "error", text: message } as const,
        ].slice(-ACTIVITY_LIMIT),
        info: { ...agent.info, status: "error" },
      }));
      return false;
    } finally {
      setPending((current) => withoutKey(current, id));
    }
  }, [append, update]);

  const stop = useCallback(async (id: string) => {
    setMutationError(null);
    setPending((current) => ({ ...current, [id]: "stop" }));
    try {
      const result = await api.stopAgent(id);
      if (result.stopped) {
        update(id, (agent) => ({
          ...agent,
          info: { ...agent.info, lastSummary: "Stopping..." },
        }));
      } else {
        setMutationError("Agent could not be stopped.");
      }
      return result.stopped;
    } catch (cause) {
      setMutationError(errorMessage(cause));
      return false;
    } finally {
      setPending((current) => withoutKey(current, id));
    }
  }, [update]);

  const remove = useCallback(async (id: string) => {
    const previous = recordsRef.current[id];
    if (previous?.info.lastRunId) {
      setMutationError("Stop the agent before removing it.");
      return false;
    }
    setMutationError(null);
    setPending((current) => ({ ...current, [id]: "remove" }));
    setRecords((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const result = await api.removeAgent(id);
      if (!result.removed) {
        if (previous) setRecords((current) => ({ ...current, [id]: previous }));
        setMutationError("Agent could not be removed.");
      }
      return result.removed;
    } catch (cause) {
      if (previous) setRecords((current) => ({ ...current, [id]: previous }));
      setMutationError(errorMessage(cause));
      return false;
    } finally {
      setPending((current) => withoutKey(current, id));
    }
  }, []);

  const agents = useMemo(
    () => Object.values(records).sort((a, b) => b.info.lastActivity.localeCompare(a.info.lastActivity)),
    [records],
  );
  const queryError = query.error ? errorMessage(query.error) : null;

  return {
    agents,
    loading: query.isLoading,
    error: mutationError ?? queryError,
    pending,
    dispatching,
    clearError: () => setMutationError(null),
    dispatch,
    prompt,
    stop,
    remove,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function agentStatus(value: unknown): AgentInfo["status"] | undefined {
  return value === "idle" || value === "working" || value === "error" ? value : undefined;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Fleet request failed.";
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
