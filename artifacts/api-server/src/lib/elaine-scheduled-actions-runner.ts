/**
 * Elaine scheduled-actions runner.
 *
 * Polls `elaine_scheduled_actions` every 60 seconds for rows with
 * `status = 'pending' AND scheduled_for <= NOW()`. For each due row it
 * dispatches the appropriate communication action (call or message),
 * then marks the row `fired` (success) or `failed` (with the error text).
 *
 * Survives a server restart — rows are in the DB, not in memory.
 */

import { and, eq, lte } from "drizzle-orm";
import { db, elaineScheduledActions } from "@workspace/db";
import { fireCallContact, fireMessageContact } from "../elaine/communication-actions";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000; // one minute

async function runDueScheduledActions(): Promise<void> {
  const now = new Date();

  // Claim all due pending rows in one query.
  const due = await db
    .select()
    .from(elaineScheduledActions)
    .where(
      and(
        eq(elaineScheduledActions.status, "pending"),
        lte(elaineScheduledActions.scheduledFor, now),
      ),
    );

  if (due.length === 0) return;

  logger.info(
    { count: due.length },
    "elaine-scheduler: processing due scheduled actions",
  );

  await Promise.allSettled(
    due.map(async (row) => {
      // Optimistically mark as fired before executing so that a crash or
      // restart never re-fires the same row (prefer under-delivery to double
      // delivery for phone calls). If the actual send fails we update to
      // 'failed' with the error text immediately after.
      await db
        .update(elaineScheduledActions)
        .set({ status: "fired", firedAt: new Date() })
        .where(
          and(
            eq(elaineScheduledActions.id, row.id),
            // Only update if still pending — guards against a race with a
            // concurrent scheduler instance on a second process/restart.
            eq(elaineScheduledActions.status, "pending"),
          ),
        );

      try {
        const payload = row.actionPayload as {
          contactName?: string;
          message?: string;
          channel?: "auto" | "sms" | "slack";
        } | null;

        const contactName = payload?.contactName ?? "";
        const message = payload?.message ?? "";

        let result: { status: number; body: unknown };
        if (row.actionType === "call_contact") {
          result = await fireCallContact(contactName, message);
        } else if (row.actionType === "message_contact") {
          result = await fireMessageContact(
            contactName,
            message,
            payload?.channel ?? "auto",
          );
        } else {
          throw new Error(`Unknown scheduled action type: ${row.actionType}`);
        }

        if (result.status >= 400) {
          const errorText =
            typeof result.body === "object" &&
            result.body !== null &&
            "error" in result.body
              ? String((result.body as { error: unknown }).error)
              : `HTTP ${result.status}`;
          logger.error(
            {
              scheduledActionId: row.id,
              actionType: row.actionType,
              status: result.status,
              error: errorText,
            },
            "elaine-scheduler: scheduled action returned an error status",
          );
          await db
            .update(elaineScheduledActions)
            .set({ status: "failed", error: errorText })
            .where(eq(elaineScheduledActions.id, row.id));
          return;
        }

        logger.info(
          {
            scheduledActionId: row.id,
            actionType: row.actionType,
            contactName,
          },
          "elaine-scheduler: scheduled action fired successfully",
        );
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        logger.error(
          { scheduledActionId: row.id, actionType: row.actionType, err },
          "elaine-scheduler: scheduled action threw unexpectedly",
        );
        await db
          .update(elaineScheduledActions)
          .set({ status: "failed", error: errorText })
          .where(eq(elaineScheduledActions.id, row.id));
      }
    }),
  );
}

/**
 * Starts the scheduled-actions polling loop. Returns a stop function that
 * clears the interval on graceful shutdown. Safe to call multiple times —
 * each call returns an independent stop handle.
 */
export function startScheduledActionsRunner(): () => void {
  // Run once immediately at startup to catch any rows that were due during
  // a server restart without waiting the full poll interval.
  void runDueScheduledActions().catch((err) =>
    logger.error({ err }, "elaine-scheduler: initial poll failed"),
  );

  const interval = setInterval(() => {
    void runDueScheduledActions().catch((err) =>
      logger.error({ err }, "elaine-scheduler: poll failed"),
    );
  }, POLL_INTERVAL_MS);
  interval.unref();

  return () => clearInterval(interval);
}
