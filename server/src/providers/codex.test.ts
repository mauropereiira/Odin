import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@openai/codex-sdk";
import { normalizeCodexEvent } from "./codex.js";

describe("normalizeCodexEvent", () => {
  it("normalizes agent text and usage", () => {
    const text = normalizeCodexEvent("r1", {
      type: "item.completed",
      item: { id: "m1", type: "agent_message", text: "Odin answer" },
    } as ThreadEvent);
    expect(text).toEqual([{ runId: "r1", type: "text", text: "Odin answer" }]);

    const result = normalizeCodexEvent("r1", {
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 4,
        cache_write_input_tokens: 2,
        output_tokens: 5,
        reasoning_output_tokens: 3,
      },
    } as ThreadEvent);
    expect(result[0]).toMatchObject({
      type: "result",
      ok: true,
      usage: { input: 10, cachedInput: 4, output: 5, reasoningOutput: 3 },
    });
  });

  it("emits one tool start followed by its terminal result", () => {
    const tools = new Set<string>();
    const item = {
      id: "cmd1",
      type: "command_execution",
      command: "npm test",
      aggregated_output: "ok",
      status: "completed",
      exit_code: 0,
    };
    expect(normalizeCodexEvent("r1", { type: "item.started", item } as ThreadEvent, tools)).toEqual([
      { runId: "r1", type: "tool_use", id: "cmd1", name: "Shell", input: { command: "npm test" } },
    ]);
    expect(normalizeCodexEvent("r1", { type: "item.completed", item } as ThreadEvent, tools)).toEqual([
      { runId: "r1", type: "tool_result", id: "cmd1", isError: false, output: "ok" },
    ]);
  });

  it("treats item errors as non-fatal tool failures", () => {
    expect(normalizeCodexEvent("r1", {
      type: "item.completed",
      item: { id: "warning1", type: "error", message: "A subtask failed" },
    } as ThreadEvent)).toEqual([
      { runId: "r1", type: "tool_use", id: "warning1", name: "Codex warning", input: {} },
      { runId: "r1", type: "tool_result", id: "warning1", isError: true, output: "A subtask failed" },
    ]);
  });
});
