import { defineConfig, devices } from "@playwright/test";

const PREVIEW_PORT = 4175;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-elaine", open: "never" }],
  ],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-elaine",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/elaine-smoke.spec.ts",
    },
  ],
  webServer: {
    command: "pnpm --filter @workspace/elaine run serve",
    url: `http://localhost:${PREVIEW_PORT}/elaine/`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PREVIEW_PORT),
      BASE_PATH: "/elaine/",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
