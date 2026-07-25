import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Search, TerminalSquare } from "lucide-react";
import { api, qk } from "../lib/api";
import { CountUp } from "../lib/motion";
import { EmptyState, MicroLabel, Pill, Readout, Skeleton } from "../components/ui";
import { LiveSessionCard } from "../components/LiveSessionCard";
import { MODEL_COLORS, commas, compact, duration, modelLabel, relativeTime, totalTokens, usd } from "../lib/format";
import type { SessionSummary } from "../lib/types";

type Sort = "recent" | "cost" | "tokens" | "duration";
const PAGE_SIZE = 60;
const controlClass =
  "h-9 rounded-lg border border-line bg-panel px-3 readout text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-clay/60";

export function Sessions() {
  const { data, isLoading } = useQuery({ queryKey: qk.sessions, queryFn: api.sessions });
  const { data: live } = useQuery({
    queryKey: qk.sessionsLive,
    queryFn: api.sessionsLive,
    refetchInterval: 15_000,
  });
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const [model, setModel] = useState("all");
  const [hideSubagents, setHideSubagents] = useState(true);
  const [sort, setSort] = useState<Sort>("recent");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const projects = useMemo(
    () => [...new Set((data ?? []).map((session) => session.project))].sort(),
    [data],
  );
  const models = useMemo(
    () => [...new Set((data ?? []).map((session) => session.model ?? ""))].sort(),
    [data],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = (data ?? []).filter((session) => {
      if (hideSubagents && session.isSidechain) return false;
      if (project !== "all" && session.project !== project) return false;
      if (model !== "all" && (session.model ?? "") !== model) return false;
      if (!query) return true;
      return [session.title, session.project, session.model ?? ""]
        .some((value) => value.toLowerCase().includes(query));
    });
    return rows.sort((a, b) => {
      if (sort === "cost") return b.costUsd - a.costUsd;
      if (sort === "tokens") return totalTokens(b.tokens) - totalTokens(a.tokens);
      if (sort === "duration") return b.durationSec - a.durationSec;
      return (b.endedAt || "").localeCompare(a.endedAt || "");
    });
  }, [data, hideSubagents, model, project, search, sort]);
  const shown = filtered.slice(0, visible);
  const totals = useMemo(
    () => filtered.reduce(
      (result, session) => ({
        tokens: result.tokens + totalTokens(session.tokens),
        cost: result.cost + session.costUsd,
      }),
      { tokens: 0, cost: 0 },
    ),
    [filtered],
  );

  useEffect(() => setVisible(PAGE_SIZE), [hideSubagents, model, project, search, sort]);

  return (
    <div className="flex flex-col gap-6">
      <header className="rise">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Claude Code Sessions</h1>
        <p className="mt-0.5 text-sm text-ink-dim">Provider-specific local telemetry, searchable and measured.</p>
      </header>

      {live && live.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="micro-label">Live now</span>
            <span className="readout text-[10px] text-ink-faint">{live.length} running</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {live.map((session) => (
              <LiveSessionCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric
          label="Matching sessions"
          value={filtered.length}
          format={commas}
          delay={40}
        />
        <Metric label="Est. cost" value={totals.cost} format={usd} accent="clay" delay={80} />
        <Metric label="Tokens" value={totals.tokens} format={compact} accent="teal" delay={120} />
      </div>

      <div className="panel rise p-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_170px_auto_150px]">
          <label className="relative">
            <span className="sr-only">Search sessions</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, project, model…"
              className={`${controlClass} w-full pl-9`}
            />
          </label>
          <Select label="Project" value={project} onChange={setProject}>
            <option value="all">All projects</option>
            {projects.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
          <Select label="Model" value={model} onChange={setModel}>
            <option value="all">All models</option>
            {models.map((name) => <option key={name || "none"} value={name}>{modelLabel(name || null)}</option>)}
          </Select>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel px-3 transition-colors hover:border-line-strong">
            <input
              type="checkbox"
              checked={hideSubagents}
              onChange={(event) => setHideSubagents(event.target.checked)}
              className="accent-clay"
            />
            <span className="micro-label whitespace-nowrap">Hide subagents</span>
          </label>
          <Select label="Sort" value={sort} onChange={(value) => setSort(value as Sort)}>
            <option value="recent">Most recent</option>
            <option value="cost">Highest cost</option>
            <option value="tokens">Most tokens</option>
            <option value="duration">Longest</option>
          </Select>
        </div>
      </div>

      <section className="panel rise overflow-hidden">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <MicroLabel>Session index</MicroLabel>
          <span className="readout text-[11px] text-ink-faint">
            Showing {commas(shown.length)} of {commas(filtered.length)}
          </span>
        </header>
        {isLoading ? <SessionSkeletons /> : shown.length ? (
          <ul className="divide-y divide-line">
            {shown.map((session, index) => (
              <SessionRow key={session.id} session={session} index={index} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<TerminalSquare size={22} />}
            title="No sessions match"
            body="Try widening the filters or including subagents."
          />
        )}
        {shown.length < filtered.length && (
          <div className="border-t border-line p-4 text-center">
            <button
              type="button"
              onClick={() => setVisible((count) => count + PAGE_SIZE)}
              className="rounded-lg border border-line px-4 py-2 readout text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
            >
              Load {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${controlClass} w-full`}>
        {children}
      </select>
    </label>
  );
}

function Metric({
  label,
  value,
  format,
  accent = "ink",
  delay,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  accent?: "ink" | "clay" | "teal";
  delay: number;
}) {
  return (
    <div className="panel rise p-4 transition-colors hover:border-line-strong" style={{ animationDelay: `${delay}ms` }}>
      <Readout size="lg" label={label} accent={accent} value={<CountUp value={value} format={format} />} />
    </div>
  );
}

function colorFor(model: string | null): string {
  const label = modelLabel(model);
  return MODEL_COLORS[label] ?? MODEL_COLORS[label.split(" ")[0]] ?? "var(--color-ink-faint)";
}

function SessionRow({ session, index }: { session: SessionSummary; index: number }) {
  return (
    <li className="rise" style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}>
      <Link
        to={`/sessions/${encodeURIComponent(session.id)}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-panel-2/55 lg:grid-cols-[minmax(260px,1fr)_110px_90px_90px_100px_auto]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(session.model) }} />
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{session.title}</p>
            <p className="readout truncate text-[11px] text-ink-faint">
              {session.project} · {modelLabel(session.model)}
              {session.gitBranch ? ` · ${session.gitBranch}` : ""}
            </p>
          </div>
        </div>
        <RowMetric label="Tokens" value={compact(totalTokens(session.tokens))} />
        <RowMetric label="Cost" value={usd(session.costUsd)} />
        <RowMetric label="Duration" value={duration(session.durationSec)} />
        <RowMetric label="Ended" value={relativeTime(session.endedAt)} />
        <div className="flex items-center justify-end gap-2">
          <Pill>{commas(session.toolCallCount)} tools</Pill>
          <ArrowUpRight size={14} className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </Link>
    </li>
  );
}

function RowMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden text-right lg:block">
      <MicroLabel>{label}</MicroLabel>
      <p className="readout text-xs text-ink-dim">{value}</p>
    </div>
  );
}

function SessionSkeletons() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}
