import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Search, Trash2, Package, Power } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, qk } from "../lib/api";
import type { SkillInfo } from "../lib/types";
import { Markdown } from "../components/Markdown";
import { useDemoMode } from "../lib/useDemoMode";

export function Skills() {
  const readOnly = useDemoMode();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.skills });
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: qk.skills, queryFn: api.skills, refetchInterval: 30_000 });

  const q = query.trim().toLowerCase();
  const match = (s: SkillInfo) =>
    !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
  const forged = (data?.forged ?? []).filter(match);
  const skills = (data?.skills ?? []).filter(match);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Sparkles size={22} className="text-clay" />
          <div>
            <h1 className="text-lg font-semibold text-ink">Skills</h1>
            <p className="micro-label">Plugins & skills · Odin's craft</p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6">
          <Stat label="Plugins" value={data?.stats.plugins ?? 0} />
          <Stat label="Skills" value={data?.stats.skills ?? 0} />
          <Stat label="Forged" value={data?.stats.forged ?? 0} />
        </div>
      </header>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/50 px-3 py-2">
        <Search size={14} className="text-ink-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose/30 bg-rose/5 px-3 py-2 text-xs text-rose">
          {error}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="micro-label">Forged by Odin</h2>
        <p className="text-[11px] text-ink-faint">
          Newly-forged skills are <span className="text-amber">staged</span> — Odin can't use one
          until you activate it.
        </p>
        {forged.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Nothing forged yet — Odin writes skills as he learns reusable procedures.
          </p>
        ) : (
          forged.map((s) => (
            <div
              key={s.path}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                s.active ? "border-teal/40 bg-panel/40" : "border-amber/40 bg-panel/40"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{s.name}</span>
                  <span
                    className="micro-label"
                    style={{ color: s.active ? "var(--color-teal)" : "var(--color-amber)" }}
                  >
                    {s.active ? "active" : "staged"}
                  </span>
                </div>
                <div className="text-xs text-ink-dim">{s.description}</div>
                <div className="readout mt-1 text-[10px] text-ink-faint">
                  {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ""}
                  {s.project ? ` · ${s.project}` : ""}
                </div>
                <details className="mt-2 rounded-lg border border-line bg-panel-2/60 px-3 py-2">
                  <summary className="cursor-pointer readout text-[10px] text-ink-dim">Review instructions before activation</summary>
                  <Markdown text={s.content} className="mt-3 text-xs" />
                </details>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    setPending(s.path);
                    setError(null);
                    try {
                      if (s.active) {
                        const result = await api.deactivateForgedSkill(s.name);
                        if (!result.deactivated) throw new Error("Odin could not deactivate that skill.");
                      } else {
                        const result = await api.activateForgedSkill(s.name);
                        if (!result.activated) throw new Error("Odin could not activate that skill.");
                      }
                      await refresh();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Unable to change skill state.");
                    } finally {
                      setPending(null);
                    }
                  }}
                  disabled={readOnly || pending === s.path}
                  className={`flex items-center gap-1 text-xs ${
                    s.active ? "text-ink-faint hover:text-ink-dim" : "text-teal hover:text-teal/80"
                  }`}
                  title={readOnly ? "Demo mode is read-only" : s.active ? "Deactivate (unload)" : "Activate (let Odin use it)"}
                >
                  <Power size={13} />
                  {s.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete the forged skill “${s.name}”?`)) return;
                    setPending(s.path);
                    setError(null);
                    try {
                      const result = await api.deleteForgedSkill(s.name);
                      if (!result.removed) throw new Error("Odin could not delete that skill.");
                      await refresh();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Unable to delete skill.");
                    } finally {
                      setPending(null);
                    }
                  }}
                  disabled={readOnly || pending === s.path}
                  className="flex items-center gap-1 text-xs text-ink-faint hover:text-rose"
                  title={readOnly ? "Demo mode is read-only" : "Delete forged skill"}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="micro-label">Installed plugins ({data?.plugins.length ?? 0})</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(data?.plugins ?? []).map((p) => (
            <div
              key={p.key}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel/40 px-3 py-2"
            >
              <Package size={14} className="text-iris" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{p.name}</div>
                <div className="readout text-[10px] text-ink-faint">
                  {p.marketplace} · v{p.version}
                </div>
              </div>
              <span className="readout text-xs text-ink-dim">
                {p.skillCount} skill{p.skillCount === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="micro-label">All skills ({skills.length})</h2>
        <div className="space-y-1.5">
          {skills.map((s) => (
            <div key={s.path} className="rounded-lg border border-line bg-panel/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink">{s.name}</span>
                <span className="readout ml-auto text-[10px] text-ink-faint">{s.plugin}</span>
              </div>
              <div className="text-xs text-ink-dim">{s.description}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <div className="readout text-xl text-ink">{value}</div>
      <div className="micro-label">{label}</div>
    </div>
  );
}
