import { useNavigate } from "react-router-dom";
import { relativeTime } from "../lib/format";
import type { LiveSession } from "../lib/types";

// The authentic macOS traffic-light colors — the signature that reads as a
// real Terminal window rather than a generic dark card.
const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];

/** An active session rendered as a little macOS Terminal window, updating live. */
export function LiveSessionCard({ session }: { session: LiveSession }) {
  const navigate = useNavigate();
  const activity = session.nowIsTool
    ? `${session.nowTool?.name ?? "tool"}${session.nowTool?.hint ? ` ${session.nowTool.hint}` : ""}`
    : (session.nowText ?? "");
  const title = `${session.project}${session.gitBranch ? ` — ${session.gitBranch}` : ""}`;

  return (
    <button
      onClick={() => navigate(`/sessions/${encodeURIComponent(session.id)}`)}
      className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-void text-left shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)] transition-transform hover:-translate-y-0.5"
    >
      {/* Title bar — traffic lights, centered window title, live time */}
      <div
        className="flex items-center gap-2 border-b border-line px-3 py-1.5"
        style={{
          background: "linear-gradient(var(--color-panel-2), var(--color-panel))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex shrink-0 items-center gap-[7px]">
          {LIGHTS.map((c) => (
            <span
              key={c}
              className="h-[11px] w-[11px] rounded-full"
              style={{ background: c, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }}
            />
          ))}
        </div>
        <span className="readout min-w-0 flex-1 truncate text-center text-[10px] text-ink-dim">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-clay" />
          <span className="readout text-[10px] text-ink-faint">
            {session.lastActivity ? relativeTime(session.lastActivity) : ""}
          </span>
        </span>
      </div>

      {/* The "screen" — monospace prompt + current activity + blinking cursor */}
      <div className="min-h-[4.5rem] px-3 py-2.5 font-mono text-xs leading-5">
        {session.userText && (
          <div className="truncate">
            <span className="text-teal">❯</span> <span className="text-ink">{session.userText}</span>
          </div>
        )}
        <div className="mt-1 flex items-center text-ink-dim">
          <span className="truncate">{activity}</span>
          <span className="agent-cursor shrink-0 text-teal">▋</span>
        </div>
      </div>
    </button>
  );
}
