/**
 * App smoke tests — run against the full live dev stack.
 *
 * Usage:
 *   pnpm --filter @workspace/e2e run test:smoke
 *
 * Requires:
 *   - DEV_SCREENSHOT_TOKEN env var (plain var, not a secret)
 *   - All dev workflows running (api-server, modules, web, elaine)
 *   - REPLIT_DEV_DOMAIN set (automatic in Replit environment)
 *
 * Test data cleanup policy:
 *   Any record created during a test is tagged with a SMOKE_ prefix and
 *   deleted in the same test's cleanup step. Only records created by these
 *   tests are touched — no pre-existing data is modified.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";

const TOKEN = process.env.DEV_SCREENSHOT_TOKEN ?? "";

test.beforeAll(async () => {
  if (!TOKEN) {
    test.skip();
  }
  if (!fs.existsSync("smoke-auth.json")) {
    throw new Error(
      "smoke-auth.json missing — global setup did not run. " +
        "Run: pnpm --filter @workspace/e2e run test:smoke",
    );
  }
});

// ── Hub ──────────────────────────────────────────────────────────────────────

/**
 * Verifies the three restored hub widgets render correctly after an
 * authenticated page load — the real crash risk is when live API data
 * arrives post-login, not during the initial unauthenticated render.
 *
 * Checks:
 *   - ShoppingListWidget  → "View full list" link is visible
 *   - HallmarkEventStatTile → countdown tile is visible (fallback event shown
 *     when no Hallmark calendar is connected)
 *   - MessengerNavIcon    → trigger button is visible in the header
 *   - No "Invalid hook call" or TypeError in the browser console
 */
test("hub: ShoppingListWidget, HallmarkEventStatTile, and MessengerNavIcon all render correctly after login", async ({
  page,
}) => {
  const hookErrors: string[] = [];

  page.on("pageerror", (err) => {
    if (/Invalid hook call|TypeError/i.test(err.message)) {
      hookErrors.push(`[pageerror] ${err.message}`);
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (/Invalid hook call|TypeError/i.test(text)) {
        hookErrors.push(`[console.error] ${text}`);
      }
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });

  // 1. ShoppingListWidget — the link always renders even when the list is empty
  await expect(page.getByRole("link", { name: /view full list/i })).toBeVisible(
    { timeout: 15_000 },
  );

  // 2. HallmarkEventStatTile — countdown tile in the Ornaments app card.
  //    When no Hallmark GCal is connected the component falls back to the
  //    hardcoded "Hallmark Open House" event and renders the tile regardless.
  await expect(page.getByTestId("hallmark-event-tile")).toBeVisible({
    timeout: 15_000,
  });

  // 3. MessengerNavIcon — trigger button in the app header (desktop row)
  await expect(page.getByRole("button", { name: /messenger/i })).toBeVisible({
    timeout: 15_000,
  });

  // No React "Invalid hook call" or TypeError during any of the above
  expect(
    hookErrors,
    `Hook / TypeError errors detected:\n${hookErrors.join("\n")}`,
  ).toHaveLength(0);
});

test("hub: dashboard loads and shows app section links", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await expect(page.locator("body")).not.toContainText("404");
  await expect(page.getByText(/pottery|quilting|travels/i).first()).toBeVisible(
    { timeout: 15_000 },
  );
});

// ── Pottery ───────────────────────────────────────────────────────────────────

test("pottery: collection page loads without error", async ({ page }) => {
  await page.goto("/modules/pottery", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/pottery/, { timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await expect(page.locator("body")).not.toContainText("404");
});

// ── Quilting ──────────────────────────────────────────────────────────────────

test("quilting: fabrics page loads without error", async ({ page }) => {
  await page.goto("/modules/quilting", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/quilting/, { timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await expect(page.locator("body")).not.toContainText("404");
});

// ── Travels ───────────────────────────────────────────────────────────────────

test("travels: trips page loads without error", async ({ page }) => {
  await page.goto("/modules/travels", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/travels/, { timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await expect(page.locator("body")).not.toContainText("404");
});

test("travels: CRUD — create trip, verify, delete (auto-cleaned)", async ({
  request,
}) => {
  const title = `SMOKE_${Date.now()}`;
  let tripId: number | undefined;

  try {
    // Create — destination is required by CreateTripBody schema
    const create = await request.post("/api/travels/trips", {
      data: {
        title,
        destination: "Smoke Test Location",
        startDate: "2030-06-01",
        endDate: "2030-06-07",
      },
    });
    expect(
      create.ok(),
      `Create failed ${create.status()}: ${await create.text()}`,
    ).toBeTruthy();
    const body = await create.json();
    tripId = body.id;
    expect(tripId).toBeTruthy();

    // Verify it was stored correctly
    const get = await request.get(`/api/travels/trips/${tripId}`);
    expect(get.ok()).toBeTruthy();
    const trip = await get.json();
    expect(trip.title ?? trip.trip?.title).toContain("SMOKE_");
  } finally {
    // Clean up — always runs, even if assertions fail above
    if (tripId !== undefined) {
      const del = await request.delete(`/api/travels/trips/${tripId}`);
      expect(
        del.ok(),
        `Cleanup delete failed ${del.status()} for trip ${tripId}`,
      ).toBeTruthy();
    }
  }
});

// ── Elaine ────────────────────────────────────────────────────────────────────

test("elaine: chat page loads without error", async ({ page }) => {
  await page.goto("/elaine/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/elaine/, { timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText("Something went wrong");
  await expect(page.locator("body")).not.toContainText("404");
});
