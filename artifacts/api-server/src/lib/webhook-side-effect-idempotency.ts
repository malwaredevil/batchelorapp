import { db, webhookSideEffects } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  shouldRunScheduledTask,
  recordScheduledTaskSuccess,
  recordScheduledTaskFailure,
} from "./scheduler-guard";

// How long a completed/failed/stuck ledger row is kept before cleanup removes
// it. AgentPhone/Resend webhook redelivery windows are minutes to hours, not
// weeks, so 30 days is generous headroom while still preventing this table
// from accumulating forever.
const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day

export interface WebhookSideEffectClaimInput {
  effectKey: string;
  provider: "agentphone" | "resend";
  channel: "sms" | "email";
}

export async function claimWebhookSideEffect(
  input: WebhookSideEffectClaimInput,
): Promise<boolean> {
  const result = await db.execute<{ effect_key: string }>(sql`
    INSERT INTO app_webhook_side_effects (effect_key, provider, channel, status)
    VALUES (${input.effectKey}, ${input.provider}, ${input.channel}, 'processing')
    ON CONFLICT (effect_key) DO UPDATE
      SET status = 'processing',
          updated_at = NOW(),
          last_error = NULL
      WHERE app_webhook_side_effects.status = 'failed'
        OR (app_webhook_side_effects.status = 'processing'
            AND app_webhook_side_effects.updated_at < NOW() - INTERVAL '5 minutes')
    RETURNING effect_key
  `);
  return result.rows.length > 0;
}

export async function markWebhookSideEffectCompleted(
  effectKey: string,
): Promise<void> {
  await db
    .update(webhookSideEffects)
    .set({
      status: "completed",
      updatedAt: new Date(),
      completedAt: new Date(),
      lastError: null,
    })
    .where(eq(webhookSideEffects.effectKey, effectKey));
}

export async function markWebhookSideEffectFailed(
  effectKey: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await db
      .update(webhookSideEffects)
      .set({
        status: "failed",
        updatedAt: new Date(),
        lastError: message.slice(0, 2000),
      })
      .where(eq(webhookSideEffects.effectKey, effectKey));
  } catch (persistError) {
    logger.warn(
      { persistError, effectKey },
      "webhook-side-effect-idempotency: failed to persist send failure",
    );
  }
}

/**
 * Deletes ledger rows (any status) last updated more than RETENTION_DAYS ago.
 * Without this, app_webhook_side_effects grows forever — one row per unique
 * SMS/email send attempt — since nothing else ever removes rows from it.
 * Returns the number of rows deleted.
 */
export async function cleanupOldWebhookSideEffects(): Promise<number> {
  const result = await db.execute<{ effect_key: string }>(sql`
    DELETE FROM app_webhook_side_effects
    WHERE updated_at < NOW() - INTERVAL '${sql.raw(String(RETENTION_DAYS))} days'
    RETURNING effect_key
  `);
  return result.rows.length;
}

/**
 * Starts the daily in-process cleanup for the webhook side-effect ledger.
 * Guarded by scheduler-guard so a restart-heavy dev session doesn't run this
 * more than once per CLEANUP_INTERVAL_MS, matching every other in-process
 * scheduler in this codebase.
 */
export function startWebhookSideEffectCleanupScheduler(): () => void {
  const run = async (): Promise<void> => {
    if (
      !(await shouldRunScheduledTask(
        "webhook-side-effect-cleanup",
        CLEANUP_INTERVAL_MS,
      ))
    ) {
      logger.info(
        "webhook-side-effect-idempotency: cleanup skipped (ran within the last 24h)",
      );
      return;
    }
    try {
      const deleted = await cleanupOldWebhookSideEffects();
      // Architecture hardening (#754): this call was previously missing, so
      // last_success_at for this task stayed NULL forever — the heartbeat's
      // crash-recovery check (which requires a non-null last_success_at)
      // could never apply to this task, silently hiding a real failure.
      await recordScheduledTaskSuccess("webhook-side-effect-cleanup");
      logger.info(
        { deleted },
        "webhook-side-effect-idempotency: cleanup run complete",
      );
    } catch (err) {
      logger.error({ err }, "webhook-side-effect-idempotency: cleanup failed");
      recordScheduledTaskFailure("webhook-side-effect-cleanup");
    }
  };

  void run();
  const interval = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
  interval.unref();
  logger.info(
    "webhook-side-effect-idempotency: cleanup scheduler started (runs daily, retains 30 days)",
  );
  return () => clearInterval(interval);
}
