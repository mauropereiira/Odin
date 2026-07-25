import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Search, Trash2, Pin, Plus, X, Maximize2 } from "lucide-react";
import { api, qk } from "../lib/api";
import { Markdown } from "../components/Markdown";
import { Modal } from "../components/Modal";
import { MemoryGraph } from "../components/MemoryGraph";
import type { Memory } from "../lib/types";

export function Brain() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const summary = useQuery({ queryKey: qk.brain, queryFn: api.brain, refetchInterval: 30_000 });
  const graph = useQuery({ queryKey: qk.brainGraph, queryFn: api.brainGraph });
  const memories = useQuery({ queryKey: qk.brainMemories, queryFn: api.brainMemories });

  const detail = useQuery({
    queryKey: ["brain", "memories", selected],
    queryFn: () => api.brainMemory(selected as string),
    enabled: !!selected,
  });

  const q = query.trim().toLowerCase();
  const filtered: Memory[] = (memories.data ?? []).filter(
    (m) => !q || m.title.toLowerCase().includes(q) || m.body.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrainCircuit size={22} className="text-clay" />
          <div>
            <h1 className="text-lg font-semibold text-ink">Brain</h1>
            <p className="micro-label">Odin's memory · Moldavite</p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6">
          <Stat label="Memories" value={summary.data?.total ?? 0} />
          <Stat label="New / 7d" value={summary.data?.stats.newThisWeek ?? 0} />
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setCaptureOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-clay px-3 py-2 readout text-xs text-void transition-colors hover:bg-clay-bright"
          >
            <Plus size={14} /> Capture
          </button>
        </div>
      </header>

      {actionError && (
        <div className="rounded-lg border border-rose/30 bg-rose/5 px-3 py-2 text-xs text-rose">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="panel relative flex min-h-[360px] items-center justify-center p-4">
          {graph.data && graph.data.nodes.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setGraphOpen(true)}
                aria-label="Expand memory graph"
                title="Expand memory graph"
                className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-line bg-panel-2/90 px-2.5 py-2 readout text-[10px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                <Maximize2 size={13} />
                <span className="hidden sm:inline">Expand</span>
              </button>
              <MemoryGraph graph={graph.data} onSelect={setSelected} />
            </>
          ) : (
            <p className="text-sm text-ink-faint">
              No memories yet — Odin will fill this in as you work.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel/50 px-3 py-2">
            <Search size={14} className="text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
            {filtered.map((m) => (
              <button
                key={m.slug}
                onClick={() => setSelected(m.slug)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected === m.slug
                    ? "border-clay bg-panel"
                    : "border-line bg-panel/40 hover:border-line-strong"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="micro-label">{m.type}</span>
                  {m.pinned && <Pin size={11} className="text-amber" />}
                  <span className="readout ml-auto text-[10px] text-ink-faint">{m.source ?? ""}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-ink">{m.title}</div>
                <div className="truncate text-xs text-ink-dim">{m.excerpt}</div>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-sm text-ink-faint">No matches.</p>}
          </div>
        </section>
      </div>

      {selected && detail.data && (
        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">{detail.data.title}</h2>
            <button
              onClick={async () => {
                if (!window.confirm(`Forget “${detail.data.title}”? The note will be moved to Odin's trash.`)) return;
                try {
                  const result = await api.brainDelete(selected);
                  if (!result.removed) throw new Error("Odin could not remove this memory.");
                  setSelected(null);
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: qk.brain }),
                    queryClient.invalidateQueries({ queryKey: qk.brainMemories }),
                    queryClient.invalidateQueries({ queryKey: qk.brainGraph }),
                  ]);
                } catch (cause) {
                  setActionError(cause instanceof Error ? cause.message : "Unable to forget memory.");
                }
              }}
              className="flex items-center gap-1 text-xs text-ink-faint hover:text-rose"
            >
              <Trash2 size={13} /> Forget
            </button>
          </div>
          <Markdown text={detail.data.body} />
          {detail.data.links.length > 0 && (
            <p className="micro-label">Links: {detail.data.links.join(" · ")}</p>
          )}
        </section>
      )}

      {graphOpen && graph.data && graph.data.nodes.length > 0 && (
        <Modal labelledBy="expanded-memory-graph-title" onClose={() => setGraphOpen(false)}>
          <section className="panel flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden shadow-2xl">
            <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h2 id="expanded-memory-graph-title" className="text-base font-semibold text-ink">
                  Memory constellation
                </h2>
                <p className="mt-0.5 text-xs text-ink-dim">
                  Select a node to open its memory.
                </p>
              </div>
              <button
                type="button"
                data-modal-focus
                onClick={() => setGraphOpen(false)}
                aria-label="Close expanded memory graph"
                className="rounded-lg border border-line p-2 text-ink-faint transition-colors hover:border-line-strong hover:text-ink"
              >
                <X size={16} />
              </button>
            </header>
            <div className="min-h-0 flex-1 p-3 sm:p-6">
              <MemoryGraph
                graph={graph.data}
                expanded
                onSelect={(slug) => {
                  setSelected(slug);
                  setGraphOpen(false);
                }}
              />
            </div>
          </section>
        </Modal>
      )}

      {captureOpen && (
        <CaptureMemory
          onClose={() => setCaptureOpen(false)}
          onCreated={async (memory) => {
            setCaptureOpen(false);
            setSelected(memory.slug);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: qk.brain }),
              queryClient.invalidateQueries({ queryKey: qk.brainMemories }),
              queryClient.invalidateQueries({ queryKey: qk.brainGraph }),
            ]);
          }}
          onError={setActionError}
        />
      )}
    </div>
  );
}

function CaptureMemory({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (memory: Memory) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("fact");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (!saving) onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const memory = await api.brainAdd({
        title: title.trim(),
        body: body.trim(),
        type,
        pinned,
        tags: ["captured"],
      });
      await onCreated(memory);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to capture memory.");
      setSaving(false);
    }
  };

  return (
    <Modal labelledBy="capture-memory-title" onClose={close} closeDisabled={saving}>
      <form
        onSubmit={(event) => void submit(event)}
        className="command-palette panel max-h-[90vh] w-full max-w-xl overflow-y-auto shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 id="capture-memory-title" className="text-base font-semibold text-ink">Capture to Odin's Brain</h2>
            <p className="mt-1 text-xs text-ink-dim">Save an idea, decision, preference, or durable fact directly.</p>
          </div>
          <button type="button" onClick={close} disabled={saving} aria-label="Close" className="text-ink-faint hover:text-ink disabled:opacity-40">
            <X size={16} />
          </button>
        </header>
        <div className="grid gap-4 p-5">
          <label>
            <span className="micro-label mb-1 block">Title</span>
            <input
              autoFocus
              data-modal-focus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="A short, memorable name"
              className="h-10 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm text-ink outline-none focus:border-clay/60"
            />
          </label>
          <label>
            <span className="micro-label mb-1 block">Details</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="What should Odin remember?"
              className="w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-clay/60"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="micro-label mb-1 block">Kind</span>
              <select value={type} onChange={(event) => setType(event.target.value)} className="h-10 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm text-ink outline-none">
                {['fact', 'idea', 'decision', 'project', 'preference', 'person', 'reference'].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 rounded-lg border border-line bg-panel-2 px-3 pb-2.5 text-xs text-ink-dim">
              <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
              Pin as core memory
            </label>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <button type="button" onClick={close} disabled={saving} className="rounded-lg border border-line px-3 py-2 readout text-xs text-ink-dim disabled:opacity-40">Cancel</button>
          <button type="submit" disabled={!title.trim() || saving} className="rounded-lg bg-clay px-4 py-2 readout text-xs text-void disabled:opacity-40">
            {saving ? "Capturing..." : "Remember this"}
          </button>
        </footer>
      </form>
    </Modal>
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
