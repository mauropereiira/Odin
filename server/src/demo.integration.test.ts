import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let child: ChildProcess;
let root: string;
let port: number;
let brainPath: string;
let dataPath: string;
let skillsPath: string;

async function openPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve an integration-test port."));
        return;
      }
      const selected = address.port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

function fetchApi(
  path: string,
  options: { method?: string; host?: string; origin?: string; body?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? `127.0.0.1:${port}`,
          ...(options.origin ? { origin: options.origin } : {}),
          ...(options.body ? { "content-type": "application/json", "content-length": Buffer.byteLength(options.body) } : {}),
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body,
        }));
      },
    );
    req.once("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetchApi("/api/health");
      if (response.status === 200) return;
    } catch {
      // The child has not bound its loopback listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Demo integration server did not become ready.");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "odin-demo-integration-"));
  port = await openPort();
  brainPath = join(root, "forbidden-brain");
  dataPath = join(root, "forbidden-data");
  skillsPath = join(root, "forbidden-skills");
  await Promise.all([brainPath, dataPath, skillsPath].map(async (path) => {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "canary.txt"), "must remain untouched\n", "utf8");
  }));
  child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./test/register-demo-import-guard.mjs", "src/main.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(root, "home"),
        HELM_PORT: String(port),
        ODIN_DEMO: "1",
        ODIN_BRAIN_DIR: brainPath,
        ODIN_DATA_DIR: dataPath,
        ODIN_SKILLS_DIR: skillsPath,
        HELM_CLAUDE_DIR: join(root, "forbidden-claude"),
        CODEX_HOME: join(root, "forbidden-codex"),
        ODIN_CLAUDE_BIN: join(root, "must-not-run-claude"),
        ODIN_CODEX_BIN: join(root, "must-not-run-codex"),
        ODIN_MOLDAVITE_BIN: join(root, "must-not-run-moldavite"),
        ODIN_TEST_CANARY: "must-not-appear-in-demo-output",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.once("exit", (code) => {
    if (code && code !== 0) console.error(`Demo integration server exited ${code}: ${stderr}`);
  });
  await waitUntilReady();
}, 20_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(resolve, 7_000).unref();
    });
  }
  await rm(root, { recursive: true, force: true });
}, 10_000);

describe("ODIN_DEMO API boundary", () => {
  it("preserves loopback Host and Origin protection", async () => {
    expect((await fetchApi("/api/health", { host: "example.invalid" })).status).toBe(403);
    expect((await fetchApi("/api/health", { origin: "https://example.invalid" })).status).toBe(403);
    expect((await fetchApi("/api/health", { origin: `http://localhost:${port}` })).status).toBe(200);
  });

  it("marks responses as synthetic and read-only", async () => {
    const health = await fetchApi("/api/health");
    expect(health.status).toBe(200);
    expect(health.headers["x-odin-mode"]).toBe("demo");
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(health.body)).toMatchObject({ service: "odin", mode: "demo", readOnly: true });

    const head = await fetchApi("/api/health", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
  });

  it("serves every synthetic collection without leaking environment canaries", async () => {
    const paths = [
      "/api/providers",
      "/api/capabilities",
      "/api/overview",
      "/api/ratelimit",
      "/api/plan",
      "/api/sessions",
      "/api/sessions/live",
      "/api/sessions/demo-session-01",
      "/api/usage",
      "/api/mcp",
      "/api/projects",
      "/api/brain",
      "/api/brain/memories",
      "/api/brain/memories/operating-principles",
      "/api/brain/graph",
      "/api/brain/search?q=release",
      "/api/skills",
      "/api/converse/sessions",
      "/api/converse/sessions/11111111-1111-4111-8111-111111111111",
      "/api/agents",
    ];
    for (const path of paths) {
      const response = await fetchApi(path);
      expect(response.status, path).toBe(200);
      expect(() => JSON.parse(response.body), path).not.toThrow();
      expect(response.body, path).not.toContain(process.env.USER ?? "unlikely-user-value");
      expect(response.body, path).not.toContain("must-not-appear-in-demo-output");
      expect(response.body, path).not.toContain(root);
    }
  });

  it("rejects all mutations and unknown API routes before live handlers", async () => {
    const mutation = await fetchApi("/api/brain/memories", {
      method: "POST",
      body: JSON.stringify({ title: "Must not persist" }),
    });
    expect(mutation.status).toBe(403);
    expect(JSON.parse(mutation.body)).toMatchObject({ code: "ODIN_DEMO_READ_ONLY" });

    const unknown = await fetchApi("/api/future-live-handler");
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body)).toMatchObject({ code: "ODIN_DEMO_NOT_FOUND" });
  });

  it("never imports live subsystems or modifies configured storage roots", async () => {
    for (const path of [brainPath, dataPath, skillsPath]) {
      expect(await readdir(path)).toEqual(["canary.txt"]);
      expect(await readFile(join(path, "canary.txt"), "utf8")).toBe("must remain untouched\n");
    }
  });
});
