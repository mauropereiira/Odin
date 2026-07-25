import { defineConfig } from "vitest/config";

// The source uses NodeNext-style ".js" specifiers that point at ".ts" files.
// Strip the extension so Vite resolves them during tests.
export default defineConfig({
  resolve: {
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1" }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
