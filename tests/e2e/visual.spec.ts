import { expect, test } from "@playwright/test";
import { mockAnonymousAuth } from "./mocks";

test("login page visual baseline is stable", async ({ page }) => {
  await mockAnonymousAuth(page);
  await page.goto("/login");
  await expect(page).toHaveScreenshot("hub-login.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
});
