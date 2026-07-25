import {
  Bot,
  Check,
  CircleAlert,
  FilePen,
  FileText,
  Globe,
  LoaderCircle,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

export function ToolChip({
  name,
  input,
  done,
  isError,
  className,
}: {
  name: string;
  input: unknown;
  done: boolean;
  isError: boolean;
  className?: string;
}) {
  const Icon = toolIcon(name);
  const summary = toolSummary(name, input);
  return (
    <div
      className={clsx(
        "flex min-w-0 items-center gap-2 rounded-lg border border-line bg-panel-2/65 px-3 py-2",
        className,
      )}
    >
      <Icon size={13} className={isError ? "shrink-0 text-amber" : "shrink-0 text-teal"} />
      <span className="micro-label shrink-0 text-ink-dim">{name}</span>
      <span
        className="readout min-w-0 flex-1 truncate text-[10px] text-ink-faint"
        title={summary}
      >
        {summary}
      </span>
      {!done ? (
        <LoaderCircle size={12} className="shrink-0 text-clay motion-safe:animate-spin" />
      ) : isError ? (
        <CircleAlert size={12} className="shrink-0 text-amber" />
      ) : (
        <Check size={12} className="shrink-0 text-teal" />
      )}
    </div>
  );
}

function toolIcon(name: string): LucideIcon {
  const tool = name.toLowerCase();
  if (tool === "read") return FileText;
  if (tool === "edit" || tool === "write") return FilePen;
  if (tool === "bash") return SquareTerminal;
  if (tool === "grep" || tool === "glob") return Search;
  if (tool === "webfetch" || tool === "websearch") return Globe;
  if (tool === "task") return Bot;
  return Wrench;
}

function toolSummary(name: string, input: unknown): string {
  const details = asRecord(input);
  const tool = name.toLowerCase();
  if (tool === "bash") return stringField(details, "command") || "running command";
  if (tool === "read" || tool === "edit" || tool === "write") {
    return stringField(details, "file_path", "path", "notebook_path") || "working with file";
  }
  if (tool === "grep" || tool === "glob") {
    return stringField(details, "pattern", "path") || "searching workspace";
  }
  if (tool === "webfetch") return stringField(details, "url") || "fetching web content";
  if (tool === "websearch") return stringField(details, "query") || "searching the web";
  if (tool === "task") return stringField(details, "description", "prompt") || "delegating task";
  try {
    return input === undefined ? "working" : JSON.stringify(input);
  } catch {
    return "working";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  return null;
}
