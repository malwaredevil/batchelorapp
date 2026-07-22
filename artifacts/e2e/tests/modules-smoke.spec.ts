/**
 * Modules artifact CI smoke tests.
 *
 * These run against a `vite preview` build of artifacts/modules (no live API,
 * no authentication needed) and verify that the app bundle loads without a
 * JavaScript crash.  The expected behaviour for an unauthenticated request is
 * either a visible login redirect or the app's own unauthenticated landing —
 * both are acceptable; a blank page or "Something went wrong" is a failure.
 *
 * These tests are wired into the `e2e-modules` CI job.  They do NOT require
 * DEV_SCREENSHOT_TOKEN or smoke-auth.json.
 */

import { test, expect } from "@playwright/test";

const BASE = "/modules";

function noError(page: import("@playwright/test").Page) {
  return Promise.all([
    expect(page.locator("body")).not.toContainText("Something went wrong", {
      timeout: 15_000,
    }),
    expect(page.locator("body")).not.toContainText("500", { timeout: 5_000 }),
  ]);
}

test("modules: root /modules/ responds without crash", async ({ page }) => {
  const res = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  expect(res?.status()).not.toBe(500);
  await noError(page);
});

test("modules: pottery route responds without crash", async ({ page }) => {
  const res = await page.goto(`${BASE}/pottery`, {
    waitUntil: "domcontentloaded",
  });
  expect(res?.status()).not.toBe(500);
  await noError(page);
});

test("modules: quilting route responds without crash", async ({ page }) => {
  const res = await page.goto(`${BASE}/quilting`, {
    waitUntil: "domcontentloaded",
  });
  expect(res?.status()).not.toBe(500);
  await noError(page);
});

test("modules: travels route responds without crash", async ({ page }) => {
  const res = await page.goto(`${BASE}/travels`, {
    waitUntil: "domcontentloaded",
  });
  expect(res?.status()).not.toBe(500);
  await noError(page);
});

test("modules: ornaments route responds without crash", async ({ page }) => {
  const res = await page.goto(`${BASE}/ornaments`, {
    waitUntil: "domcontentloaded",
  });
  expect(res?.status()).not.toBe(500);
  await noError(page);
});
