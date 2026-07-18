import { expect, test } from "@playwright/test";
import { mockAnonymousAuth } from "./mocks";

test("anonymous users land on login instead of authenticated pages", async ({
  page,
}) => {
  await mockAnonymousAuth(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("login failure keeps a generic failure state", async ({ page }) => {
  await mockAnonymousAuth(page);
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Invalid email or password" }),
    });
  });
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("not-a-user@example.test");
  await page.getByLabel(/password/i).fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("body")).not.toContainText(
    "Invalid email or password",
  );
});

test("production screenshot bypass is not exposed by the web client", async ({
  page,
}) => {
  await mockAnonymousAuth(page);
  await page.goto("/login");
  await expect(page.locator("body")).not.toContainText("screenshotToken");
});
