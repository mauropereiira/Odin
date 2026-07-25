import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
import type { LucideIcon } from "lucide-react";
import { api, qk } from "../lib/api";
import { MODEL_COLORS, modelLabel } from "../lib/format";
import { MicroLabel, Pill } from "./ui";
import { Modal } from "./Modal";

const NAVIGATE = [
  { label: "Overview", to: "/", icon: Gauge },
  { label: "Converse", to: "/converse", icon: MessagesSquare },
  { label: "Fleet", to: "/fleet", icon: Radar },
  { label: "Brain", to: "/brain", icon: BrainCircuit },
  { label: "Skills", to: "/skills", icon: Sparkles },
  { label: "Usage", to: "/usage", icon: Activity },
  { label: "Sessions", to: "/sessions", icon: TerminalSquare },
  { label: "MCP", to: "/mcp", icon: Boxes },
  { label: "Projects", to: "/projects", icon: FolderGit2 },
];

interface PaletteResult {
  id: string;
  label: string;
  meta?: string;
  to: string;
  icon?: LucideIcon;
  color?: string;
}

interface ResultGroup {
  label: string;
  results: PaletteResult[];
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { data: sessions = [] } = useQuery({ queryKey: qk.sessions, queryFn: api.sessions });
  const { data: projects = [] } = useQuery({ queryKey: qk.projects, queryFn: api.projects });
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<number, HTMLButtonElement>());

  const groups = useMemo<ResultGroup[]>(() => {
    const needle = query.trim().toLowerCase();
    const navigateResults = NAVIGATE.map((item, index) => ({
      ...item,
      id: `navigate-${item.to}`,
      rank: relevance(needle, [item.label]),
      order: index,
    }))
      .filter((item) => item.rank < Infinity)
      .sort(compareRank)
      .map(({ rank: _rank, order: _order, ...item }) => item);

    const sessionResults = sessions
      .map((session, index) => ({
        id: `session-${session.id}`,
        label: session.title,
        meta: `${session.project} · ${modelLabel(session.model)}`,
        to: `/sessions/${encodeURIComponent(session.id)}`,
        color: modelColor(session.model),
        rank: relevance(needle, [session.title, session.project, session.model ?? ""]),
        order: index,
      }))
      .filter((item) => item.rank < Infinity)
      .sort(compareRank)
      .slice(0, 6)
      .map(({ rank: _rank, order: _order, ...item }) => item);

    const projectResults = projects
      .map((project, index) => ({
        id: `project-${project.dir}`,
        label: project.label,
        meta: project.path,
        to: "/projects",
        icon: FolderGit2,
        rank: relevance(needle, [project.label, project.path]),
        order: index,
      }))
      .filter((item) => item.rank < Infinity)
      .sort(compareRank)
      .slice(0, 5)
      .map(({ rank: _rank, order: _order, ...item }) => item);

    return [
      { label: "Navigate", results: navigateResults },
      { label: "Sessions", results: sessionResults },
      { label: "Projects", results: projectResults },
    ].filter((group) => group.results.length > 0);
  }, [projects, query, sessions]);

  const flatResults = useMemo(() => groups.flatMap((group) => group.results), [groups]);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const activate = useCallback(
    (result: PaletteResult) => {
      navigate(result.to);
      close();
    },
    [close, navigate],
  );

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setQuery("");
    setHighlighted(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    setHighlighted(flatResults.length ? 0 : -1);
  }, [flatResults.length, query]);

  useEffect(() => {
    if (!open || highlighted < 0) return;
    resultRefs.current.get(highlighted)?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
        return;
      }
      if (event.key === "/" && !open && !isTypingTarget(document.activeElement)) {
        event.preventDefault();
        onOpenChange(true);
        return;
      }
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown" && flatResults.length) {
        event.preventDefault();
        setHighlighted((index) => index < 0 ? 0 : (index + 1) % flatResults.length);
      } else if (event.key === "ArrowUp" && flatResults.length) {
        event.preventDefault();
        setHighlighted((index) => index <= 0 ? flatResults.length - 1 : index - 1);
      } else if (event.key === "Enter" && highlighted >= 0) {
        event.preventDefault();
        const result = flatResults[highlighted];
        if (result) activate(result);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activate, close, flatResults, highlighted, onOpenChange, open]);

  if (!open) return null;

  let flatIndex = -1;
  return (
    <Modal labelledBy="command-palette-title" onClose={close}>
      <section
        className="command-palette panel flex max-h-[min(70vh,620px)] w-full max-w-[560px] flex-col overflow-hidden shadow-2xl"
      >
        <h2 id="command-palette-title" className="sr-only">Command palette</h2>
        <div className="relative shrink-0 border-b border-line px-4 py-3">
          <Search
            size={16}
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            ref={inputRef}
            autoFocus
            data-modal-focus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands, sessions, projects…"
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant={highlighted >= 0 ? `command-result-${highlighted}` : undefined}
            autoComplete="off"
            className="h-9 w-full bg-transparent pl-8 pr-14 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            <Pill>esc</Pill>
          </span>
        </div>

        <div id="command-results" role="listbox" className="min-h-0 overflow-y-auto p-2">
          {groups.map((group) => (
            <div key={group.label} className="py-1.5" role="group" aria-label={group.label}>
              <MicroLabel className="mb-1 block px-3">{group.label}</MicroLabel>
              {group.results.map((result) => {
                flatIndex += 1;
                const index = flatIndex;
                const active = index === highlighted;
                const Icon = result.icon;
                return (
                  <button
                    key={result.id}
                    id={`command-result-${index}`}
                    ref={(node) => {
                      if (node) resultRefs.current.set(index, node);
                      else resultRefs.current.delete(index);
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(result)}
                    className="relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-colors"
                    style={{ background: active ? "rgba(217,119,87,0.1)" : undefined }}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-clay" />}
                    {result.color ? (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: result.color }} />
                    ) : Icon ? (
                      <Icon size={15} className={active ? "shrink-0 text-clay" : "shrink-0 text-ink-faint"} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{result.label}</span>
                      {result.meta && (
                        <span className="readout mt-0.5 block truncate text-[10px] text-ink-faint">
                          {result.meta}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {!flatResults.length && (
            <p className="px-3 py-8 text-center text-sm text-ink-faint">No matches</p>
          )}
        </div>
      </section>
    </Modal>
  );
}

function relevance(query: string, values: string[]): number {
  if (!query) return 0;
  const normalized = values.map((value) => value.toLowerCase());
  if (normalized.some((value) => value === query)) return 0;
  if (normalized.some((value) => value.startsWith(query))) return 1;
  if (normalized.some((value) => value.includes(query))) return 2;
  return Infinity;
}

function compareRank(a: { rank: number; order: number }, b: { rank: number; order: number }) {
  return a.rank - b.rank || a.order - b.order;
}

function modelColor(model: string | null): string {
  const label = modelLabel(model);
  return MODEL_COLORS[label] ?? MODEL_COLORS[label.split(" ")[0]] ?? "var(--color-ink-faint)";
}

function isTypingTarget(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}
