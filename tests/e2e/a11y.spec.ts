import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockAnonymousAuth } from "./mocks";

test("login page has no serious or critical axe violations", async ({
  page,
}) => {
  await mockAnonymousAuth(page);
  await page.goto("/login");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious).toEqual([]);
});
