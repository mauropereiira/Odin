import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDemoData, demoResponse } from "./demo.js";
import { isLoopbackHost, isLoopbackOrigin, isRequestNamespace } from "./security.js";

const PORT = Number(process.env.HELM_PORT || 7420);
const data = createDemoData();
const app = Fastify({ logger: false });

app.addHook("onRequest", async (request, reply) => {
  if (!isLoopbackHost(request.headers.host)) {
    return reply.code(403).send({ error: "Forbidden: non-loopback host" });
  }
  if (!isLoopbackOrigin(request.headers.origin)) {
    return reply.code(403).send({ error: "Forbidden: cross-origin request" });
  }
});

app.addHook("onRequest", async (request, reply) => {
  if (!isRequestNamespace(request.url, "/api")) return;
  reply.header("x-odin-mode", "demo").header("cache-control", "no-store");
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply.code(403).send({
      error: "Demo mode is read-only.",
      code: "ODIN_DEMO_READ_ONLY",
    });
  }
  const response = demoResponse(data, request.url);
  if (response === undefined) {
    return reply.code(404).send({ error: "Demo endpoint not found.", code: "ODIN_DEMO_NOT_FOUND" });
  }
  return reply.send(response);
});

await app.register(websocket);
app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ kind: "hello", at: new Date().toISOString(), demo: true }));
  });
});

const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (
      (request.method === "GET" || request.method === "HEAD")
      && !isRequestNamespace(request.url, "/api")
      && !isRequestNamespace(request.url, "/ws")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });
  console.log(`ᛟ Serving synthetic demo UI from ${webDist}`);
}

try {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`ᛟ Odin demo ready on http://127.0.0.1:${PORT}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

let shuttingDown = false;
function handleSignal(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(0), 6_000);
  forceExit.unref();
  void app.close().finally(() => process.exit(0));
}

process.once("SIGTERM", handleSignal);
process.once("SIGINT", handleSignal);
