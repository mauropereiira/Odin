import { describe, expect, it } from "vitest";
import { composeOdinInstructions } from "./identity.js";

describe("composeOdinInstructions", () => {
  it("keeps Odin's identity and recall stable across providers", () => {
    const claude = composeOdinInstructions({ provider: "claude-code", recall: "MEMORY BLOCK" });
    const codex = composeOdinInstructions({ provider: "codex", recall: "MEMORY BLOCK" });
    for (const instructions of [claude, codex]) {
      expect(instructions).toContain("You are Odin");
      expect(instructions).toContain("MEMORY BLOCK");
      expect(instructions).toContain("your identity remains Odin");
    }
  });
});
