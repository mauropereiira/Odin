import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Plus, Radar, Send, Square, X } from "lucide-react";
import { api, qk } from "../lib/api";
import type { CreateAgentRequest } from "../lib/api";
import { modelLabel, usd } from "../lib/format";
import { useFleet } from "../lib/useFleet";
import type { FleetAgent, FleetMutation } from "../lib/useFleet";
import type { AgentInfo, ProjectCard, ProviderCapability, ProviderId } from "../lib/types";
import { Markdown } from "../components/Markdown";
import { ProviderBadge } from "../components/ProviderBadge";
import { Modal } from "../components/Modal";
import { ToolChip } from "../components/ToolChip";
import { useDemoMode } from "../lib/useDemoMode";
import { EmptyState, MicroLabel, Pill, Skeleton } from "../components/ui";

const controlClass =
  "h-9 w-full rounded-lg border border-line bg-panel-2 px-3 readout text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-clay/60 disabled:cursor-not-allowed disabled:opacity-50";

export function Fleet() {
  const readOnly = useDemoMode();
  const { data: projects = [] } = useQuery({ queryKey: qk.projects, queryFn: api.projects });
  const providersQuery = useQuery({ queryKey: qk.providers, queryFn: api.providers });
  const fleet = useFleet();
  const [dispatchOpen, setDispatchOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Fleet</h1>
          <p className="mt-0.5 text-sm text-ink-dim">Odin&apos;s agents, at work.</p>
        </div>
        <button
          type="button"
          onClick={() => setDispatchOpen(true)}
          disabled={readOnly}
          title={readOnly ? "Demo mode is read-only" : undefined}
          className="flex items-center gap-2 rounded-lg bg-clay px-3 py-2 readout text-xs text-void transition-colors hover:bg-clay-bright disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} /> Dispatch agent
        </button>
      </header>

      {fleet.error && (
        <div className="rise flex items-start gap-2 rounded-lg border border-amber/20 bg-amber/5 px-3 py-2 text-xs text-amber">
          <CircleAlert size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{fleet.error}</span>
          <button type="button" onClick={fleet.clearError} aria-label="Dismiss error">
            <X size={13} />
          </button>
        </div>
      )}

      {fleet.loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[310px] w-full" />
          ))}
        </div>
      ) : fleet.agents.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {fleet.agents.map((agent, index) => (
            <AgentTerminal
              key={agent.info.id}
              agent={agent}
              index={index}
              onPrompt={fleet.prompt}
              onStop={fleet.stop}
              onRemove={fleet.remove}
              pending={fleet.pending[agent.info.id]}
              readOnly={readOnly}
            />
          ))}
        </div>
      ) : (
        <section className="panel rise">
          <EmptyState
            icon={<Radar size={25} />}
            title="No agents dispatched. Put Odin's fleet to work."
            body="Assign a project and task to open the first live agent terminal."
          />
          <div className="-mt-10 flex justify-center pb-8">
            <button
              type="button"
              onClick={() => setDispatchOpen(true)}
              disabled={readOnly}
              className="flex items-center gap-2 rounded-lg border border-clay/30 bg-clay/10 px-3 py-2 readout text-xs text-clay transition-colors hover:bg-clay/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={13} /> Dispatch agent
            </button>
          </div>
        </section>
      )}

      {dispatchOpen && (
        <DispatchModal
          projects={projects}
          providers={providersQuery.data ?? []}
          providersLoading={providersQuery.isLoading}
          providersError={providersQuery.error instanceof Error ? providersQuery.error.message : null}
          requestError={fleet.error}
          onClose={() => setDispatchOpen(false)}
          onDispatch={fleet.dispatch}
        />
      )}
    </div>
  );
}

function AgentTerminal({
  agent,
  index,
  onPrompt,
  onStop,
  onRemove,
  pending,
  readOnly,
}: {
  agent: FleetAgent;
  index: number;
  onPrompt: (id: string, message: string) => Promise<boolean>;
  onStop: (id: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  pending?: FleetMutation;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);
  const working = agent.info.status === "working";
  const active = Boolean(agent.info.lastRunId);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.scrollTop = terminal.scrollHeight;
  }, [agent.activity, agent.info.status]);

  const submit = async () => {
    const message = draft.trim();
    if (readOnly || !message || active) return;
    setDraft("");
    const sent = await onPrompt(agent.info.id, message);
    if (!sent) setDraft(message);
  };

  return (
    <article
      className="panel rise overflow-hidden transition-colors hover:border-line-strong"
      style={{ animationDelay: `${Math.min(index * 40, 280)}ms` }}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-ink">{agent.info.title}</h2>
            <StatusPill status={agent.info.status} />
            <ProviderBadge provider={agent.info.provider} />
          </div>
          <p className="mt-1 truncate text-xs text-ink-dim" title={agent.info.cwd}>
            {agent.info.project}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone="iris">{agent.info.model ? modelLabel(agent.info.model) : "Default"}</Pill>
          {agent.info.permissionMode && <Pill>{agent.info.permissionMode}</Pill>}
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove ${agent.info.title} from Odin's fleet?`)) {
                void onRemove(agent.info.id);
              }
            }}
            disabled={readOnly || Boolean(pending) || active}
            title={active ? "Stop this agent before removing it" : "Remove agent"}
            aria-label={`Remove ${agent.info.title}`}
            className="rounded-md p-1 text-ink-faint transition-colors hover:bg-panel-2 hover:text-rose disabled:cursor-not-allowed disabled:opacity-30"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div
        ref={terminalRef}
        className="h-[180px] overflow-y-auto border-b border-line bg-panel-2/70 px-3 py-3"
      >
        {agent.activity.length ? (
          <div className="flex flex-col gap-2.5">
            {agent.activity.map((item, activityIndex) => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="flex justify-end">
                    <p className="max-w-[88%] rounded-lg border border-clay/20 bg-clay/10 px-2.5 py-1.5 text-xs leading-5 text-ink">
                      {item.text}
                    </p>
                  </div>
                );
              }
              if (item.kind === "text") {
                return <Markdown key={activityIndex} text={item.text} className="text-xs" />;
              }
              if (item.kind === "tool") {
                return (
                  <ToolChip
                    key={`${item.id}-${activityIndex}`}
                    name={item.name}
                    input={item.input}
                    done={item.done}
                    isError={item.isError}
                  />
                );
              }
              return (
                <p key={activityIndex} className="flex items-start gap-2 text-xs leading-5 text-rose">
                  <CircleAlert size={12} className="mt-1 shrink-0" /> {item.text}
                </p>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center">
            {working ? (
              <span className="flex items-center gap-2 readout text-[10px] text-ink-faint">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-clay" /> agent online · awaiting output
              </span>
            ) : (
              <p className="max-w-sm text-xs leading-5 text-ink-faint">
                {agent.info.lastSummary || "Idle. Prompt this agent to begin a run."}
              </p>
            )}
          </div>
        )}
        {active && agent.activity.length > 0 && (
          <div className="mt-3 flex items-center gap-2 readout text-[10px] text-ink-faint">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-clay" /> streaming
          </div>
        )}
      </div>

      <footer className="p-3">
        <div className="mb-2 flex min-h-5 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {agent.info.provider === "claude-code" && agent.info.sessionId && (
              <Link
                to={`/sessions/${encodeURIComponent(agent.info.sessionId)}`}
                className="readout text-[10px] text-ink-faint transition-colors hover:text-clay"
              >
                Claude Code telemetry →
              </Link>
            )}
            {agent.lastCostUsd !== undefined && (
              <span className="readout text-[10px] tabular-nums text-ink-faint">
                last turn {usd(agent.lastCostUsd)}
              </span>
            )}
          </div>
          <span className="readout max-w-[45%] truncate text-[9px] text-ink-faint" title={agent.info.cwd}>
            {agent.info.cwd}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit();
            }}
            disabled={readOnly || active || Boolean(pending)}
            placeholder={readOnly ? "Demo mode is read-only" : active ? "Agent is working…" : "Prompt this agent…"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {active ? (
            <button
              type="button"
              onClick={() => void onStop(agent.info.id)}
              disabled={readOnly || Boolean(pending)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-amber/30 px-3 readout text-[10px] text-amber transition-colors hover:bg-amber/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Square size={10} fill="currentColor" /> {pending === "stop" ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={readOnly || !draft.trim() || Boolean(pending)}
              aria-label="Prompt agent"
              className="flex h-9 items-center rounded-lg bg-clay px-3 text-void transition-colors hover:bg-clay-bright disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

function StatusPill({ status }: { status: AgentInfo["status"] }) {
  if (status === "working") {
    return <Pill tone="clay"><span className="live-dot h-1.5 w-1.5 rounded-full bg-clay" /> working</Pill>;
  }
  if (status === "error") return <Pill tone="rose">error</Pill>;
  return <Pill tone="teal"><span className="h-1.5 w-1.5 rounded-full bg-teal opacity-60" /> idle</Pill>;
}

function DispatchModal({
  projects,
  providers,
  providersLoading,
  providersError,
  requestError,
  onClose,
  onDispatch,
}: {
  projects: ProjectCard[];
  providers: ProviderCapability[];
  providersLoading: boolean;
  providersError: string | null;
  requestError: string | null;
  onClose: () => void;
  onDispatch: (request: CreateAgentRequest) => Promise<AgentInfo | null>;
}) {
  const preferred = useMemo(() => projects[0], [projects]);
  const [cwd, setCwd] = useState(preferred?.path ?? "");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState<ProviderId>(
    () => providers.find((item) => item.available && item.authenticated !== false)?.id
      ?? providers[0]?.id
      ?? "claude-code",
  );
  const [model, setModel] = useState<string | undefined>();
  const [permissionMode, setPermissionMode] = useState("");
  const [task, setTask] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const selectedProvider = providers.find((item) => item.id === provider);
  const selectedAccessMode = selectedProvider?.accessModes.find(
    (mode) => mode.id === permissionMode,
  );
  const providerReady = Boolean(
    selectedProvider?.available && selectedProvider.authenticated !== false,
  );

  useEffect(() => {
    if (!cwd && preferred) setCwd(preferred.path);
  }, [cwd, preferred]);

  useEffect(() => {
    if (!providers.length) return;
    const fallback = providers.find((item) => item.available && item.authenticated !== false)
      ?? providers.find((item) => item.available)
      ?? providers[0];
    const next = selectedProvider?.available && selectedProvider.authenticated !== false
      ? selectedProvider
      : fallback;
    if (!next) return;
    if (next.id !== provider) {
      setProvider(next.id);
      setModel(undefined);
      setPermissionMode(next.defaultAccessMode);
      return;
    }
    if (!next.accessModes.some((mode) => mode.id === permissionMode)) {
      setPermissionMode(next.defaultAccessMode);
    }
    if (model && !next.models.some((item) => item.id === model)) setModel(undefined);
  }, [model, permissionMode, provider, providers, selectedProvider]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => taskRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!cwd || !providerReady || submitting) return;
    const project = projects.find((item) => item.path === cwd);
    setSubmitting(true);
    const created = await onDispatch({
      provider,
      cwd,
      project: project?.label,
      title: title.trim() || undefined,
      model,
      permissionMode,
      message: task.trim() || undefined,
    });
    setSubmitting(false);
    if (created) onClose();
  };

  return (
    <Modal labelledBy="dispatch-title" onClose={onClose} closeDisabled={submitting}>
      <form
        onSubmit={(event) => void submit(event)}
        className="command-palette panel flex max-h-[calc(100vh-2rem)] w-full max-w-[560px] flex-col overflow-hidden shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 id="dispatch-title" className="text-base font-semibold text-ink">Dispatch agent</h2>
            <p className="mt-0.5 text-xs text-ink-dim">Assign an Odin agent to a project terminal.</p>
          </div>
            <button type="button" onClick={onClose} disabled={submitting} aria-label="Close dispatch dialog" className="rounded-md p-1 text-ink-faint hover:text-ink disabled:opacity-30">
            <X size={15} />
          </button>
        </header>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <Control label="Project / dir">
            <select value={cwd} onChange={(event) => setCwd(event.target.value)} className={controlClass}>
              {!projects.length && <option value="">No project available</option>}
              {projects.map((project) => (
                <option key={project.dir} value={project.path}>{project.label} — {project.path}</option>
              ))}
            </select>
          </Control>
          <Control label="Agent title · optional">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Diff reviewer"
              className={controlClass}
            />
          </Control>
          <Control label="Provider">
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value as ProviderId;
                const capability = providers.find((item) => item.id === next);
                setProvider(next);
                setModel(undefined);
                setPermissionMode(capability?.defaultAccessMode ?? "");
              }}
              disabled={providersLoading || submitting}
              className={controlClass}
            >
              {!providers.length && <option value={provider}>Loading providers...</option>}
              {providers.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.available}>
                  {item.label}
                  {!item.available ? " (unavailable)" : item.authenticated === false ? " (sign-in required)" : ""}
                </option>
              ))}
            </select>
          </Control>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Control label="Model">
              <select
                value={model ?? ""}
                onChange={(event) => setModel(event.target.value || undefined)}
                disabled={!providerReady || submitting}
                className={controlClass}
              >
                <option value="">Provider default</option>
                {selectedProvider?.models.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Control>
            <Control label="Permissions">
              <select
                value={permissionMode}
                onChange={(event) => setPermissionMode(event.target.value)}
                disabled={!providerReady || submitting}
                className={controlClass}
              >
                {selectedProvider?.accessModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>{mode.label}</option>
                ))}
              </select>
            </Control>
          </div>
          {selectedProvider && (
            <p className={`readout text-[10px] ${providerReady ? "text-ink-faint" : "text-amber"}`}>
              {selectedProvider.available
                ? selectedProvider.authenticated === false
                  ? `${selectedProvider.label} needs authentication.`
                  : `${selectedProvider.label} ready${selectedProvider.version ? ` · v${selectedProvider.version.replace(/^v/i, "")}` : ""}`
                : `${selectedProvider.label} is unavailable.`}
            </p>
          )}
          {selectedAccessMode?.description && (
            <p className={`text-xs leading-5 ${selectedAccessMode.dangerous ? "text-amber" : "text-ink-faint"}`}>
              {selectedAccessMode.dangerous && <CircleAlert size={12} className="mr-1 inline" />}
              {selectedAccessMode.description}
            </p>
          )}
          {(providersError || requestError) && (
            <p className="rounded-lg border border-amber/20 bg-amber/5 px-3 py-2 text-xs text-amber">
              {providersError ? `Unable to load providers: ${providersError}` : requestError}
            </p>
          )}
          <Control label="Task · optional">
            <textarea
              ref={taskRef}
              data-modal-focus
              value={task}
              onChange={(event) => setTask(event.target.value)}
              rows={4}
              placeholder="What should this agent work on?"
              className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm leading-5 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay/60"
            />
          </Control>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <span className="readout text-[10px] text-ink-faint">ESC to close</span>
          <button
            type="submit"
            disabled={!cwd || !providerReady || submitting}
            className="flex items-center gap-2 rounded-lg bg-clay px-4 py-2 readout text-xs text-void transition-colors hover:bg-clay-bright disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={13} /> {submitting ? "Dispatching…" : "Dispatch"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <MicroLabel className="mb-1 block">{label}</MicroLabel>
      {children}
    </label>
  );
}
