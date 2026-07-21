import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.SMOKE_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:80");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-smoke-report", open: "never" }],
  ],
  globalSetup: "./tests/smoke.global-setup.ts",
  use: {
    baseURL: BASE_URL,
    storageState: "smoke-auth.json",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium-smoke",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/smoke.spec.ts",
    },
  ],
});
