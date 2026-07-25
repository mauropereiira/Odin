import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, qk } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { ConverseSession } from "../lib/types";
import { ProviderBadge } from "./ProviderBadge";
import { useConverse } from "./ConverseProvider";

export function ConverseSidebar() {
  const queryClient = useQueryClient();
  const conversation = useConverse();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const running = conversation.status === "running";
  const sessionsQuery = useQuery({
    queryKey: qk.converseSessions,
    queryFn: api.converseSessions,
    refetchInterval: 20_000,
  });
  const sessions = sessionsQuery.data ?? [];
  const surfacedError = deleteError
    ?? conversation.resumeError
    ?? (sessionsQuery.error instanceof Error ? sessionsQuery.error.message : null);

  const remove = async (session: ConverseSession) => {
    if (running || conversation.resumeLoadingId || deletingId) return;
    if (!window.confirm(`Permanently delete "${session.title}" and its transcript? This cannot be undone.`)) return;
    const previous = queryClient.getQueryData<ConverseSession[]>(qk.converseSessions);
    setDeleteError(null);
    setDeletingId(session.id);
    queryClient.setQueryData<ConverseSession[]>(qk.converseSessions, (current = []) =>
      current.filter((item) => item.id !== session.id),
    );
    try {
      const result = await api.deleteConverseSession(session.id);
      if (!result.removed) throw new Error("Odin could not remove that conversation.");
      if (conversation.conversationId === session.id) conversation.newChat();
      await queryClient.invalidateQueries({ queryKey: qk.converseSessions });
    } catch (cause) {
      if (previous) queryClient.setQueryData(qk.converseSessions, previous);
      setDeleteError(cause instanceof Error ? cause.message : "Unable to remove the conversation.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <aside className="flex w-full shrink-0 flex-col gap-2 border-b border-line pb-3 lg:w-60 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={conversation.newChat}
          disabled={running}
          className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-panel/50 px-3 py-2 text-sm text-ink transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={14} /> New chat
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen((open) => !open)}
          aria-expanded={historyOpen}
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 readout text-xs text-ink-dim lg:hidden"
        >
          History {sessions.length}
          <ChevronDown size={13} className={historyOpen ? "rotate-180" : ""} />
        </button>
      </div>

      {surfacedError && (
        <p className="rounded-md border border-rose/20 bg-rose/5 px-2 py-1.5 text-xs text-rose">
          {surfacedError}
        </p>
      )}

      <div
        className={`${historyOpen ? "flex" : "hidden"} mt-1 min-h-0 flex-1 gap-2 overflow-x-auto lg:flex lg:flex-col lg:space-y-1 lg:overflow-x-hidden lg:overflow-y-auto`}
      >
        {!sessionsQuery.isLoading && sessions.length === 0 && (
          <p className="shrink-0 px-1 text-xs text-ink-faint">Your chats with Odin will appear here.</p>
        )}
        {sessions.map((session) => {
          const active = conversation.conversationId === session.id;
          const resuming = conversation.resumeLoadingId === session.id;
          return (
            <div
              key={session.id}
              className={`group flex w-56 shrink-0 items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors lg:w-full ${
                active
                  ? "border-clay/50 bg-panel"
                  : "border-transparent hover:border-line hover:bg-panel/40"
              }`}
            >
              <button
                type="button"
                onClick={() => void conversation.resume(session).catch(() => undefined)}
                disabled={running || Boolean(conversation.resumeLoadingId) || deletingId === session.id}
                className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm text-ink">{session.title}</div>
                  {resuming && <LoaderCircle size={12} className="shrink-0 animate-spin text-clay" />}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <ProviderBadge provider={session.provider} />
                  <span className="truncate readout text-[10px] text-ink-faint">
                    {session.project} · {relativeTime(session.updatedAt)}
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => void remove(session)}
                disabled={running || Boolean(conversation.resumeLoadingId) || Boolean(deletingId)}
                className="rounded p-0.5 text-ink-faint opacity-60 transition-colors hover:text-rose disabled:cursor-not-allowed disabled:opacity-25 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                title="Permanently delete transcript"
                aria-label={`Permanently delete ${session.title}`}
              >
                {deletingId === session.id
                  ? <LoaderCircle size={13} className="animate-spin" />
                  : <Trash2 size={13} />}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
