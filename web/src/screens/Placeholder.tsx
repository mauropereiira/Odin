import { Panel } from "../components/ui";

/** Temporary screen body — replaced by the real screens (Codex). */
export function Placeholder({ name, note }: { name: string; note: string }) {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-lg font-semibold text-ink">{name}</h1>
        <p className="text-sm text-ink-dim">{note}</p>
      </header>
      <Panel label="Under construction">
        <p className="py-8 text-center text-sm text-ink-faint">
          This screen is being built.
        </p>
      </Panel>
    </div>
  );
}
