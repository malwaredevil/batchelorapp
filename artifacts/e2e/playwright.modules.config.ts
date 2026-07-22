import { defineConfig, devices } from "@playwright/test";

const PREVIEW_PORT = 4174;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-modules", open: "never" }],
  ],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-modules",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/modules-smoke.spec.ts",
    },
  ],
  webServer: {
    command: "pnpm --filter @workspace/modules run serve",
    url: `http://localhost:${PREVIEW_PORT}/modules/`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PREVIEW_PORT),
      BASE_PATH: "/modules/",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
