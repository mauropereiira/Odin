import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, MessagesSquare, Send, Square } from "lucide-react";
import { api, qk } from "../lib/api";
import { duration, usd } from "../lib/format";
import type { ProviderId } from "../lib/types";
import type { ConversationMessage, ConversationPart } from "../lib/useConversation";
import { useConverse } from "../components/ConverseProvider";
import { ConverseSidebar } from "../components/ConverseSidebar";
import { ProviderBadge } from "../components/ProviderBadge";
import { MicroLabel, Pill, Skeleton } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { ToolChip } from "../components/ToolChip";

const controlClass =
  "h-9 rounded-lg border border-line bg-panel-2 px-3 readout text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-clay/60 disabled:cursor-not-allowed disabled:opacity-50";

export function Converse() {
  const [searchParams] = useSearchParams();
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: qk.projects,
    queryFn: api.projects,
  });
  const conversation = useConverse();
  const {
    cwd,
    model,
    permissionMode,
    provider,
    setCwd,
    setModel,
    setPermissionMode,
    setProvider,
  } = conversation;
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const running = conversation.status === "running";
  const resuming = Boolean(conversation.resumeLoadingId);
  const selectedProvider = conversation.providers.find((item) => item.id === provider);
  const selectedAccessMode = selectedProvider?.accessModes.find(
    (mode) => mode.id === permissionMode,
  );
  const providerReady = Boolean(
    selectedProvider?.available && selectedProvider.authenticated !== false,
  );

  useEffect(() => {
    if (cwd) return;
    const param = searchParams.get("cwd");
    if (param) {
      setCwd(param);
      return;
    }
    if (!projects.length) return;
    setCwd(projects[0].path);
  }, [cwd, projects, searchParams, setCwd]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [conversation.messages, conversation.status]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.path === cwd),
    [cwd, projects],
  );
  const unknownCwd = Boolean(cwd && !selectedProject);

  const submit = () => {
    const message = draft.trim();
    if (!message || !cwd || running || resuming || !providerReady) return;
    setDraft("");
    void conversation.send(message);
  };

  const startWith = (message: string) => {
    if (!cwd || running || resuming || !providerReady) return;
    void conversation.send(message);
  };

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[600px] lg:flex-row">
      <ConverseSidebar />
      <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="rise flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Converse</h1>
            <RunStatus status={conversation.status} />
            <ProviderBadge provider={provider} label={selectedProvider?.label} />
          </div>
          <p className="mt-0.5 text-sm text-ink-dim">
            Direct Odin through the selected provider and continue one durable conversation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            conversation.newChat();
            setDraft("");
          }}
          disabled={running || resuming || (!conversation.messages.length && !conversation.conversationId)}
          className="rounded-lg border border-line px-3 py-2 readout text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          New conversation
        </button>
      </header>

      <section className="panel rise flex min-h-[620px] flex-1 flex-col overflow-hidden lg:min-h-0">
        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {conversation.messages.length ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
              {conversation.messages.map((message, index) => (
                <ConversationTurn
                  key={index}
                  message={message}
                  provider={provider}
                  nativeSessionId={conversation.nativeSessionId}
                  running={running && index === conversation.messages.length - 1}
                />
              ))}
            </div>
          ) : projectsLoading ? (
            <ConversationSkeleton />
          ) : (
            <ConversationEmpty
              project={selectedProject?.label}
              disabled={!cwd || !providerReady || resuming}
              onSelect={startWith}
            />
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-panel/95 p-3">
          <div className="mx-auto max-w-4xl">
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(150px,auto)_minmax(150px,auto)_minmax(170px,auto)]">
              <Control label="Project / dir" className="min-w-0 sm:col-span-2 xl:col-span-1">
                <select
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  disabled={running || resuming || projectsLoading}
                  className={`${controlClass} w-full`}
                >
                  {!cwd && <option value="">No project selected</option>}
                  {unknownCwd && <option value={cwd}>{cwd}</option>}
                  {projects.map((project) => (
                    <option key={project.dir} value={project.path}>
                      {project.label} — {project.path}
                    </option>
                  ))}
                </select>
              </Control>
              <Control label="Provider">
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as ProviderId)}
                  disabled={running || resuming || conversation.providerLocked || conversation.providersLoading}
                  className={`${controlClass} w-full`}
                >
                  {!conversation.providers.length && (
                    <option value={provider}>Loading providers...</option>
                  )}
                  {conversation.providers.map((item) => (
                    <option key={item.id} value={item.id} disabled={!item.available}>
                      {item.label}
                      {!item.available ? " (unavailable)" : item.authenticated === false ? " (sign-in required)" : ""}
                    </option>
                  ))}
                </select>
              </Control>
              <Control label="Model">
                <select
                  value={model || ""}
                  onChange={(event) => setModel(event.target.value || undefined)}
                  disabled={running || resuming || !providerReady}
                  className={`${controlClass} w-full`}
                >
                  <option value="">
                    {selectedProvider?.models.find((item) => item.isDefault)?.label
                      ? `Default (${selectedProvider.models.find((item) => item.isDefault)?.label})`
                      : "Provider default"}
                  </option>
                  {model && !selectedProvider?.models.some((item) => item.id === model) && (
                    <option value={model}>{model}</option>
                  )}
                  {selectedProvider?.models.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </Control>
              <Control label="Access">
                <select
                  value={permissionMode}
                  onChange={(event) => setPermissionMode(event.target.value)}
                  disabled={running || resuming || !providerReady}
                  className={`${controlClass} w-full`}
                >
                  {permissionMode && !selectedProvider?.accessModes.some((mode) => mode.id === permissionMode) && (
                    <option value={permissionMode}>{permissionMode}</option>
                  )}
                  {selectedProvider?.accessModes.map((mode) => (
                    <option key={mode.id} value={mode.id}>{mode.label}</option>
                  ))}
                </select>
              </Control>
            </div>

            {selectedProvider && (
              <div className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 readout text-[10px] ${providerReady ? "text-ink-faint" : "text-amber"}`}>
                <span>
                  {selectedProvider.available
                    ? selectedProvider.authenticated === false
                      ? `${selectedProvider.label} needs authentication before Odin can use it.`
                      : `${selectedProvider.label} ready`
                    : `${selectedProvider.label} is not installed or available.`}
                </span>
                {selectedProvider.version && <span>{selectedProvider.version}</span>}
                {selectedAccessMode?.description && <span>{selectedAccessMode.description}</span>}
              </div>
            )}
            {conversation.providersError && (
              <div className="mb-3 text-xs text-amber">Unable to load providers: {conversation.providersError}</div>
            )}
            {selectedAccessMode?.dangerous && (
              <div className="mb-3 flex items-center gap-2 text-xs text-amber">
                <CircleAlert size={13} /> {selectedAccessMode.label} removes provider safeguards. Review the task and working directory first.
              </div>
            )}
            {!projectsLoading && !cwd && (
              <div className="mb-3 text-xs text-amber">No project directories are available.</div>
            )}
            {conversation.error && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber/20 bg-amber/5 px-3 py-2 text-xs text-amber">
                <CircleAlert size={13} className="mt-0.5 shrink-0" />
                <span>{conversation.error}</span>
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder={running ? "Odin is working…" : "Tell Odin what to do…"}
                disabled={running || resuming || !providerReady}
                className="min-h-[54px] min-w-0 flex-1 resize-none rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm leading-5 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay/60 disabled:cursor-not-allowed disabled:opacity-60"
              />
              {running && (
                <button
                  type="button"
                  onClick={() => void conversation.stop()}
                  className="flex h-[54px] items-center gap-2 rounded-xl border border-amber/30 px-4 readout text-xs text-amber transition-colors hover:bg-amber/10"
                >
                  <Square size={12} fill="currentColor" /> Stop
                </button>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim() || !cwd || running || resuming || !providerReady}
                className="flex h-[54px] items-center gap-2 rounded-xl bg-clay px-4 readout text-xs text-void transition-colors hover:bg-clay-bright disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Send size={14} /> Send
              </button>
            </div>
            <p className="mt-2 readout text-[10px] text-ink-faint">
              Enter to send · Shift+Enter for newline
            </p>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}

function RunStatus({ status }: { status: "idle" | "running" | "error" }) {
  if (status === "running") {
    return <Pill tone="clay"><span className="live-dot h-1.5 w-1.5 rounded-full bg-clay" /> active</Pill>;
  }
  if (status === "error") return <Pill tone="amber">attention</Pill>;
  return <Pill tone="teal">ready</Pill>;
}

function Control({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <MicroLabel className="mb-1 block">{label}</MicroLabel>
      {children}
    </label>
  );
}

function ConversationTurn({
  message,
  provider,
  nativeSessionId,
  running,
}: {
  message: ConversationMessage;
  provider: ProviderId;
  nativeSessionId: string | null;
  running: boolean;
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((part): part is Extract<ConversationPart, { kind: "text" }> => part.kind === "text")
      .map((part) => part.text)
      .join("\n");
    return (
      <div className="rise flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md border border-clay/20 bg-clay/10 px-4 py-3 text-sm leading-6 text-ink">
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <article className="rise max-w-[92%]">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-iris" />
        <MicroLabel>Odin</MicroLabel>
        <ProviderBadge provider={provider} />
      </div>
      {message.thinking && (
        <details className="mb-3 text-xs text-ink-faint">
          <summary className="cursor-pointer select-none readout transition-colors hover:text-ink-dim">
            · reasoning
          </summary>
          <p className="mt-2 whitespace-pre-wrap border-l border-line pl-3 leading-5">
            {message.thinking}
          </p>
        </details>
      )}
      <div className="flex flex-col gap-3">
        {message.parts.map((part, index) =>
          part.kind === "text" ? (
            <div key={index} className="rise min-w-0">
              <Markdown text={part.text} />
              {running && index === message.parts.length - 1 && (
                <span className="agent-cursor ml-0.5 inline-block h-4 w-1 bg-clay align-[-2px]" />
              )}
            </div>
          ) : (
            <ToolChip
              key={part.id}
              name={part.name}
              input={part.input}
              done={part.done}
              isError={part.isError}
              className="rise"
            />
          ),
        )}
        {!message.parts.length && running && (
          <div className="flex items-center gap-2 py-1 text-xs text-ink-faint">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-clay" />
            <span className="readout">Odin is preparing…</span>
          </div>
        )}
        {!message.parts.length && message.done && (
          <p className="text-sm italic text-ink-faint">No response returned.</p>
        )}
        {message.error && (
          <p className="flex items-start gap-2 text-xs leading-5 text-rose">
            <CircleAlert size={12} className="mt-1 shrink-0" /> {message.error}
          </p>
        )}
      </div>
      {message.done && (
        <footer className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-2.5">
          {(message.costUsd !== undefined || message.durationMs !== undefined) && (
            <span className="readout text-[10px] text-ink-faint">
              {message.costUsd !== undefined ? `est. ${usd(message.costUsd)}` : ""}
              {message.costUsd !== undefined && message.durationMs !== undefined ? " · " : ""}
              {message.durationMs !== undefined ? duration(message.durationMs / 1000) : ""}
            </span>
          )}
          {provider === "claude-code" && nativeSessionId && (
            <Link
              to={`/sessions/${encodeURIComponent(nativeSessionId)}`}
              className="readout text-[10px] text-ink-faint transition-colors hover:text-clay"
            >
              open Claude Code telemetry →
            </Link>
          )}
        </footer>
      )}
    </article>
  );
}

function ConversationEmpty({
  project,
  disabled,
  onSelect,
}: {
  project?: string;
  disabled: boolean;
  onSelect: (message: string) => void;
}) {
  const starters = [
    "Summarize what I worked on today",
    "What's my most expensive project?",
    `Review the git diff in ${project || "the current project"}`,
    "Find the highest-impact task I should tackle next",
  ];
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-panel-2 text-clay">
        <MessagesSquare size={20} />
      </div>
      <h2 className="text-base font-medium text-ink">What should Odin take on?</h2>
      <p className="mt-1 max-w-md text-sm text-ink-dim">
        Ask for an answer, a plan, or hands-on work in the selected project.
      </p>
      <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onSelect(starter)}
            disabled={disabled}
            className="rounded-full border border-line bg-panel-2/60 px-3 py-2 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-3">
      <Skeleton className="h-12 w-2/3 self-end" />
      <Skeleton className="h-20 w-4/5" />
      <Skeleton className="h-10 w-3/5" />
    </div>
  );
}
