import {
  extractWikiLinks,
  listMemorySlugs,
  readMemory,
  type StoredMemory,
} from "../memory/forge.js";
import type { BrainStats, BrainSummary, Memory, MemoryGraph } from "../types.js";

/**
 * The `brain` source reads Odin's Forge (memory notes) into DTOs for the
 * dashboard. Pure reads with a per-note parse cache keyed by mtime, mirroring
 * the `sessions` source. Never writes — `memory/forge.ts` owns writes.
 */

interface Cached {
  mtimeMs: number;
  memory: Memory;
}
const cache = new Map<string, Cached>(); // slug → parsed
let lastGood: Memory[] | null = null;

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function firstHeading(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}
function toExcerpt(body: string): string {
  const text = body
    .replace(/^#.*$/m, "")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .trim();
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

function toMemory(stored: StoredMemory): Memory {
  const fm = stored.frontmatter;
  const title = str(fm.title) ?? firstHeading(stored.body) ?? stored.slug;
  return {
    slug: stored.slug,
    title,
    type: str(fm.type) ?? "fact",
    body: stored.body,
    excerpt: toExcerpt(stored.body),
    created: str(fm.created),
    updated: str(fm.updated),
    source: str(fm.source),
    session: str(fm.session),
    pinned: fm.pinned === true,
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    links: extractWikiLinks(stored.body),
    color: str(fm.color),
  };
}

async function loadAll(): Promise<Memory[]> {
  let refs: { slug: string; path: string; mtimeMs: number }[];
  try {
    refs = await listMemorySlugs();
  } catch {
    return lastGood ?? [];
  }
  const out: Memory[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    seen.add(ref.slug);
    const hit = cache.get(ref.slug);
    if (hit && hit.mtimeMs === ref.mtimeMs) {
      out.push(hit.memory);
      continue;
    }
    const stored = await readMemory(ref.slug);
    if (!stored) continue;
    const memory = toMemory(stored);
    cache.set(ref.slug, { mtimeMs: ref.mtimeMs, memory });
    out.push(memory);
  }
  for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key);
  out.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  lastGood = out;
  return out;
}

function withinWeek(iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < 7 * 24 * 60 * 60 * 1000;
}

export const brain = {
  id: "brain",

  async list(): Promise<Memory[]> {
    return loadAll();
  },

  async get(slug: string): Promise<Memory | null> {
    return (await loadAll()).find((m) => m.slug === slug) ?? null;
  },

  async search(q: string): Promise<Memory[]> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return (await loadAll()).filter(
      (m) => m.title.toLowerCase().includes(needle) || m.body.toLowerCase().includes(needle),
    );
  },

  async graph(): Promise<MemoryGraph> {
    const all = await loadAll();
    const nodes = all.map((m) => ({ slug: m.slug, title: m.title, type: m.type }));
    const present = new Set(nodes.map((n) => n.slug));
    const edges = all.flatMap((m) =>
      m.links.filter((to) => present.has(to) && to !== m.slug).map((to) => ({ from: m.slug, to })),
    );
    return { nodes, edges };
  },

  async stats(): Promise<BrainStats> {
    const all = await loadAll();
    const counts = new Map<string, number>();
    for (const m of all) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    return {
      total: all.length,
      byType: [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      newThisWeek: all.filter((m) => withinWeek(m.created ?? m.updated)).length,
    };
  },

  async summary(): Promise<BrainSummary> {
    const all = await loadAll();
    return { total: all.length, recent: all.slice(0, 8), stats: await this.stats() };
  },

  invalidate() {
    cache.clear();
    lastGood = null;
  },
};
