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
import {
  db,
  elaineScheduledActions,
  elaineHistoryConversations,
  elaineHistoryMessages,
} from "@workspace/db";
import {
  fireCallContact,
  fireMessageContact,
} from "../elaine/communication-actions";
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
      // Atomically claim the row by updating it to "fired" only if it is still
      // "pending".  We use UPDATE...RETURNING rather than a separate SELECT so
      // that two concurrent scheduler instances (e.g. after an autoscale
      // restart) cannot both pass the status check and both fire the same
      // action — only the process whose UPDATE touches 1 row proceeds.
      const [claimed] = await db
        .update(elaineScheduledActions)
        .set({ status: "fired", firedAt: new Date() })
        .where(
          and(
            eq(elaineScheduledActions.id, row.id),
            eq(elaineScheduledActions.status, "pending"),
          ),
        )
        .returning({ id: elaineScheduledActions.id });

      // Another poller already claimed this row — skip without firing.
      if (!claimed) return;

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

          // Notify the user in chat (best-effort — never block the scheduler).
          if (contactName) {
            const failMsg =
              row.actionType === "call_contact"
                ? `I tried to call ${contactName} as scheduled, but the call didn't connect — you may want to try again.`
                : `I tried to send your message to ${contactName} as scheduled, but it didn't go through — you may want to try again.`;
            await appendScheduledActionChatMessage(
              row.initiatedByUserId,
              failMsg,
            ).catch((chatErr) =>
              logger.warn(
                { scheduledActionId: row.id, chatErr },
                "elaine-scheduler: could not append failure chat message",
              ),
            );
          }
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

        // Notify the user in chat that the action was delivered (best-effort).
        if (contactName) {
          const successMsg =
            row.actionType === "call_contact"
              ? `I just called ${contactName} as scheduled.`
              : `I just sent your message to ${contactName} as scheduled.`;
          await appendScheduledActionChatMessage(
            row.initiatedByUserId,
            successMsg,
          ).catch((chatErr) =>
            logger.warn(
              { scheduledActionId: row.id, chatErr },
              "elaine-scheduler: could not append success chat message",
            ),
          );
        }
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

        // Notify the user in chat that the action failed (best-effort).
        const contactNameForErr =
          (
            row.actionPayload as {
              contactName?: string;
            } | null
          )?.contactName ?? "";
        if (contactNameForErr) {
          const failMsg =
            row.actionType === "call_contact"
              ? `I tried to call ${contactNameForErr} as scheduled, but something went wrong — you may want to try again.`
              : `I tried to send your message to ${contactNameForErr} as scheduled, but something went wrong — you may want to try again.`;
          await appendScheduledActionChatMessage(
            row.initiatedByUserId,
            failMsg,
          ).catch((chatErr) =>
            logger.warn(
              { scheduledActionId: row.id, chatErr },
              "elaine-scheduler: could not append error chat message",
            ),
          );
        }
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

/**
 * Appends a brief assistant message to the user's widget-default Elaine
 * conversation so the user can see in chat when a scheduled action was
 * delivered (or failed).  Mirrors the insert pattern used by the turn runtime
 * in elaine/index.ts.
 *
 * If the user has never used the widget we create the shared household thread
 * here, exactly as the turn runtime would — so the first visible message is
 * the delivery confirmation rather than nothing.
 */
async function appendScheduledActionChatMessage(
  userId: number,
  content: string,
): Promise<void> {
  // Resolve (or lazily create) the isWidgetDefault=true conversation.
  let convId: number | null = null;

  const [existing] = await db
    .select({ id: elaineHistoryConversations.id })
    .from(elaineHistoryConversations)
    .where(
      and(
        eq(elaineHistoryConversations.userId, userId),
        eq(elaineHistoryConversations.isWidgetDefault, true),
      ),
    )
    .limit(1);

  if (existing) {
    convId = existing.id;
  } else {
    const [newConv] = await db
      .insert(elaineHistoryConversations)
      .values({ userId, title: "Household", isWidgetDefault: true })
      .returning({ id: elaineHistoryConversations.id });
    convId = newConv?.id ?? null;
  }

  if (convId === null) return;

  await db.insert(elaineHistoryMessages).values({
    conversationId: convId,
    userId,
    role: "assistant",
    content,
    attachmentUrls: [],
  });

  await db
    .update(elaineHistoryConversations)
    .set({ updatedAt: new Date() })
    .where(eq(elaineHistoryConversations.id, convId));
}
