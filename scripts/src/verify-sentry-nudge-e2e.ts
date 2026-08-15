/**
 * End-to-end verification: Sentry error nudge → Elaine chat widget.
 *
 * Steps:
 *   1. Find the owner's user_id.
 *   2. Insert a synthetic test nudge row (source_app='admin',
 *      nudge_key prefix 'sentry_errors:').
 *   3. GET /api/elaine/conversation (authenticated via X-Screenshot-Token)
 *      — this is the endpoint that calls applyUnseenNudges() server-side.
 *   4. Verify the test nudge message appears in the returned messages.
 *   5. Verify the nudge row now has seenAt set (marked consumed).
 *   6. Clean up: delete the test history messages and the nudge row.
 *
 * Run via:
 *   pnpm --filter @workspace/scripts tsx src/verify-sentry-nudge-e2e.ts
 */
import crypto from "node:crypto";
import pg from "pg";
import { resolveProductionDatabaseUrl, sslConfig } from "@workspace/db";

const { Pool } = pg;

const SCREENSHOT_PEPPER = process.env.DEV_SCREENSHOT_TOKEN?.trim();
const DEV_DOMAIN = process.env.REPLIT_DEV_DOMAIN?.trim();

if (!SCREENSHOT_PEPPER) {
  console.error("❌  DEV_SCREENSHOT_TOKEN is not set");
  process.exit(1);
}
if (!DEV_DOMAIN) {
  console.error("❌  REPLIT_DEV_DOMAIN is not set");
  process.exit(1);
}

// Derive the token the same way artifacts/api-server/src/lib/agent-screenshot-auth.ts does.
const SCREENSHOT_TOKEN = crypto
  .createHmac("sha256", SCREENSHOT_PEPPER)
  .update("agent-screenshot-bypass-v1")
  .digest("hex");

const TEST_NUDGE_KEY = "sentry_errors:2026-01-01:e2e-test-synthetic-issue:g1";
const TEST_MESSAGE =
  '🚨 [E2E TEST] New production error in Sentry: "SyntheticTestError" — occurred 42 times. First seen 2026-01-01, last seen 2026-01-01. View it in the Owner Panel or on sentry.io.';

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: resolveProductionDatabaseUrl(),
    ssl: sslConfig,
    max: 3,
  });
  pool.on("error", (err) =>
    console.error("[verify-nudge-e2e] idle pool error:", err),
  );

  const client = await pool.connect();
  let nudgeId: number | null = null;
  let historyMessageIds: number[] = [];
  let exitCode = 0;

  try {
    // ── Step 1: resolve owner ─────────────────────────────────────────────────
    const ownerResult = await client.query<{ id: number }>(
      `SELECT id FROM app_users WHERE is_owner = true LIMIT 1`,
    );
    if (ownerResult.rows.length === 0) {
      throw new Error("No owner account found in app_users");
    }
    const ownerId = ownerResult.rows[0]!.id;
    console.log(`✅  Owner user_id = ${ownerId}`);

    // ── Step 2: clean up any leftover test row from a prior run ───────────────
    await client.query(
      `DELETE FROM elaine_nudges WHERE user_id = $1 AND nudge_key = $2`,
      [ownerId, TEST_NUDGE_KEY],
    );

    // ── Step 3: insert test nudge ─────────────────────────────────────────────
    const insertResult = await client.query<{ id: number }>(
      `INSERT INTO elaine_nudges (user_id, source_app, nudge_key, message)
       VALUES ($1, 'admin', $2, $3)
       RETURNING id`,
      [ownerId, TEST_NUDGE_KEY, TEST_MESSAGE],
    );
    nudgeId = insertResult.rows[0]!.id;
    console.log(`✅  Inserted test nudge row id=${nudgeId}`);

    // ── Step 4: GET /api/elaine/conversation (triggers applyUnseenNudges) ─────
    const convUrl = `https://${DEV_DOMAIN}/api/elaine/conversation`;
    console.log(`→   GET ${convUrl}`);
    const resp = await fetch(convUrl, {
      headers: { "x-screenshot-token": SCREENSHOT_TOKEN },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Conversation endpoint returned ${resp.status}: ${body.slice(0, 300)}`,
      );
    }

    const conv = (await resp.json()) as {
      messages?: Array<{ role: string; content: string; id?: number }>;
    };
    const messages = conv.messages ?? [];
    console.log(
      `✅  Conversation endpoint returned ${messages.length} message(s)`,
    );

    // ── Step 5: verify the nudge message appears ──────────────────────────────
    const nudgeMsg = messages.find(
      (m) => m.role === "assistant" && m.content === TEST_MESSAGE,
    );
    if (!nudgeMsg) {
      console.error(
        "❌  Test nudge message NOT found in conversation response.",
      );
      console.error(
        "    Last 3 assistant messages:",
        messages
          .filter((m) => m.role === "assistant")
          .slice(-3)
          .map((m) => m.content.slice(0, 80)),
      );
      throw new Error("Test nudge message not found in conversation response");
    }
    console.log(`✅  Nudge message appears in conversation response`);
    if (nudgeMsg.id) historyMessageIds.push(nudgeMsg.id);

    // ── Step 6: verify nudge row is marked seen ───────────────────────────────
    const seenResult = await client.query<{ seen_at: string | null }>(
      `SELECT seen_at FROM elaine_nudges WHERE id = $1`,
      [nudgeId],
    );
    const seenAt = seenResult.rows[0]?.seen_at ?? null;
    if (!seenAt) {
      throw new Error(
        "Nudge row seen_at is still NULL — applyUnseenNudges did not mark it seen.",
      );
    }
    console.log(`✅  Nudge row marked seen at ${seenAt}`);

    // ── Step 7: locate the history message(s) by content if id not in payload ─
    if (historyMessageIds.length === 0) {
      const histResult = await client.query<{ id: number }>(
        `SELECT id FROM elaine_history_messages
         WHERE user_id = $1 AND content = $2
         ORDER BY created_at DESC LIMIT 5`,
        [ownerId, TEST_MESSAGE],
      );
      historyMessageIds = histResult.rows.map((r) => r.id);
    }
    console.log(
      `   History message id(s): ${historyMessageIds.join(", ") || "(looked up separately)"}`,
    );

    console.log("\n🎉  End-to-end round-trip PASSED:");
    console.log(
      "    elaine_nudges row → applyUnseenNudges() → elaine_history_messages → conversation response → seenAt set",
    );
  } catch (err) {
    console.error("❌ ", (err as Error).message);
    exitCode = 1;
  } finally {
    // ── Step 8: clean up test data (always runs, even on failure) ────────────
    console.log("\n🧹  Cleaning up test data...");
    try {
      if (historyMessageIds.length > 0) {
        await client.query(
          `DELETE FROM elaine_history_messages WHERE id = ANY($1)`,
          [historyMessageIds],
        );
        console.log(
          `    Deleted ${historyMessageIds.length} test history message(s)`,
        );
      }
      if (nudgeId !== null) {
        await client.query(`DELETE FROM elaine_nudges WHERE id = $1`, [
          nudgeId,
        ]);
        console.log(`    Deleted test nudge row id=${nudgeId}`);
      }
    } catch (cleanupErr) {
      console.warn("    Cleanup warning:", cleanupErr);
    }
    client.release();
    await pool.end();
  }

  if (exitCode !== 0) process.exit(exitCode);
}

main().catch((err) => {
  console.error("❌  Unexpected error:", err);
  process.exit(1);
});
