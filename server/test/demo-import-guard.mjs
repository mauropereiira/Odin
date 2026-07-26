const LIVE_MODULE_PATHS = [
  "/src/converse.ts",
  "/src/fleet.ts",
  "/src/identity.ts",
  "/src/index.ts",
  "/src/runner.ts",
  "/src/watcher.ts",
  "/src/memory/",
  "/src/providers/",
  "/src/skills/",
  "/src/sources/",
];

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  const normalized = result.url.replaceAll("\\", "/");
  const livePath = LIVE_MODULE_PATHS.find((path) => normalized.includes(path));
  if (livePath) {
    throw new Error(`Demo mode imported forbidden live module: ${livePath}`);
  }
  return result;
}
