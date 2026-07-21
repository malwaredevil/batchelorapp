import { defineConfig, devices } from "@playwright/test";

const PREVIEW_PORT = 4173;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-critical",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/*.spec.ts",
    },
  ],
  webServer: {
    command: "pnpm --filter @workspace/web run serve",
    url: `http://localhost:${PREVIEW_PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PREVIEW_PORT),
      BASE_PATH: "/",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
