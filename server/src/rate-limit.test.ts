import { afterEach, describe, expect, it } from "vitest";
import { requestLimitMax } from "./rate-limit.js";

afterEach(() => {
  delete process.env.ODIN_RATE_LIMIT_MAX;
});

describe("request rate limit", () => {
  it("uses a bounded configured value", () => {
    process.env.ODIN_RATE_LIMIT_MAX = "120";
    expect(requestLimitMax()).toBe(120);
  });

  it.each(["0", "9", "10001", "2.5", "invalid"])("rejects invalid value %s", (value) => {
    process.env.ODIN_RATE_LIMIT_MAX = value;
    expect(requestLimitMax()).toBe(600);
  });
});
