import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, qk } from "../lib/api";
import { recordsToMessages, turnsToMessages, useConversation } from "../lib/useConversation";
import type { ConversationMessage, ConversationStatus } from "../lib/useConversation";
import type { ConverseSession, ProviderCapability, ProviderId } from "../lib/types";

interface ConverseContextValue {
  messages: ConversationMessage[];
  status: ConversationStatus;
  conversationId: string | null;
  nativeSessionId: string | null;
  error: string | null;
  providers: ProviderCapability[];
  providersLoading: boolean;
  providersError: string | null;
  provider: ProviderId;
  cwd: string;
  model?: string;
  permissionMode: string;
  providerLocked: boolean;
  resumeLoadingId: string | null;
  resumeError: string | null;
  send: (message: string) => Promise<void>;
  stop: () => Promise<void>;
  newChat: () => void;
  resume: (session: ConverseSession) => Promise<void>;
  setProvider: (provider: ProviderId) => void;
  setCwd: (cwd: string) => void;
  setModel: (model?: string) => void;
  setPermissionMode: (mode: string) => void;
}

const ConverseContext = createContext<ConverseContextValue | null>(null);

/** Holds the Converse conversation above the router so it survives navigation. */
export function ConverseProvider({ children }: { children: ReactNode }) {
  const providersQuery = useQuery({ queryKey: qk.providers, queryFn: api.providers });
  const providers = providersQuery.data ?? [];
  const [provider, setProviderState] = useState<ProviderId>("claude-code");
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState<string | undefined>();
  const [permissionMode, setPermissionMode] = useState("default");
  const [resumeLoadingId, setResumeLoadingId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const resumeRequestRef = useRef(0);
  const conversation = useConversation({ provider, cwd, model, permissionMode });
  const providerLocked = Boolean(conversation.conversationId || conversation.messages.length);

  useEffect(() => {
    if (!providers.length || resumeLoadingId) return;
    const selected = providers.find((item) => item.id === provider);
    const fallback = providers.find((item) => item.available && item.authenticated !== false)
      ?? providers.find((item) => item.available)
      ?? providers[0];
    const next = providerLocked
      ? selected
      : selected?.available && selected.authenticated !== false
        ? selected
        : fallback;
    if (!next) return;
    if (next.id !== provider && !providerLocked) {
      setProviderState(next.id);
      setModel(undefined);
      setPermissionMode(next.defaultAccessMode);
      return;
    }
    if (!next.accessModes.some((mode) => mode.id === permissionMode)) {
      setPermissionMode(next.defaultAccessMode);
    }
    if (!providerLocked && model && !next.models.some((item) => item.id === model)) setModel(undefined);
  }, [model, permissionMode, provider, providerLocked, providers, resumeLoadingId]);

  const setProvider = useCallback((nextProvider: ProviderId) => {
    if (providerLocked) return;
    const capability = providers.find((item) => item.id === nextProvider);
    setProviderState(nextProvider);
    setModel(undefined);
    setPermissionMode(capability?.defaultAccessMode ?? "default");
    setResumeError(null);
  }, [providerLocked, providers]);

  const newChat = useCallback(() => {
    resumeRequestRef.current += 1;
    setResumeLoadingId(null);
    setResumeError(null);
    conversation.reset();
  }, [conversation]);

  const resume = useCallback(async (session: ConverseSession) => {
    if (conversation.status === "running") return;
    const requestId = ++resumeRequestRef.current;
    setResumeLoadingId(session.id);
    setResumeError(null);
    try {
      const detail = await api.converseSession(session.id);
      let messages = recordsToMessages(detail.records, detail.session.provider);
      const isLegacyClaudeSession =
        detail.session.provider === "claude-code" &&
        detail.session.nativeSessionId === detail.session.id;
      if (isLegacyClaudeSession && detail.session.nativeSessionId) {
        try {
          const legacy = await api.session(detail.session.nativeSessionId);
          messages = turnsToMessages(legacy.turns);
        } catch (cause) {
          if (!detail.records.length) throw cause;
        }
      }
      if (requestId !== resumeRequestRef.current) return;
      const loaded = conversation.load({
        messages,
        conversationId: detail.session.id,
        nativeSessionId: detail.session.nativeSessionId,
      });
      if (!loaded) throw new Error("Odin is already running another conversation.");

      const capability = providers.find((item) => item.id === detail.session.provider);
      setProviderState(detail.session.provider);
      setCwd(detail.session.cwd);
      setModel(detail.session.model);
      setPermissionMode(
        detail.session.permissionMode
          ?? capability?.defaultAccessMode
          ?? (detail.session.provider === "claude-code" ? "default" : "workspace-write"),
      );
    } catch (cause) {
      if (requestId !== resumeRequestRef.current) return;
      const message = cause instanceof Error ? cause.message : "Unable to resume the Odin conversation.";
      setResumeError(message);
      throw cause;
    } finally {
      if (requestId === resumeRequestRef.current) setResumeLoadingId(null);
    }
  }, [conversation, providers]);

  const value: ConverseContextValue = {
    messages: conversation.messages,
    status: conversation.status,
    conversationId: conversation.conversationId,
    nativeSessionId: conversation.nativeSessionId,
    error: conversation.error,
    providers,
    providersLoading: providersQuery.isLoading,
    providersError: providersQuery.error instanceof Error ? providersQuery.error.message : null,
    provider,
    cwd,
    model,
    permissionMode,
    providerLocked,
    resumeLoadingId,
    resumeError,
    send: conversation.send,
    stop: conversation.stop,
    newChat,
    resume,
    setProvider,
    setCwd,
    setModel,
    setPermissionMode,
  };

  return <ConverseContext.Provider value={value}>{children}</ConverseContext.Provider>;
}

export function useConverse(): ConverseContextValue {
  const ctx = useContext(ConverseContext);
  if (!ctx) throw new Error("useConverse must be used within a ConverseProvider");
  return ctx;
}
