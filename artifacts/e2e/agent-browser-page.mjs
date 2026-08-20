import {
  collectConsoleErrors,
  getAgentBrowserPath,
  launchAgentBrowser,
  openAuthenticatedPage,
  uniqueScreenshotPath,
} from "./agent-browser-helpers.mjs";

const targetPath = getAgentBrowserPath("/");
const screenshotPath = uniqueScreenshotPath("agent-browser-page");
const { browser, page } = await launchAgentBrowser();
const consoleErrors = collectConsoleErrors(page);

try {
  await openAuthenticatedPage(page, targetPath);
  await page.waitForFunction(
    () => document.body.innerText.trim().length > 0,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1_000);

  const bodyText = await page.locator("body").innerText();
  if (
    bodyText.includes("Page not found") ||
    bodyText.includes("Sign in to continue")
  ) {
    throw new Error(
      `The authenticated page appears to be unavailable or unauthenticated: ${targetPath}`,
    );
  }
  if (consoleErrors.length > 0) {
    throw new Error(
      `Browser console reported ${consoleErrors.length} error(s): ${consoleErrors.slice(0, 3).join(" | ")}`,
    );
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(
    `✓ Authenticated page check passed for ${targetPath}; screenshot saved to ${screenshotPath}.`,
  );
} finally {
  await browser.close();
}
