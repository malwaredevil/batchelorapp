#!/usr/bin/env tsx
/**
 * Verifies the development-only screenshot bypass without printing any secret
 * or derived credential. This is the first diagnostic to run when an
 * authenticated screenshot fails.
 */
import crypto from "node:crypto";

const DERIVATION_CONTEXT = "agent-screenshot-bypass-v1";
const CHECK_TIMEOUT_MS = 15_000;

function deriveToken(pepper: string): string {
  return crypto
    .createHmac("sha256", pepper)
    .update(DERIVATION_CONTEXT)
    .digest("hex");
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const pepper = process.env.DEV_SCREENSHOT_TOKEN;
  const domain = process.env.REPLIT_DEV_DOMAIN;

  if (!pepper) {
    throw new Error(
      "DEV_SCREENSHOT_TOKEN is unavailable to this process. Confirm the development Secret is configured, then restart the API workflow.",
    );
  }
  if (!domain) {
    throw new Error(
      "REPLIT_DEV_DOMAIN is unavailable. Run this check from the Replit development workspace.",
    );
  }

  const token = deriveToken(pepper);
  const origin = `https://${domain}`;

  const [protectedResponse, loginResponse] = await Promise.all([
    fetchWithTimeout(`${origin}/api/hub/preferences`, {
      headers: { "x-screenshot-token": token },
    }),
    fetchWithTimeout(
      `${origin}/api/dev/screenshot-login?token=${encodeURIComponent(token)}&next=/`,
      { redirect: "manual" },
    ),
  ]);

  if (!protectedResponse.ok) {
    throw new Error(
      `The screenshot token was rejected by a protected API route (HTTP ${protectedResponse.status}). Restart the API workflow, then check the development Secret and automation account.`,
    );
  }
  if (
    ![301, 302, 303, 307, 308].includes(loginResponse.status) ||
    !loginResponse.headers.get("location")?.includes("screenshotToken=")
  ) {
    throw new Error(
      `The screenshot-login handoff did not produce an authenticated redirect (HTTP ${loginResponse.status}).`,
    );
  }

  console.log(
    "✓ Screenshot bypass is live: protected API authentication and URL handoff both succeeded.",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(`✗ Screenshot bypass check failed: ${message}`);
  process.exitCode = 1;
});
