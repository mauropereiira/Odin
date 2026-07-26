import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ODIN_E2E_PORT ?? 7421);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm start",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ODIN_DEMO: "1",
      HELM_PORT: String(port),
    },
  },
});
