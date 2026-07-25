import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  BrainCircuit,
  FolderGit2,
  Gauge,
  MessagesSquare,
  Radar,
  Search,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api, qk } from "../lib/api";
import { useLiveFeed } from "../lib/useLiveFeed";
import { resetCountdown, usd } from "../lib/format";
import { useReducedMotion } from "../lib/motion";
import { CommandPalette } from "./CommandPalette";
import { OdinMark } from "./OdinMark";
import type { RateLimitInfo } from "../lib/types";

let hasBooted = false;

const NAV = [
  { to: "/", label: "Overview", icon: Gauge, end: true },
  { to: "/converse", label: "Converse", icon: MessagesSquare, end: false },
  { to: "/fleet", label: "Fleet", icon: Radar, end: false },
  { to: "/brain", label: "Brain", icon: BrainCircuit, end: false },
  { to: "/skills", label: "Skills", icon: Sparkles, end: false },
  { to: "/usage", label: "Usage", icon: Activity, end: false },
  { to: "/sessions", label: "Sessions", icon: TerminalSquare, end: false },
  { to: "/mcp", label: "MCP", icon: Boxes, end: false },
  { to: "/projects", label: "Projects", icon: FolderGit2, end: false },
];

export function Shell() {
  const { status } = useLiveFeed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [firstMount] = useState(() => {
    const shouldBoot = !hasBooted;
    hasBooted = true;
    return shouldBoot;
  });
  const booting = firstMount && !reducedMotion;
  const { data: overview } = useQuery({
    queryKey: qk.overview,
    queryFn: api.overview,
    refetchInterval: 30_000,
  });

  return (
    <div className="flex h-full">
      <NavRail active={(overview?.sessions.activeNow ?? 0) > 0} booting={booting} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TelemetryBar
          status={status}
          activeNow={overview?.sessions.activeNow ?? 0}
          todayCost={overview?.usage.todayCost ?? 0}
          rateLimit={overview?.rateLimit ?? null}
          booting={booting}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main
          className={clsx(
            "min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-8 sm:py-7",
            booting && "rise",
          )}
          style={{ animationDelay: booting ? "140ms" : undefined }}
        >
          <div className="mx-auto max-w-[1240px]">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function NavRail({ active, booting }: { active: boolean; booting: boolean }) {
  return (
    <nav
      className={clsx(
        "flex w-[58px] flex-col items-center border-r border-line bg-void-2/60 py-3 sm:w-[76px] sm:py-5",
        booting && "rise",
      )}
      style={{ animationDelay: booting ? "0ms" : undefined }}
    >
      <div className="mb-4 sm:mb-8">
        <Wordmark active={active} />
      </div>
      <ul className="flex flex-1 flex-col items-center gap-1.5">
        {NAV.map((item) => (
          <li key={item.to} className="w-full px-2">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  "group relative flex flex-col items-center gap-1 rounded-xl py-2.5 transition-colors",
                  isActive ? "text-clay" : "text-ink-faint hover:text-ink-dim",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-2 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-clay" />
                  )}
                  <item.icon size={19} strokeWidth={1.75} />
                  <span className="text-[8px] font-medium uppercase tracking-wider sm:text-[9px]">
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The wordmark: the animated Eye of Odin + name. */
function Wordmark({ active }: { active: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <OdinMark size={44} active={active} />
      <span className="readout mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-ink">
        Odin
      </span>
    </div>
  );
}

function TelemetryBar({
  status,
  activeNow,
  todayCost,
  rateLimit,
  booting,
  onOpenPalette,
}: {
  status: "connecting" | "live" | "offline";
  activeNow: number;
  todayCost: number;
  rateLimit: RateLimitInfo | null;
  booting: boolean;
  onOpenPalette: () => void;
}) {
  const now = useClock();
  return (
    <header
      className={clsx(
        "flex h-14 shrink-0 items-center justify-between border-b border-line px-3 sm:px-8",
        booting && "rise",
      )}
      style={{ animationDelay: booting ? "70ms" : undefined }}
    >
      <div className="flex items-center gap-4 text-xs text-ink-dim">
        <span className="micro-label hidden sm:inline">Odin Agent Control Center</span>
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette"
          className="flex items-center gap-1.5 rounded-md border border-line bg-panel/50 px-2 py-1 text-ink-faint transition-colors hover:border-line-strong hover:text-ink-dim"
        >
          <Search size={12} />
          <span className="readout text-[10px]">⌘K</span>
        </button>
      </div>
      <div className="flex items-center gap-2 sm:gap-7">
        <BarStat label="Claude active" value={String(activeNow)} live={activeNow > 0} />
        <div className="hidden md:block"><BarStat label="Claude today" value={usd(todayCost)} /></div>
        {rateLimit && <div className="hidden lg:block"><QuotaStatus rateLimit={rateLimit} now={now} /></div>}
        <div className="hidden h-6 w-px bg-line sm:block" />
        <span className="hidden readout text-xs tabular-nums text-ink-dim sm:inline">
          {now.toLocaleTimeString("en-US", { hour12: false })}
        </span>
        <ConnDot status={status} />
      </div>
    </header>
  );
}

function QuotaStatus({ rateLimit, now }: { rateLimit: RateLimitInfo; now: Date }) {
  const label = rateLimit.rateLimitType === "five_hour"
    ? "CLAUDE CODE 5H"
    : `CLAUDE CODE ${rateLimit.rateLimitType.replaceAll("_", " ").toUpperCase()}`;
  const countdown = resetCountdown(rateLimit.resetsAt, now.getTime());
  const color = rateLimit.isUsingOverage
    ? "var(--color-rose)"
    : rateLimit.status === "allowed"
      ? "var(--color-teal)"
      : "var(--color-amber)";

  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="micro-label">{label}</span>
      <span className="readout text-[10px] tabular-nums text-ink-faint">{countdown}</span>
    </div>
  );
}

function BarStat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {live && <span className="live-dot h-1.5 w-1.5 rounded-full bg-clay" />}
      <span className="micro-label">{label}</span>
      <span className="readout text-sm text-ink">{value}</span>
    </div>
  );
}

function ConnDot({ status }: { status: "connecting" | "live" | "offline" }) {
  const map = {
    live: { c: "var(--color-teal)", t: "Live" },
    connecting: { c: "var(--color-amber)", t: "Sync" },
    offline: { c: "var(--color-ink-faint)", t: "Offline" },
  }[status];
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={clsx("h-1.5 w-1.5 rounded-full", status === "live" && "live-dot")}
        style={{ background: map.c }}
      />
      <span className="micro-label" style={{ color: map.c }}>
        {map.t}
      </span>
    </span>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
