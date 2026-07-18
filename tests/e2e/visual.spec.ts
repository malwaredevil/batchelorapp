import { expect, test } from "@playwright/test";

test("login page visual baseline is stable", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveScreenshot("hub-login.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
});
