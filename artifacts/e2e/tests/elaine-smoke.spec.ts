/**
 * Elaine artifact CI smoke tests.
 *
 * Run against a `vite preview` build of artifacts/elaine (no live API, no
 * authentication needed) and verify that the Elaine chat bundle loads without
 * a JavaScript crash.  Unauthenticated request → login redirect is acceptable;
 * a blank page or "Something went wrong" is a failure.
 *
 * Wired into the `e2e-elaine` CI job.  Does NOT require DEV_SCREENSHOT_TOKEN
 * or smoke-auth.json.
 */

import { test, expect } from "@playwright/test";

test("elaine: root /elaine/ responds without crash", async ({ page }) => {
  const res = await page.goto("/elaine/", { waitUntil: "domcontentloaded" });
  expect(res?.status()).not.toBe(500);
  await expect(page.locator("body")).not.toContainText("Something went wrong", {
    timeout: 15_000,
  });
  await expect(page.locator("body")).not.toContainText("500", {
    timeout: 5_000,
  });
});

test("elaine: /elaine/chat route responds without crash", async ({ page }) => {
  const res = await page.goto("/elaine/chat", {
    waitUntil: "domcontentloaded",
  });
  expect(res?.status()).not.toBe(500);
  await expect(page.locator("body")).not.toContainText("Something went wrong", {
    timeout: 15_000,
  });
});
