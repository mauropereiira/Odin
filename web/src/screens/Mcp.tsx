import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Cable, LockKeyhole, Radio } from "lucide-react";
import { api, qk } from "../lib/api";
import { CountUp } from "../lib/motion";
import { EmptyState, MicroLabel, Pill, Readout, Skeleton } from "../components/ui";
import { commas } from "../lib/format";
import type { McpServer } from "../lib/types";

const SCOPES = ["global", "project", "plugin"] as const;

export function Mcp() {
  const { data, isLoading } = useQuery({ queryKey: qk.mcp, queryFn: api.mcp });
  const groups = useMemo(
    () => SCOPES.map((scope) => ({ scope, servers: (data ?? []).filter((server) => server.scope === scope) })),
    [data],
  );
  const needsAuth = data?.filter((server) => server.needsAuth).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="rise">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">MCP servers</h1>
        <p className="mt-0.5 text-sm text-ink-dim">Configured tools and transport health by scope.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="panel rise p-4 transition-colors hover:border-line-strong" style={{ animationDelay: "40ms" }}>
          <Readout
            size="lg"
            label="Total servers"
            accent="teal"
            value={<CountUp value={data?.length ?? 0} format={commas} />}
          />
        </div>
        <div className="panel rise p-4 transition-colors hover:border-line-strong" style={{ animationDelay: "80ms" }}>
          <Readout
            size="lg"
            label="Needs auth"
            accent={needsAuth > 0 ? "amber" : "ink"}
            value={<CountUp value={needsAuth} format={commas} />}
            hint={needsAuth > 0 ? "attention required" : "all configured servers clear"}
          />
        </div>
      </div>

      {isLoading ? <ServerSkeletons /> : data?.length ? (
        <div className="flex flex-col gap-7">
          {groups.filter((group) => group.servers.length > 0).map((group, groupIndex) => (
            <section key={group.scope} className="rise" style={{ animationDelay: `${120 + groupIndex * 40}ms` }}>
              <div className="mb-3 flex items-center gap-2">
                <ScopeIcon scope={group.scope} />
                <MicroLabel>{group.scope} scope</MicroLabel>
                <span className="readout text-[10px] text-ink-faint">
                  {commas(group.servers.length)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {group.servers.map((server, index) => (
                  <ServerCard
                    key={`${server.scope}-${server.name}-${server.projectDir ?? ""}`}
                    server={server}
                    index={index}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="panel rise">
          <EmptyState
            icon={<Boxes size={24} />}
            title="No MCP servers configured"
            body="Global, project, and installed-plugin servers will appear here."
          />
        </div>
      )}
    </div>
  );
}

function ScopeIcon({ scope }: { scope: McpServer["scope"] }) {
  const Icon = scope === "global" ? Radio : scope === "project" ? Cable : Boxes;
  return <Icon size={13} className="text-ink-faint" />;
}

function ServerCard({ server, index }: { server: McpServer; index: number }) {
  const endpoint = server.command || server.url || "No endpoint declared";
  const transportTone = server.transport === "stdio" ? "iris" : server.transport === "sse" ? "amber" : "neutral";
  const scopeTone = server.scope === "project" ? "iris" : server.scope === "plugin" ? "teal" : "neutral";
  return (
    <article
      className="panel rise p-4 transition-colors hover:border-line-strong hover:bg-panel/95"
      style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-ink">{server.name}</h2>
          {server.projectDir && <p className="mt-1 truncate text-xs text-ink-dim">{server.projectDir}</p>}
        </div>
        {server.needsAuth ? (
          <Pill tone="amber"><LockKeyhole size={10} /> needs auth</Pill>
        ) : (
          <Pill tone="teal">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" /> connected
          </Pill>
        )}
      </div>
      <p
        className="mt-4 truncate rounded-md border border-line bg-panel-2/70 px-2.5 py-2 readout text-[11px] text-ink-dim"
        title={endpoint}
      >
        {endpoint}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Pill tone={transportTone}>{server.transport}</Pill>
        <Pill tone={scopeTone}>{server.scope}</Pill>
      </div>
    </article>
  );
}

function ServerSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-36 w-full" />
      ))}
    </div>
  );
}
