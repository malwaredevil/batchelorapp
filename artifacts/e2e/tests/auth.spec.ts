import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, json: { error: "Unauthorized" } }),
  );
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ status: 200, json: { google: false } }),
  );
});

test("login page renders with email and password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("input-email")).toBeVisible();
  await expect(page.getByTestId("input-password")).toBeVisible();
  await expect(page.getByTestId("button-login")).toBeVisible();
});

test("password field masks its input", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("input-password")).toHaveAttribute(
    "type",
    "password",
  );
});

test("email field accepts text input", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("input-email").fill("test@example.com");
  await expect(page.getByTestId("input-email")).toHaveValue("test@example.com");
});

test("visiting / while unauthenticated redirects to /login", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("input-email")).toBeVisible();
});

test("login page shows the Batchelor heading", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Batchelor" })).toBeVisible();
});

test("forgot password link is present on the login page", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: /forgot password/i }),
  ).toBeVisible();
});

test("Google sign-in button appears when provider is enabled", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ status: 200, json: { google: true } }),
  );
  await page.goto("/login");
  await expect(page.getByTestId("button-google")).toBeVisible();
  await expect(page.getByTestId("button-google")).toContainText(
    "Continue with Google",
  );
});

test("Google sign-in button is absent when provider is disabled", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByTestId("button-google")).not.toBeVisible();
});
