#!/usr/bin/env tsx
/**
 * print-agent-screenshot-token.ts — derive the current agent-safe screenshot
 * bypass token from the real DEV_SCREENSHOT_TOKEN secret.
 *
 * WHY: DEV_SCREENSHOT_TOKEN is a real Replit Secret; nothing that can display
 * output back to the agent is allowed to read or print its raw value. The
 * screenshot-login route and requireAuth's screenshot-token check both
 * authenticate against an HMAC-SHA256 derivation of it instead (see
 * artifacts/api-server/src/lib/agent-screenshot-auth.ts) — a one-way,
 * agent-safe value. This script computes that same derivation and prints
 * ONLY the digest, never the secret it was derived from, so it's safe to run
 * and read the output of.
 *
 * Because the derivation is recomputed from the live secret every time,
 * rotating DEV_SCREENSHOT_TOKEN instantly invalidates every previously
 * printed/leaked derived token — run this again after any rotation to get
 * the new one.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run print-agent-screenshot-token
 *
 * Then use the printed value as the `token` query param for
 * /dev/screenshot-login, e.g.:
 *   https://<domain>/api/dev/screenshot-login?token=<printed value>&next=/some/path
 */
import crypto from "node:crypto";

const DERIVATION_CONTEXT = "agent-screenshot-bypass-v1";

function main(): void {
  const pepper = process.env.DEV_SCREENSHOT_TOKEN;
  if (!pepper) {
    console.error(
      "DEV_SCREENSHOT_TOKEN is not set in this environment — nothing to derive.",
    );
    process.exit(1);
  }
  const derived = crypto
    .createHmac("sha256", pepper)
    .update(DERIVATION_CONTEXT)
    .digest("hex");
  console.log(derived);
}

main();
