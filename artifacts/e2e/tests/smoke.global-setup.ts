import { chromium } from "@playwright/test";

export default async function globalSetup() {
  const token = process.env.DEV_SCREENSHOT_TOKEN;
  const baseURL =
    process.env.SMOKE_BASE_URL ??
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:80");

  if (!token) {
    console.warn(
      "[smoke] DEV_SCREENSHOT_TOKEN not set — unauthenticated, tests will skip.",
    );
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  await page.goto(
    `/api/dev/screenshot-login?token=${encodeURIComponent(token)}&next=/`,
    { waitUntil: "networkidle" },
  );

  await context.storageState({ path: "smoke-auth.json" });
  await browser.close();
  console.log("[smoke] Auth state saved to smoke-auth.json");
}
