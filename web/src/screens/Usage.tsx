import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import { api, qk } from "../lib/api";
import { CountUp } from "../lib/motion";
import { EmptyState, MicroLabel, Panel, Pill, Readout, Skeleton } from "../components/ui";
import {
  MODEL_COLORS,
  commas,
  compact,
  fullUsd,
  modelLabel,
  resetCountdown,
  shortDate,
  totalTokens,
  usd,
} from "../lib/format";
import type { DailyPoint, PlanInfo, RateLimitInfo, TokenTotals } from "../lib/types";

type Range = 7 | 30 | 45;

export function Usage() {
  const { data, isLoading } = useQuery({ queryKey: qk.usage, queryFn: api.usage });
  const { data: plan, isLoading: planLoading } = useQuery({
    queryKey: qk.plan,
    queryFn: api.plan,
    refetchInterval: 30_000,
  });
  const { data: overview } = useQuery({ queryKey: qk.overview, queryFn: api.overview });
  const [range, setRange] = useState<Range>(30);
  const limitClock = useLimitClock();
  const daily = useMemo(() => data?.daily.slice(-range) ?? [], [data, range]);
  const projects = useMemo(
    () => [...(data?.byProject ?? [])].sort((a, b) => b.costUsd - a.costUsd).slice(0, 8),
    [data],
  );
  const cacheEfficiency = data
    ? (data.totals.cacheRead / Math.max(1, data.totals.input + data.totals.cacheRead)) * 100
    : 0;
  const limitWindows = useMemo(() => {
    const merged = new Map<string, RateLimitInfo>();
    for (const limit of Object.values(plan?.rateLimits ?? {})) {
      merged.set(limit.rateLimitType, limit);
    }
    if (overview?.rateLimit) {
      merged.set(overview.rateLimit.rateLimitType, overview.rateLimit);
    }
    const priority = new Map([["five_hour", 0], ["weekly", 1]]);
    return [...merged.values()].sort((a, b) =>
      (priority.get(a.rateLimitType) ?? 10) - (priority.get(b.rateLimitType) ?? 10) ||
      a.rateLimitType.localeCompare(b.rateLimitType),
    );
  }, [overview?.rateLimit, plan?.rateLimits]);

  return (
    <div className="flex flex-col gap-6">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Claude Code Usage &amp; Plan</h1>
          <p className="mt-0.5 text-sm text-ink-dim">Provider telemetry, subscription limits, and equivalent API spend.</p>
        </div>
        <RangeToggle value={range} onChange={setRange} />
      </header>

      <section className="rise">
        <MicroLabel className="mb-2 block">Plan &amp; limits</MicroLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PlanPanel account={plan?.account} loading={planLoading} />
          <LimitsPanel windows={limitWindows} nowMs={limitClock} loading={planLoading} />
        </div>
      </section>

      <Panel flush className="rise overflow-hidden" >
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
          <div>
            <MicroLabel>Token composition · last {range} days</MicroLabel>
            <p className="mt-2 text-sm text-ink-dim">Daily token classes with estimated cost overlay</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Legend color="var(--color-teal)" label="Input" />
            <Legend color="var(--color-iris)" label="Output" />
            <Legend color="var(--color-clay)" label="Cache create" />
            <Legend color="var(--color-amber)" label="Cache read" />
            <Legend color="var(--color-clay-bright)" label="Cost line" />
          </div>
        </div>
        <div className="mt-3 h-[340px] w-full px-2 pb-3">
          {isLoading ? <Skeleton className="mx-3 h-[310px]" /> : <UsageChart data={daily} />}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard delay={40}>
          <Readout
            size="lg"
            accent="clay"
            label="Total est. cost"
            value={<CountUp value={data?.totals.costUsd ?? 0} format={usd} />}
            hint="equivalent API price"
          />
        </MetricCard>
        <MetricCard delay={80}>
          <Readout
            size="lg"
            accent="teal"
            label="Total tokens"
            value={<CountUp value={data ? totalTokens(data.totals) : 0} format={compact} />}
          />
        </MetricCard>
        <MetricCard delay={120}>
          <Readout
            size="lg"
            accent="iris"
            label="This month"
            value={<CountUp value={data?.month.costUsd ?? 0} format={usd} />}
          />
        </MetricCard>
        <MetricCard delay={160}>
          <Readout
            size="lg"
            label="Today"
            value={<CountUp value={data?.today.costUsd ?? 0} format={usd} />}
          />
        </MetricCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel label="By model" className="rise lg:col-span-3" >
          <ModelBreakdown models={data?.byModel ?? []} loading={isLoading} />
        </Panel>
        <Panel label="Cache efficiency" className="rise lg:col-span-2" >
          <CacheInstrument value={cacheEfficiency} cacheRead={data?.totals.cacheRead ?? 0} />
        </Panel>
      </div>

      <Panel label="Highest-cost projects" className="rise">
        {projects.length ? <ProjectBreakdown projects={projects} /> : !isLoading && (
          <EmptyState icon={<Activity size={22} />} title="No usage recorded" />
        )}
        {isLoading && <Skeleton className="h-48 w-full" />}
      </Panel>
    </div>
  );
}

function PlanPanel({ account, loading }: { account?: PlanInfo; loading: boolean }) {
  if (loading && !account) {
    return (
      <Panel label="Plan" className="min-h-[310px]">
        <Skeleton className="h-12 w-2/3" />
        <div className="mt-7 flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </Panel>
    );
  }

  const basePlan = account?.billingType === "stripe_subscription"
    ? "Claude subscription"
    : account?.billingType
      ? titleCase(account.billingType)
      : "—";
  const planLabel = account?.opusDefault ? `${basePlan} · Opus default` : basePlan;
  const extraUsage = account ? (account.hasExtraUsage ? "On" : "Off") : "—";

  return (
    <Panel
      label="Plan"
      className="transition-colors hover:border-line-strong"
      action={account?.organizationUuid ? <Pill tone="iris">Managed by organization</Pill> : undefined}
    >
      <Readout label="Current plan" value={planLabel} accent="clay" size="md" />
      <div className="mt-7 divide-y divide-line border-t border-line">
        <PlanRow label="Account" value={account?.email ?? "—"} />
        <PlanRow label="Member since" value={memberSince(account?.memberSince)} />
        <PlanRow
          label="Extra usage"
          value={extraUsage}
          hint={!account?.hasExtraUsage && account?.extraUsageDisabledReason
            ? disabledReason(account.extraUsageDisabledReason)
            : undefined}
          tone={account?.hasExtraUsage ? "text-teal" : undefined}
        />
        <PlanRow
          label="Guest passes"
          value={account?.guestPassesRemaining === null || account?.guestPassesRemaining === undefined
            ? "—"
            : commas(account.guestPassesRemaining)}
        />
      </div>
    </Panel>
  );
}

function PlanRow({
  label,
  value,
  hint,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-5 py-3 first:border-t-0">
      <MicroLabel className="mt-0.5 shrink-0">{label}</MicroLabel>
      <div className="min-w-0 text-right">
        <p className={`truncate readout text-xs ${tone}`} title={value}>{value}</p>
        {hint && <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>}
      </div>
    </div>
  );
}

function LimitsPanel({
  windows,
  nowMs,
  loading,
}: {
  windows: RateLimitInfo[];
  nowMs: number;
  loading: boolean;
}) {
  return (
    <Panel label="Session limits" className="transition-colors hover:border-line-strong">
      {windows.length ? (
        <div className="divide-y divide-line border-y border-line">
          {windows.map((limit) => (
            <div
              key={limit.rateLimitType}
              className="flex items-center justify-between gap-4 py-4 transition-colors hover:bg-panel-2/30"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{limitLabel(limit.rateLimitType)}</p>
                <p className="mt-1 readout text-[11px] tabular-nums text-ink-faint">
                  {resetCountdown(limit.resetsAt, nowMs)}
                </p>
              </div>
              <LimitStatus limit={limit} />
            </div>
          ))}
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3 py-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <div className="flex min-h-40 items-center justify-center px-5 text-center">
          <p className="max-w-sm text-xs leading-5 text-ink-faint">
            Live session limits appear here after Odin runs an agent.
          </p>
        </div>
      )}
      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-5 text-ink-faint">
        Limits reflect your Claude subscription&apos;s rolling usage windows.
      </p>
    </Panel>
  );
}

function LimitStatus({ limit }: { limit: RateLimitInfo }) {
  if (limit.isUsingOverage) {
    return <Pill tone="rose"><span className="h-1.5 w-1.5 rounded-full bg-rose" /> overage</Pill>;
  }
  if (limit.status === "allowed") {
    return <Pill tone="teal"><span className="h-1.5 w-1.5 rounded-full bg-teal" /> OK</Pill>;
  }
  return (
    <Pill tone="amber">
      <span className="h-1.5 w-1.5 rounded-full bg-amber" /> {humanize(limit.status)}
    </Pill>
  );
}

function memberSince(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function disabledReason(reason: string): string {
  if (reason === "org_level_disabled") return "disabled by organization";
  return humanize(reason);
}

function limitLabel(type: string): string {
  if (type === "five_hour") return "5-hour session";
  if (type === "weekly") return "Weekly";
  return titleCase(type);
}

function titleCase(value: string): string {
  return humanize(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function useLimitClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function UsageChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, left: 2, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-line)" />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickFormatter={(value: string) => shortDate(value)}
          minTickGap={28}
        />
        <YAxis
          yAxisId="tokens"
          axisLine={false}
          tickLine={false}
          width={48}
          tick={{ fill: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickFormatter={(value: number) => compact(value)}
        />
        <YAxis
          yAxisId="cost"
          orientation="right"
          axisLine={false}
          tickLine={false}
          width={46}
          tick={{ fill: "var(--color-ink-faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}
          tickFormatter={(value: number) => usd(value)}
        />
        <Tooltip cursor={{ fill: "rgba(148,163,184,0.04)" }} content={<UsageTooltip />} />
        <Bar
          yAxisId="tokens"
          dataKey="input"
          stackId="tokens"
          fill="var(--color-teal)"
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
        />
        <Bar
          yAxisId="tokens"
          dataKey="output"
          stackId="tokens"
          fill="var(--color-iris)"
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
        />
        <Bar
          yAxisId="tokens"
          dataKey="cacheCreate"
          stackId="tokens"
          fill="var(--color-clay)"
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
        />
        <Bar
          yAxisId="tokens"
          dataKey="cacheRead"
          stackId="tokens"
          fill="var(--color-amber)"
          radius={[3, 3, 0, 0]}
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
        />
        <Line
          yAxisId="cost"
          type="monotone"
          dataKey="costUsd"
          stroke="var(--color-clay-bright)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, fill: "var(--color-clay-bright)" }}
          isAnimationActive={true}
          animationDuration={700}
          animationEasing="ease-out"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function UsageTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload: DailyPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="panel min-w-44 px-3 py-2.5 text-xs shadow-2xl">
      <MicroLabel>{shortDate(point.date)}</MicroLabel>
      <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 readout text-ink-dim">
        <span>Input</span><span className="text-right text-teal">{compact(point.input)}</span>
        <span>Output</span><span className="text-right text-iris">{compact(point.output)}</span>
        <span>Cache create</span><span className="text-right text-clay">{compact(point.cacheCreate)}</span>
        <span>Cache read</span><span className="text-right text-amber">{compact(point.cacheRead)}</span>
      </div>
      <div className="mt-2 flex justify-between border-t border-line pt-2 readout text-ink">
        <span>Est. cost</span><span>{fullUsd(point.costUsd)}</span>
      </div>
    </div>
  );
}

function RangeToggle({ value, onChange }: { value: Range; onChange: (value: Range) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-panel p-1" aria-label="Usage time range">
      {([7, 30, 45] as const).map((days) => (
        <button
          key={days}
          type="button"
          onClick={() => onChange(days)}
          aria-pressed={value === days}
          className={`readout rounded-md px-3 py-1.5 text-xs transition-colors ${value === days ? "bg-panel-3 text-clay" : "text-ink-faint hover:text-ink"}`}
        >
          {days}d
        </button>
      ))}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="micro-label flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function MetricCard({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <div
      className="panel rise p-4 transition-colors hover:border-line-strong"
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function modelColor(model: string): string {
  const label = modelLabel(model);
  return MODEL_COLORS[label] ?? MODEL_COLORS[label.split(" ")[0]] ?? "var(--color-ink-faint)";
}

function ModelBreakdown({
  models,
  loading,
}: {
  models: { model: string; tokens: TokenTotals; costUsd: number; sessions: number }[];
  loading: boolean;
}) {
  const total = models.reduce((sum, model) => sum + totalTokens(model.tokens), 0) || 1;
  if (!models.length) {
    return loading ? (
      <Skeleton className="h-40 w-full" />
    ) : (
      <EmptyState title="No model usage recorded" />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {models.map((model, index) => {
        const tokens = totalTokens(model.tokens);
        const share = (tokens / total) * 100;
        return (
          <div key={model.model} className="rise" style={{ animationDelay: `${Math.min(index * 40, 280)}ms` }}>
            <div className="mb-1.5 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{modelLabel(model.model)}</p>
                <p className="readout text-[11px] text-ink-faint">{commas(model.sessions)} sessions · {compact(tokens)} tokens</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="readout text-sm text-ink">{usd(model.costUsd)}</p>
                <p className="readout text-[11px] text-ink-faint">{share.toFixed(1)}%</p>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${share}%`, background: modelColor(model.model) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CacheInstrument({ value, cacheRead }: { value: number; cacheRead: number }) {
  return (
    <div className="flex h-full flex-col justify-between gap-8">
      <Readout
        size="xl"
        accent="teal"
        label="Read reuse ratio"
        value={<CountUp value={value} format={(number) => `${number.toFixed(1)}%`} />}
        hint={`${compact(cacheRead)} cache-read tokens`}
      />
      <div>
        <div className="mb-2 flex justify-between">
          <MicroLabel>Cold input</MicroLabel>
          <MicroLabel>Cache read</MicroLabel>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-teal transition-[width] duration-700" style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      </div>
    </div>
  );
}

function ProjectBreakdown({
  projects,
}: {
  projects: { project: string; dir: string; costUsd: number; tokens: TokenTotals }[];
}) {
  const max = projects[0]?.costUsd || 1;
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
      {projects.map((project, index) => (
        <div key={project.dir} className="rise" style={{ animationDelay: `${Math.min(index * 40, 280)}ms` }}>
          <div className="mb-1.5 flex items-baseline justify-between gap-4">
            <span className="truncate text-sm text-ink">{project.project}</span>
            <span className="readout shrink-0 text-xs text-ink-dim">
              {usd(project.costUsd)} · {compact(totalTokens(project.tokens))}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full bg-clay"
              style={{ width: `${(project.costUsd / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
