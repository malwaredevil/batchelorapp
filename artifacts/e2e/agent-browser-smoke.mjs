import {
  collectConsoleErrors,
  getAgentBrowserPath,
  launchAgentBrowser,
  openAuthenticatedPage,
  uniqueScreenshotPath,
} from "./agent-browser-helpers.mjs";

const DEFAULT_PATH = "/modules/ornaments";
const SCREENSHOT_PATH = uniqueScreenshotPath("agent-browser-smoke");

async function main() {
  const { browser, page } = await launchAgentBrowser();
  const consoleErrors = collectConsoleErrors(page);

  try {
    const targetPath = getAgentBrowserPath(DEFAULT_PATH);
    const initialCollectionRequest = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/ornaments/items" &&
        response.status() === 200,
      { timeout: 30_000 },
    );
    await openAuthenticatedPage(page, targetPath);
    await initialCollectionRequest;
    const search = page.getByPlaceholder(/Search/);
    await search.waitFor({ state: "visible", timeout: 30_000 });
    await page.getByRole("button", { name: "Add Ornament" }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => !document.body.innerText.includes("Loading ornaments..."),
      undefined,
      {
        timeout: 30_000,
      },
    );
    const filteredCollectionRequest = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/ornaments/items" &&
        response.status() === 200,
      { timeout: 30_000 },
    );
    await search.fill("Star");
    await filteredCollectionRequest;
    await page.waitForFunction(
      () => !document.body.innerText.includes("Loading ornaments..."),
      undefined,
      {
        timeout: 30_000,
      },
    );
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    if (consoleErrors.length > 0) {
      throw new Error(
        `Browser console reported ${consoleErrors.length} error(s): ${consoleErrors.slice(0, 3).join(" | ")}`,
      );
    }

    console.log(
      `✓ Agent browser smoke check passed. Authenticated interaction succeeded; screenshot saved to ${SCREENSHOT_PATH}.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ Agent browser smoke check failed: ${message}`);
  process.exitCode = 1;
});
