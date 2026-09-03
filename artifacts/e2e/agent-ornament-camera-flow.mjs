/**
 * Authenticated regression check for the standard Add Ornament camera path.
 *
 * It runs against the active development app with a generated camera stream and
 * intercepts only the final create request, so it never creates a database row
 * or invokes the paid AI analysis. This makes the full client-side flow safe
 * to run repeatedly while still proving the edited camera file reaches the
 * existing creation endpoint and navigation uses the returned ornament id.
 */

import {
  collectConsoleErrors,
  launchAgentBrowser,
  openAuthenticatedPage,
  uniqueScreenshotPath,
} from "./agent-browser-helpers.mjs";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1NwAAAABJRU5ErkJggg==",
  "base64",
);

const { browser, page } = await launchAgentBrowser();
const consoleErrors = collectConsoleErrors(page);
let createRequests = 0;

try {
  await page.addInitScript(() => {
    const getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create test camera frame.");
      context.fillStyle = "#1f2937";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#f59e0b";
      context.fillRect(120, 100, 400, 280);
      return canvas.captureStream(30);
    };

    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = getUserMedia;
    } else {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia },
      });
    }
  });

  await page.route("**/api/ornaments/items", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createRequests += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: 424242, name: "Camera flow test" }),
    });
  });

  await openAuthenticatedPage(page, "/modules/ornaments/add");
  await page.getByText("Add Ornament", { exact: true }).waitFor({
    timeout: 30_000,
  });

  // File uploads retain the existing direct-to-form behavior.
  await page.locator('[data-testid="input-image"]').setInputFiles({
    name: "upload-only-test.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await page.getByAltText("Selected image").waitFor();
  if (
    await page
      .getByText("Edit photo", { exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error("Upload unexpectedly opened the camera image editor.");
  }
  await page.getByTestId("button-clear-image").click();

  await page.getByTestId("button-open-camera").click();
  await page.getByTestId("button-snap").waitFor({ timeout: 15_000 });
  await page.getByTestId("button-snap").click();
  await page.getByText("Edit photo", { exact: true }).waitFor({
    timeout: 15_000,
  });
  await page.getByTestId("button-retake-photo").waitFor();

  // Retake discards the editor state and returns to the viewfinder.
  await page.getByTestId("button-retake-photo").click();
  await page.getByTestId("button-snap").waitFor({ timeout: 15_000 });
  await page.getByTestId("button-snap").click();
  await page.getByText("Edit photo", { exact: true }).waitFor({
    timeout: 15_000,
  });

  const navigation = page.waitForURL(
    "**/modules/ornaments/ornament/424242?edit=1",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Done" }).click();
  await navigation;

  if (createRequests !== 1) {
    throw new Error(
      `Expected one edited-photo creation request, received ${createRequests}.`,
    );
  }
  if (consoleErrors.length) {
    throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);
  }

  const screenshotPath = uniqueScreenshotPath("agent-ornament-camera-flow");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(
    `✓ Ornament camera edit flow passed; screenshot saved to ${screenshotPath}.`,
  );
} finally {
  await browser.close();
}
