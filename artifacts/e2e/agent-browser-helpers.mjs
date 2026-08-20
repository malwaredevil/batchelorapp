import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

function deriveAgentScreenshotToken() {
  let output;
  try {
    output = execFileSync(
      "pnpm",
      [
        "--filter",
        "@workspace/scripts",
        "run",
        "print-agent-screenshot-token",
        "--silent",
      ],
      { encoding: "utf8" },
    );
  } catch {
    throw new Error(
      "Could not derive the screenshot token. Run the live screenshot-access check and verify the development Secret is configured.",
    );
  }

  const token = output.trim().split(/\r?\n/).at(-1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error(
      "The screenshot-token helper returned an invalid value; no browser session was opened.",
    );
  }
  return token;
}

function getChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "Chromium is unavailable. Install the workspace system dependency named chromium before running browser validation.",
    );
  }
}

export function getAgentBrowserPath(defaultPath = "/") {
  const targetPath = process.env.AGENT_BROWSER_PATH ?? defaultPath;
  if (!targetPath.startsWith("/") || targetPath.startsWith("//")) {
    throw new Error("AGENT_BROWSER_PATH must be an app-relative path.");
  }
  return targetPath;
}

export function uniqueScreenshotPath(prefix = "agent-browser") {
  return (
    process.env.AGENT_BROWSER_SCREENSHOT ?? `/tmp/${prefix}-${Date.now()}.png`
  );
}

export function collectConsoleErrors(page) {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return consoleErrors;
}

export async function launchAgentBrowser() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: getChromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  return { browser, context, page };
}

export async function openAuthenticatedPage(page, targetPath) {
  const target = new URL(`http://localhost${targetPath}`);
  target.searchParams.set("screenshotToken", deriveAgentScreenshotToken());
  await page.goto(target.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
}
