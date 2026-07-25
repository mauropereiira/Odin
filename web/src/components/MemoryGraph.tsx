import { useMemo, useState } from "react";
import type { MemoryGraph as MemoryGraphData } from "../lib/types";

const TYPE_COLOR: Record<string, string> = {
  person: "var(--color-clay)",
  preference: "var(--color-teal)",
  project: "var(--color-iris)",
  decision: "var(--color-amber)",
  fact: "var(--color-ink-dim)",
  reference: "var(--color-rose)",
};

interface Placed {
  slug: string;
  title: string;
  type: string;
  x: number;
  y: number;
}

/** Dependency-free constellation: nodes ringed by type, edges as faint lines. */
export function MemoryGraph({
  graph,
  onSelect,
}: {
  graph: MemoryGraphData;
  onSelect?: (slug: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const size = 520;
  const cx = size / 2;
  const cy = size / 2;

  const placed = useMemo<Placed[]>(() => {
    const byType = new Map<string, typeof graph.nodes>();
    for (const n of graph.nodes) {
      const arr = byType.get(n.type) ?? [];
      arr.push(n);
      byType.set(n.type, arr);
    }
    const types = [...byType.keys()];
    const out: Placed[] = [];
    types.forEach((type, ti) => {
      const ring = 70 + ti * (170 / Math.max(1, types.length));
      const nodes = byType.get(type)!;
      nodes.forEach((n, i) => {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 + ti * 0.6;
        out.push({
          slug: n.slug,
          title: n.title,
          type: n.type,
          x: cx + Math.cos(angle) * ring,
          y: cy + Math.sin(angle) * ring,
        });
      });
    });
    return out;
  }, [graph.nodes, cx, cy]);

  const pos = useMemo(() => new Map(placed.map((p) => [p.slug, p])), [placed]);
  const activeSet = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    for (const e of graph.edges) {
      if (e.from === hover) s.add(e.to);
      if (e.to === hover) s.add(e.from);
    }
    return s;
  }, [hover, graph.edges]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-full max-w-[560px]"
      role="img"
      aria-label="Memory graph"
    >
      {graph.edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const lit = activeSet ? activeSet.has(e.from) && activeSet.has(e.to) : false;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={lit ? "var(--color-clay)" : "var(--color-line-strong)"}
            strokeWidth={lit ? 1.4 : 0.8}
            opacity={activeSet && !lit ? 0.15 : 0.6}
          />
        );
      })}
      {placed.map((p) => {
        const dim = activeSet ? !activeSet.has(p.slug) : false;
        return (
          <g
            key={p.slug}
            transform={`translate(${p.x},${p.y})`}
            onMouseEnter={() => setHover(p.slug)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect?.(p.slug)}
            style={{ cursor: "pointer", opacity: dim ? 0.25 : 1 }}
          >
            <circle r={hover === p.slug ? 7 : 5} fill={TYPE_COLOR[p.type] ?? "var(--color-ink-dim)"} />
            {(hover === p.slug || placed.length <= 24) && (
              <text x={9} y={4} fontSize={10} fill="var(--color-ink-dim)" className="readout">
                {p.title}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
