import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildMcp } from "./runner.js";

// process.execPath is a real, always-present file — stand in for the binary.
beforeEach(() => {
  process.env.HELM_MOLDAVITE_BIN = process.execPath;
  delete process.env.ODIN_NOTES_ENABLED;
  delete process.env.ODIN_NOTES_FORGE;
});
afterEach(() => {
  delete process.env.HELM_MOLDAVITE_BIN;
  delete process.env.ODIN_NOTES_ENABLED;
  delete process.env.ODIN_NOTES_FORGE;
});

describe("buildMcp", () => {
  it("gives a worker the 7 moldavite tools on the Default forge, no fleet", () => {
    const { mcpServers, allowed } = buildMcp({ orchestrator: false });
    expect(Object.keys(mcpServers)).toEqual(["moldavite"]);
    expect((mcpServers.moldavite as { args: string[] }).args).toEqual([
      "--mcp",
      "--forge",
      "Default",
    ]);
    expect(allowed.filter((t) => t.startsWith("mcp__moldavite__"))).toHaveLength(7);
    expect(allowed).toContain("mcp__moldavite__read_note");
    expect(allowed.some((t) => t.startsWith("mcp__odin__"))).toBe(false);
  });
  it("adds the odin fleet server + tools for the orchestrator", () => {
    const { mcpServers, allowed } = buildMcp({
      orchestrator: true,
      provider: "codex",
      permissionMode: "read-only",
    });
    expect(Object.keys(mcpServers).sort()).toEqual(["moldavite", "odin"]);
    expect(allowed).toContain("mcp__odin__dispatch_agent");
    expect(mcpServers.odin.env?.ODIN_ACCESS_LEVEL).toBe("read-only");
  });
  it("respects ODIN_NOTES_FORGE", () => {
    process.env.ODIN_NOTES_FORGE = "Work";
    const { mcpServers } = buildMcp({ orchestrator: false });
    expect((mcpServers.moldavite as { args: string[] }).args).toEqual(["--mcp", "--forge", "Work"]);
  });
  it("omits moldavite when disabled or the binary is missing", () => {
    process.env.ODIN_NOTES_ENABLED = "0";
    expect(buildMcp({ orchestrator: false }).mcpServers.moldavite).toBeUndefined();
    delete process.env.ODIN_NOTES_ENABLED;
    process.env.HELM_MOLDAVITE_BIN = "/nope/does/not/exist";
    expect(buildMcp({ orchestrator: false }).mcpServers.moldavite).toBeUndefined();
  });
});
