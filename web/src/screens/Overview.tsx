import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, Bot, Brain, CircleDot, MessagesSquare, NotebookPen, Sparkles } from "lucide-react";
import { api, qk } from "../lib/api";
import { Panel, Readout, MicroLabel, Pill, Skeleton } from "../components/ui";
import { compact, usd, commas, relativeTime, modelLabel, MODEL_COLORS } from "../lib/format";
import { dailyTokenSeries, modelMix, rollups, topProjects } from "../lib/analytics";
import type { SessionSummary } from "../lib/types";

export function Overview() {
  const { data: sessions, isLoading } = useQuery({ queryKey: qk.sessions, queryFn: api.sessions });
  const { data: overview } = useQuery({ queryKey: qk.overview, queryFn: api.overview });
  const { data: capabilities } = useQuery({ queryKey: qk.capabilities, queryFn: api.capabilities });

  const stats = useMemo(() => (sessions ? rollups(sessions) : null), [sessions]);
  const series = useMemo(() => (sessions ? dailyTokenSeries(sessions, 30) : []), [sessions]);
  const projects = useMemo(() => (sessions ? topProjects(sessions, 5) : []), [sessions]);
  const models = useMemo(() => (sessions ? modelMix(sessions) : []), [sessions]);
  const recent = useMemo(
    () => (sessions ? sessions.filter((s) => !s.isSidechain).slice(0, 6) : []),
    [sessions],
  );

  const thirtyDayTokens = series.reduce((a, d) => a + d.tokens, 0);
  const thirtyDayCost = series.reduce((a, d) => a + d.cost, 0);

  return (
    <div className="flex flex-col gap-6">
      <Greeting activeNow={stats?.activeNow ?? 0} />

      <Panel label="Odin access">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {!capabilities ? Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-[72px] w-full" />
          )) : <>
          {capabilities.providers.map((provider) => (
            <AccessCell
              key={provider.id}
              icon={<Bot size={16} />}
              label={provider.label}
              detail={!provider.available ? "Not installed" : provider.authenticated === false ? "Sign in required" : "Ready"}
              ready={provider.available && provider.authenticated !== false}
            />
          ))}
          <AccessCell
            icon={<Brain size={16} />}
            label="Brain"
            detail={capabilities?.brain.recall && capabilities.brain.remember ? "Recall + memory" : "Limited"}
            ready={Boolean(capabilities?.brain.recall && capabilities.brain.remember)}
          />
          <AccessCell
            icon={<NotebookPen size={16} />}
            label="Notes"
            detail={capabilities?.notes.available && capabilities.notes.enabled ? capabilities.notes.forge : "Unavailable"}
            ready={Boolean(capabilities?.notes.available && capabilities.notes.enabled)}
          />
          <AccessCell
            icon={<Sparkles size={16} />}
            label="Skills"
            detail={capabilities ? `${capabilities.skills.active} active` : "Checking"}
            ready={Boolean(capabilities?.skills.enabled)}
          />
          <AccessCell
            icon={<MessagesSquare size={16} />}
            label="Chats"
            detail="Persistent"
            ready={Boolean(capabilities?.conversations.persistent)}
          />
          <AccessCell
            icon={<Bot size={16} />}
            label="Fleet"
            detail="Persistent"
            ready={Boolean(capabilities?.fleet.persistent)}
          />
          </>}
        </div>
      </Panel>

      {/* HERO — token-flow telemetry */}
      <Panel flush className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-6 px-5 pt-5">
          <div>
            <MicroLabel>Claude Code token flow · last 30 days</MicroLabel>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="readout text-4xl font-medium text-ink">{compact(thirtyDayTokens)}</span>
              <span className="readout text-sm text-ink-faint">tokens</span>
            </div>
          </div>
          <div className="flex gap-8">
            <MiniStat label="Est. cost" value={usd(thirtyDayCost)} accent="var(--color-clay)" />
            <MiniStat
              label="Peak day"
              value={compact(Math.max(0, ...series.map((s) => s.tokens)))}
              accent="var(--color-teal)"
            />
          </div>
        </div>
        <div className="mt-3 h-[200px] w-full">
          {isLoading ? (
            <div className="px-5">
              <Skeleton className="h-[160px] w-full" />
            </div>
          ) : (
            <HeroWave data={series} />
          )}
        </div>
      </Panel>

      {/* Primary readouts */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard>
          <Readout
            size="lg"
            accent="ink"
            label="Claude sessions"
            value={stats ? commas(stats.sessions) : "—"}
            hint={overview ? `${overview.projects.total} projects` : undefined}
          />
        </StatCard>
        <StatCard>
          <Readout
            size="lg"
            accent="teal"
            label="Claude tokens all-time"
            value={stats ? compact(stats.tokens) : "—"}
          />
        </StatCard>
        <StatCard>
          <Readout
            size="lg"
            accent="clay"
            label="Est. cost all-time"
            value={stats ? usd(stats.cost) : "—"}
            hint="equivalent API price"
          />
        </StatCard>
        <StatCard>
          <Readout
            size="lg"
            accent={stats && stats.activeNow > 0 ? "clay" : "ink"}
            label="Active now"
            value={stats ? String(stats.activeNow) : "—"}
            hint={stats ? `${compact(stats.todayTokens)} tokens today` : undefined}
          />
        </StatCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Top projects */}
        <Panel label="Top projects" className="lg:col-span-1" action={<LinkTo to="/projects" />}>
          <div className="flex flex-col gap-3">
            {projects.map((p) => {
              const max = projects[0]?.tokens || 1;
              return (
                <div key={p.dir} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between">
                    <span className="truncate text-sm text-ink">{p.project}</span>
                    <span className="readout text-xs text-ink-dim">{compact(p.tokens)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(p.tokens / max) * 100}%`,
                        background: "linear-gradient(90deg, var(--color-clay), var(--color-clay-bright))",
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {!projects.length && <RowSkeletons n={5} />}
          </div>
        </Panel>

        {/* Recent sessions */}
        <Panel label="Recent Claude Code sessions" className="lg:col-span-2" action={<LinkTo to="/sessions" />}>
          <ul className="flex flex-col divide-y divide-line">
            {recent.map((s) => (
              <RecentRow key={s.id} s={s} />
            ))}
            {!recent.length && <RowSkeletons n={6} />}
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Model mix */}
        <Panel label="Claude Code model mix" className="lg:col-span-2">
          <ModelMix models={models} />
        </Panel>

        {/* MCP health */}
        <Panel label="MCP servers" action={<LinkTo to="/mcp" />}>
          <div className="flex items-center justify-between">
            <Readout
              size="lg"
              label="Configured"
              value={overview ? String(overview.mcp.total) : "—"}
            />
            <div className="text-right">
              {overview && overview.mcp.needsAuth > 0 ? (
                <Pill tone="amber">{overview.mcp.needsAuth} need auth</Pill>
              ) : (
                <Pill tone="teal">all connected</Pill>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Greeting({ activeNow }: { activeNow: number }) {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{part}</h1>
        <p className="mt-0.5 text-sm text-ink-dim">
          {activeNow > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-clay">
              <CircleDot size={13} /> {activeNow} Claude Code session{activeNow > 1 ? "s" : ""} running now
            </span>
          ) : (
            "Your Odin workspace at a glance"
          )}
        </p>
      </div>
      <span className="micro-label">{date}</span>
    </div>
  );
}

function HeroWave({ data }: { data: { date: string; tokens: number; cost: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 12, left: 12, bottom: 0 }}>
        <defs>
          <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-clay)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-clay)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis hide />
        <Tooltip
          cursor={{ stroke: "var(--color-line-strong)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { date: string; tokens: number; cost: number };
            return (
              <div className="panel px-3 py-2 text-xs">
                <div className="micro-label mb-1">{p.date}</div>
                <div className="readout text-ink">{commas(p.tokens)} tokens</div>
                <div className="readout text-clay">{usd(p.cost)}</div>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="tokens"
          stroke="var(--color-clay)"
          strokeWidth={2}
          fill="url(#heroFill)"
          dot={false}
          activeDot={{ r: 3, fill: "var(--color-clay-bright)" }}
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ModelMix({ models }: { models: { model: string; tokens: number; cost: number }[] }) {
  const total = models.reduce((a, m) => a + m.tokens, 0) || 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-panel-2">
        {models.map((m) => (
          <div
            key={m.model}
            style={{
              width: `${(m.tokens / total) * 100}%`,
              background: MODEL_COLORS[m.model] ?? "var(--color-ink-faint)",
            }}
            title={`${m.model}: ${compact(m.tokens)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {models.slice(0, 4).map((m) => (
          <div key={m.model} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: MODEL_COLORS[m.model] ?? "var(--color-ink-faint)" }}
            />
            <div className="flex flex-col">
              <span className="text-xs text-ink">{m.model}</span>
              <span className="readout text-[11px] text-ink-faint">
                {Math.round((m.tokens / total) * 100)}%
              </span>
            </div>
          </div>
        ))}
        {!models.length && <RowSkeletons n={4} />}
      </div>
    </div>
  );
}

function RecentRow({ s }: { s: SessionSummary }) {
  return (
    <li>
      <Link
        to={`/sessions/${encodeURIComponent(s.id)}`}
        className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-panel-2/40"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: MODEL_COLORS[modelLabel(s.model)] ?? "var(--color-ink-faint)" }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink">{s.title}</p>
          <p className="readout truncate text-[11px] text-ink-faint">
            {s.project} · {modelLabel(s.model)}
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="readout text-xs text-ink-dim">{compact(s.tokens.input + s.tokens.output + s.tokens.cacheCreate + s.tokens.cacheRead)}</p>
          <p className="readout text-[11px] text-ink-faint">{relativeTime(s.endedAt)}</p>
        </div>
        <ArrowUpRight size={14} className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    </li>
  );
}

function StatCard({ children }: { children: React.ReactNode }) {
  return <div className="panel p-4">{children}</div>;
}

function AccessCell({
  icon,
  label,
  detail,
  ready,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  ready: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/45 px-3 py-3">
      <div className="flex items-center justify-between text-ink-dim">
        {icon}
        <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-teal" : "bg-amber"}`} />
      </div>
      <p className="mt-2 text-sm font-medium text-ink">{label}</p>
      <p className="readout mt-0.5 truncate text-[10px] text-ink-faint" title={detail}>{detail}</p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex flex-col gap-1">
      <MicroLabel>{label}</MicroLabel>
      <span className="readout text-xl font-medium" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

function LinkTo({ to }: { to: string }) {
  return (
    <Link to={to} className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-clay">
      View <ArrowUpRight size={12} />
    </Link>
  );
}

function RowSkeletons({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="my-1.5 h-6 w-full" />
      ))}
    </>
  );
}
