import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { MemoryGraph as MemoryGraphData } from "../lib/types";

const TYPE_COLOR: Record<string, string> = {
  person: "var(--color-clay)",
  preference: "var(--color-teal)",
  project: "var(--color-iris)",
  decision: "var(--color-amber)",
  idea: "var(--color-clay-bright)",
  fact: "var(--color-ink-dim)",
  reference: "var(--color-rose)",
};
const TYPE_ORDER = ["person", "preference", "project", "decision", "idea", "fact", "reference"];
const SIZE = 520;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

interface Placed {
  slug: string;
  title: string;
  type: string;
  x: number;
  y: number;
}

interface Cluster {
  type: string;
  radius: number;
  count: number;
}

interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

function normalizeType(type: string): string {
  return type.trim().toLowerCase() || "fact";
}

function typeColor(type: string): string {
  return TYPE_COLOR[type] ?? "var(--color-ink-dim)";
}

function clampCamera(camera: Camera): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale));
  if (scale === MIN_SCALE) return { scale, tx: 0, ty: 0 };
  const minimum = SIZE - SIZE * scale;
  return {
    scale,
    tx: Math.min(0, Math.max(minimum, camera.tx)),
    ty: Math.min(0, Math.max(minimum, camera.ty)),
  };
}

/** Dependency-free constellation clustered by memory type. */
export function MemoryGraph({
  graph,
  onSelect,
  expanded = false,
}: {
  graph: MemoryGraphData;
  onSelect?: (slug: string) => void;
  expanded?: boolean;
}) {
  const helpId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set());
  const [camera, setCamera] = useState<Camera>({ scale: 1, tx: 0, ty: 0 });

  const { placed, clusters, types } = useMemo(() => {
    const byType = new Map<string, Array<(typeof graph.nodes)[number]>>();
    for (const node of graph.nodes) {
      const type = normalizeType(node.type);
      const nodes = byType.get(type) ?? [];
      nodes.push(node);
      byType.set(type, nodes);
    }
    const types = [...byType.keys()].sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a);
      const bi = TYPE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    const placed: Placed[] = [];
    const clusters: Cluster[] = [];
    types.forEach((type, typeIndex) => {
      const radius = types.length === 1
        ? 145
        : 72 + typeIndex * (166 / Math.max(1, types.length - 1));
      const nodes = [...(byType.get(type) ?? [])].sort((a, b) => a.slug.localeCompare(b.slug));
      clusters.push({ type, radius, count: nodes.length });
      nodes.forEach((node, index) => {
        const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2 + typeIndex * 0.55;
        placed.push({
          slug: node.slug,
          title: node.title,
          type,
          x: SIZE / 2 + Math.cos(angle) * radius,
          y: SIZE / 2 + Math.sin(angle) * radius,
        });
      });
    });
    return { placed, clusters, types };
  }, [graph.nodes]);

  const visiblePlaced = useMemo(
    () => placed.filter((node) => !hiddenTypes.has(node.type)),
    [hiddenTypes, placed],
  );
  const visibleSlugs = useMemo(() => new Set(visiblePlaced.map((node) => node.slug)), [visiblePlaced]);
  const positions = useMemo(() => new Map(placed.map((node) => [node.slug, node])), [placed]);
  const activeSet = useMemo(() => {
    if (!hover || !visibleSlugs.has(hover)) return null;
    const active = new Set<string>([hover]);
    for (const edge of graph.edges) {
      if (edge.from === hover && visibleSlugs.has(edge.to)) active.add(edge.to);
      if (edge.to === hover && visibleSlugs.has(edge.from)) active.add(edge.from);
    }
    return active;
  }, [graph.edges, hover, visibleSlugs]);

  useEffect(() => {
    if (!visiblePlaced.length) {
      setFocused(null);
      setHover(null);
      return;
    }
    if (!focused || !visibleSlugs.has(focused)) setFocused(visiblePlaced[0].slug);
    if (hover && !visibleSlugs.has(hover)) setHover(null);
  }, [focused, hover, visiblePlaced, visibleSlugs]);

  const updateZoom = (nextScale: number, focusX = SIZE / 2, focusY = SIZE / 2) => {
    setCamera((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const ratio = scale / current.scale;
      return clampCamera({
        scale,
        tx: focusX - (focusX - current.tx) * ratio,
        ty: focusY - (focusY - current.ty) * ratio,
      });
    });
  };

  const resetCamera = () => setCamera({ scale: 1, tx: 0, ty: 0 });
  const panBy = (dx: number, dy: number) => {
    setCamera((current) => clampCamera({ ...current, tx: current.tx + dx, ty: current.ty + dy }));
  };

  const svgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return { x: SIZE / 2, y: SIZE / 2 };
    const rendered = Math.min(rect.width, rect.height);
    const offsetX = (rect.width - rendered) / 2;
    const offsetY = (rect.height - rendered) / 2;
    return {
      x: ((clientX - rect.left - offsetX) / rendered) * SIZE,
      y: ((clientY - rect.top - offsetY) / rendered) * SIZE,
    };
  };

  useEffect(() => {
    const element = svgRef.current;
    if (!expanded || !element) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const point = svgPoint(event.clientX, event.clientY);
      updateZoom(camera.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), point.x, point.y);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [camera.scale, expanded]);

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!expanded || !event.isPrimary || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!expanded || !drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rendered = Math.min(rect.width, rect.height) || SIZE;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.moved) panBy((dx / rendered) * SIZE, (dy / rendered) * SIZE);
  };

  const finishPointer = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    if (drag.moved) {
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const focusNode = (index: number) => {
    if (!visiblePlaced.length) return;
    const normalized = (index + visiblePlaced.length) % visiblePlaced.length;
    const slug = visiblePlaced[normalized].slug;
    setFocused(slug);
    requestAnimationFrame(() => nodeRefs.current.get(slug)?.focus());
  };

  const onNodeKeyDown = (event: KeyboardEvent<SVGGElement>, slug: string) => {
    const index = visiblePlaced.findIndex((node) => node.slug === slug);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(slug);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusNode(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusNode(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusNode(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusNode(visiblePlaced.length - 1);
    } else if (expanded && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      updateZoom(camera.scale + 0.25);
    } else if (expanded && event.key === "-") {
      event.preventDefault();
      updateZoom(camera.scale - 0.25);
    } else if (expanded && event.key === "0") {
      event.preventDefault();
      resetCamera();
    }
  };

  const toggleType = (type: string) => {
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const canvas = (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={expanded ? "min-h-0 w-full flex-1 select-none overscroll-contain" : "w-full max-w-[560px]"}
      style={expanded ? { touchAction: "none" } : undefined}
      role="group"
      aria-label="Memory graph"
      aria-describedby={helpId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    >
      <g transform={`matrix(${camera.scale} 0 0 ${camera.scale} ${camera.tx} ${camera.ty})`}>
        {clusters.map((cluster) => {
          if (hiddenTypes.has(cluster.type)) return null;
          return (
            <g key={cluster.type} aria-hidden="true">
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={cluster.radius}
                fill="none"
                stroke={typeColor(cluster.type)}
                strokeWidth={0.7}
                strokeDasharray="3 7"
                opacity={0.2}
                vectorEffect="non-scaling-stroke"
              />
              {expanded && (
                <text
                  x={SIZE / 2}
                  y={SIZE / 2 - cluster.radius - 7}
                  textAnchor="middle"
                  fontSize={8}
                  fill={typeColor(cluster.type)}
                  opacity={0.75}
                  className="readout"
                >
                  {cluster.type.toUpperCase()} {cluster.count}
                </text>
              )}
            </g>
          );
        })}
        {graph.edges.map((edge, index) => {
          if (!visibleSlugs.has(edge.from) || !visibleSlugs.has(edge.to)) return null;
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const lit = activeSet ? activeSet.has(edge.from) && activeSet.has(edge.to) : false;
          return (
            <line
              key={`${edge.from}-${edge.to}-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={lit ? "var(--color-clay)" : "var(--color-line-strong)"}
              strokeWidth={lit ? 1.4 : 0.8}
              opacity={activeSet && !lit ? 0.15 : 0.6}
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
          );
        })}
        {visiblePlaced.map((node) => {
          const dim = activeSet ? !activeSet.has(node.slug) : false;
          const active = hover === node.slug;
          return (
            <g
              key={node.slug}
              ref={(element) => {
                if (element) nodeRefs.current.set(node.slug, element);
                else nodeRefs.current.delete(node.slug);
              }}
              transform={`translate(${node.x},${node.y})`}
              onMouseEnter={() => setHover(node.slug)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => {
                setFocused(node.slug);
                setHover(node.slug);
              }}
              onBlur={() => setHover(null)}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onSelect?.(node.slug);
              }}
              onKeyDown={(event) => onNodeKeyDown(event, node.slug)}
              role="button"
              tabIndex={focused === node.slug ? 0 : -1}
              aria-label={`Open memory ${node.title}`}
              style={{ cursor: "pointer", opacity: dim ? 0.25 : 1 }}
            >
              <circle r={14} fill="transparent" />
              <circle
                r={active ? 7 : 5}
                fill={typeColor(node.type)}
                stroke={active ? "var(--color-ink)" : "none"}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              {(active || visiblePlaced.length <= 24) && (
                <text x={9} y={4} fontSize={10} fill="var(--color-ink-dim)" className="readout">
                  {node.title.length > 34 ? `${node.title.slice(0, 32)}...` : node.title}
                </text>
              )}
            </g>
          );
        })}
        {!visiblePlaced.length && (
          <text x={SIZE / 2} y={SIZE / 2} textAnchor="middle" fontSize={12} fill="var(--color-ink-faint)" className="readout">
            All memory types are hidden
          </text>
        )}
      </g>
    </svg>
  );

  return (
    <div className={expanded ? "flex h-full min-h-0 w-full flex-col gap-3" : "contents"}>
      <span id={helpId} className="sr-only">
        Memory nodes are clustered by type. Use arrow keys to move between nodes and Enter to open one.
        {expanded ? " Use plus and minus to zoom, zero to reset, or drag the canvas to pan." : ""}
      </span>
      {expanded && (
        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label="Memory type filters">
            <button
              type="button"
              onClick={() => setHiddenTypes(new Set())}
              disabled={hiddenTypes.size === 0}
              className="h-9 shrink-0 rounded-lg border border-line bg-panel-2 px-3 readout text-[10px] text-ink-dim transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              All types
            </button>
            {types.map((type) => {
              const cluster = clusters.find((item) => item.type === type);
              const visible = !hiddenTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={visible}
                  onClick={() => toggleType(type)}
                  className={`flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 readout text-[10px] uppercase transition-colors ${
                    visible
                      ? "border-line-strong bg-panel-2 text-ink"
                      : "border-line bg-transparent text-ink-faint opacity-55"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: typeColor(type) }} />
                  {type} {cluster?.count ?? 0}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => updateZoom(camera.scale - 0.25)}
              disabled={camera.scale <= MIN_SCALE}
              aria-label="Zoom out"
              className="h-9 w-10 rounded-lg border border-line bg-panel-2 readout text-sm text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-35"
            >
              -
            </button>
            <span className="w-12 text-center readout text-[10px] text-ink-faint" aria-live="polite">
              {Math.round(camera.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => updateZoom(camera.scale + 0.25)}
              disabled={camera.scale >= MAX_SCALE}
              aria-label="Zoom in"
              className="h-9 w-10 rounded-lg border border-line bg-panel-2 readout text-sm text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-35"
            >
              +
            </button>
            <button
              type="button"
              onClick={resetCamera}
              disabled={camera.scale === 1 && camera.tx === 0 && camera.ty === 0}
              className="h-9 rounded-lg border border-line bg-panel-2 px-3 readout text-[10px] text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-35"
            >
              Reset view
            </button>
          </div>
        </div>
      )}
      {canvas}
    </div>
  );
}
