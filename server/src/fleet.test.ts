import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => {
  let releaseRecall: (value: string) => void = () => undefined;
  return {
    startConversation: vi.fn(() => ({ runId: "run_test" })),
    stopConversation: vi.fn(() => false),
    recall: vi.fn(() => new Promise<string>((resolve) => {
      releaseRecall = resolve;
    })),
    releaseRecall: (value: string) => releaseRecall(value),
  };
});

vi.mock("./runner.js", () => ({
  startConversation: mocks.startConversation,
  stopConversation: mocks.stopConversation,
}));
vi.mock("./memory/recall.js", () => ({ buildRecallBlock: mocks.recall }));

import { createAgent, flushFleetPersistence, listAgents, promptAgent, removeAgent } from "./fleet.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "odin-fleet-"));
  process.env.ODIN_DATA_DIR = dir;
  mocks.startConversation.mockClear();
  mocks.stopConversation.mockClear();
  mocks.recall.mockClear();
});
afterEach(async () => {
  await flushFleetPersistence();
  delete process.env.ODIN_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("Fleet launch reservation", () => {
  it("refuses removal while recall is loading", async () => {
    const agent = await createAgent({ provider: "codex", cwd: dir, title: "Race test" });
    const prompting = promptAgent(agent.id, "work");
    await expect(removeAgent(agent.id)).resolves.toBe(false);
    await vi.waitFor(() => expect(mocks.recall).toHaveBeenCalledOnce());
    mocks.releaseRecall("");
    await expect(prompting).resolves.toEqual({ runId: "run_test" });
    expect(mocks.startConversation).toHaveBeenCalledOnce();
  });

  it("releases the reservation when initial persistence fails", async () => {
    const agent = await createAgent({ provider: "codex", cwd: dir, title: "Persistence test" });
    const blocked = join(dir, "blocked");
    await writeFile(blocked, "not a directory", "utf8");
    process.env.ODIN_DATA_DIR = blocked;

    await expect(promptAgent(agent.id, "work")).rejects.toThrow("Unable to persist Fleet agent");
    const failed = listAgents().find((candidate) => candidate.id === agent.id);
    expect(failed?.status).toBe("error");
    expect(failed?.lastRunId).toBeNull();
    expect(mocks.startConversation).not.toHaveBeenCalled();

    process.env.ODIN_DATA_DIR = dir;
    await expect(removeAgent(agent.id)).resolves.toBe(true);
  });
});
