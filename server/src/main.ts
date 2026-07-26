if (process.env.ODIN_DEMO === "1") {
  await import("./demo-server.js");
} else {
  await import("./index.js");
}

export {};
