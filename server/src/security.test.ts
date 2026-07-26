import { describe, expect, it } from "vitest";
import { isLoopbackHost, isLoopbackOrigin, isRequestNamespace } from "./security.js";

describe("loopback request validation", () => {
  it.each([
    "localhost",
    "localhost:7420",
    "127.0.0.1",
    "127.0.0.1:7420",
    "[::1]",
    "[::1]:7420",
  ])("accepts loopback host %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "example.invalid",
    "127.0.0.2",
    "odin.localhost.example.invalid",
    "[::1",
    "::1",
    "[::1]evil",
    "[::1]:evil",
    "localhost:evil",
    "localhost:65536",
  ])("rejects non-loopback host %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });

  it("accepts absent and loopback origins", () => {
    expect(isLoopbackOrigin(undefined)).toBe(true);
    expect(isLoopbackOrigin("http://localhost:5173")).toBe(true);
    expect(isLoopbackOrigin("https://127.0.0.1:7420")).toBe(true);
  });

  it("rejects malformed and non-loopback origins", () => {
    expect(isLoopbackOrigin("not a URL")).toBe(false);
    expect(isLoopbackOrigin("https://example.invalid")).toBe(false);
    expect(isLoopbackOrigin("https://127.0.0.1.example.invalid")).toBe(false);
  });

  it("matches complete request path namespaces", () => {
    expect(isRequestNamespace("/api", "/api")).toBe(true);
    expect(isRequestNamespace("/api/health?full=1", "/api")).toBe(true);
    expect(isRequestNamespace("/apiary", "/api")).toBe(false);
    expect(isRequestNamespace("/ws-help", "/ws")).toBe(false);
  });
});
