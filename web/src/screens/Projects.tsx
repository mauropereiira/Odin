import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FolderGit2, GitBranch } from "lucide-react";
import { api, qk } from "../lib/api";
import { CountUp } from "../lib/motion";
import { EmptyState, MicroLabel, Pill, Skeleton } from "../components/ui";
import { commas, compact, relativeTime, totalTokens, usd } from "../lib/format";
import type { ProjectCard } from "../lib/types";

type Sort = "active" | "cost" | "sessions";

export function Projects() {
  const { data, isLoading } = useQuery({ queryKey: qk.projects, queryFn: api.projects });
  const [sort, setSort] = useState<Sort>("active");
  const projects = useMemo(
    () => [...(data ?? [])].sort((a, b) => {
      if (sort === "cost") return b.costUsd - a.costUsd;
      if (sort === "sessions") return b.sessionCount - a.sessionCount;
      return (b.lastActive || "").localeCompare(a.lastActive || "");
    }),
    [data, sort],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Projects</h1>
          <p className="mt-0.5 text-sm text-ink-dim">Working directories as living activity instruments.</p>
        </div>
        <label>
          <span className="sr-only">Sort projects</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="h-9 rounded-lg border border-line bg-panel px-3 readout text-xs text-ink outline-none transition-colors hover:border-line-strong focus:border-clay/60"
          >
            <option value="active">Last active</option>
            <option value="cost">Highest cost</option>
            <option value="sessions">Most sessions</option>
          </select>
        </label>
      </header>

      {isLoading ? <ProjectSkeletons /> : projects.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, index) => (
            <Project key={project.dir} project={project} index={index} />
          ))}
        </div>
      ) : (
        <div className="panel rise">
          <EmptyState
            icon={<FolderGit2 size={24} />}
            title="No projects found"
            body="Project directories will appear here when Odin discovers Claude Code telemetry."
          />
        </div>
      )}
    </div>
  );
}

function Project({ project, index }: { project: ProjectCard; index: number }) {
  return (
    <Link
      to="/sessions"
      className="panel rise group flex min-h-56 flex-col p-4 transition-colors hover:border-line-strong hover:bg-panel/95"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">{project.label}</h2>
          <p className="mt-1 truncate readout text-[10px] text-ink-faint" title={project.path}>{project.path}</p>
        </div>
        <ArrowUpRight
          size={15}
          className="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
      <div className="mt-3 h-5">{project.isGitRepo && <Pill tone="teal"><GitBranch size={10} /> git</Pill>}</div>
      <div className="mt-auto grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-4">
        <MiniMetric label="Sessions"><CountUp value={project.sessionCount} format={commas} /></MiniMetric>
        <MiniMetric label="Tokens"><CountUp value={totalTokens(project.tokens)} format={compact} /></MiniMetric>
        <MiniMetric label="Est. cost" accent="text-clay"><CountUp value={project.costUsd} format={usd} /></MiniMetric>
        <MiniMetric label="Last active">{relativeTime(project.lastActive)}</MiniMetric>
      </div>
    </Link>
  );
}

function MiniMetric({
  label,
  children,
  accent = "text-ink",
}: {
  label: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="min-w-0">
      <MicroLabel>{label}</MicroLabel>
      <p className={`mt-1 truncate readout text-sm ${accent}`}>{children}</p>
    </div>
  );
}

function ProjectSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-56 w-full" />
      ))}
    </div>
  );
}
