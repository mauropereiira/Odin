import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { api, qk } from "../lib/api";
import { CountUp } from "../lib/motion";
import { EmptyState, MicroLabel, Panel, Pill, Readout, Skeleton } from "../components/ui";
import { commas, compact, duration, fullUsd, modelLabel, shortDate, totalTokens } from "../lib/format";
import type { TranscriptTurn } from "../lib/types";

export function SessionDetail() {
  const { id = "" } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.session(id),
    queryFn: () => api.session(id),
    enabled: Boolean(id),
    retry: false,
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !data) {
    return (
      <Panel className="rise">
        <EmptyState
          icon={<FileQuestion size={24} />}
          title="Session not found"
          body="The transcript may have moved or been removed."
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="rise">
        <MicroLabel className="mb-2 block">Claude Code telemetry</MicroLabel>
        <Link
          to="/sessions"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-faint transition-colors hover:text-clay"
        >
          <ArrowLeft size={14} /> Back to sessions
        </Link>
        <h1 className="max-w-4xl text-2xl font-semibold tracking-tight text-ink">{data.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone="neutral">{data.project}</Pill>
          <Pill tone="iris">{modelLabel(data.model)}</Pill>
          <span className="readout text-xs text-ink-faint">{data.startedAt ? shortDate(data.startedAt) : "—"}</span>
          {data.gitBranch && <span className="readout text-xs text-ink-faint">branch/{data.gitBranch}</span>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Metric label="Tokens" value={totalTokens(data.tokens)} format={compact} accent="teal" delay={40} />
        <Metric
          label="Est. cost"
          value={data.costUsd}
          format={fullUsd}
          accent="clay"
          delay={80}
        />
        <Metric label="Duration" value={data.durationSec} format={duration} delay={120} />
        <Metric label="Messages" value={data.messageCount} format={commas} delay={160} />
        <Metric
          label="Tool calls"
          value={data.toolCallCount}
          format={commas}
          accent="iris"
          delay={200}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <MicroLabel>Transcript</MicroLabel>
          <span className="readout text-[11px] text-ink-faint">
            {commas(data.turns.length)} turns
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {data.turns.map((turn, index) => <Turn key={turn.uuid || index} turn={turn} index={index} />)}
          {!data.turns.length && <Panel><EmptyState title="No transcript turns" /></Panel>}
        </div>
      </section>
    </div>
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
  accent?: "ink" | "clay" | "teal" | "iris";
  delay: number;
}) {
  return (
    <div className="panel rise p-4" style={{ animationDelay: `${delay}ms` }}>
      <Readout
        size="md"
        label={label}
        accent={accent}
        value={<CountUp value={value} format={format} />}
      />
    </div>
  );
}

function Turn({ turn, index }: { turn: TranscriptTurn; index: number }) {
  const user = turn.role === "user";
  return (
    <article
      className={`panel rise overflow-hidden transition-colors hover:border-line-strong ${user ? "border-l-2 border-l-clay bg-panel-2/45" : ""}`}
      style={{ animationDelay: `${Math.min(index * 35, 350)}ms` }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <MicroLabel className={user ? "text-clay" : "text-iris"}>
            {user ? "User" : "Assistant"}
          </MicroLabel>
          {turn.model && !user && (
            <span className="readout text-[10px] text-ink-faint">
              {modelLabel(turn.model)}
            </span>
          )}
        </div>
        {turn.tokens && !user && (
          <span className="readout text-[10px] text-ink-faint">
            {compact(totalTokens(turn.tokens))} tok · {fullUsd(turn.costUsd)}
          </span>
        )}
      </header>
      <div className="px-4 py-4">
        {turn.text ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink-dim">
            {turn.text}
          </p>
        ) : (
          <p className="text-sm italic text-ink-faint">No text content</p>
        )}
        {!!turn.toolCalls.length && (
          <div className="mt-4 flex flex-wrap gap-2">
            {turn.toolCalls.map((tool, toolIndex) => (
              <span
                key={`${tool.name}-${toolIndex}`}
                className="readout inline-flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-[10px] text-teal"
              >
                ⚙ {tool.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-36 w-full" />
      ))}
    </div>
  );
}
