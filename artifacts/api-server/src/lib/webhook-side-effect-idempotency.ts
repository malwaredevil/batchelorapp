import { db, webhookSideEffects } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

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
      WHERE app_webhook_side_effects.status = 'processing'
        AND app_webhook_side_effects.updated_at < NOW() - INTERVAL '5 minutes'
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
