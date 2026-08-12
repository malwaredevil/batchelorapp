/**
 * Elaine scheduled-actions runner.
 *
 * Polls `elaine_scheduled_actions` every 60 seconds for rows with
 * `status = 'pending' AND scheduled_for <= NOW()`. For each due row it
 * atomically claims it into an in-flight `sending` state, dispatches the
 * appropriate communication action (call or message), then marks the row
 * `fired` (confirmed delivered) or `failed` (with the error text).
 *
 * Crash safety (architecture hardening #754): a row is marked `fired` ONLY
 * after the provider call actually returns success. If the process crashes
 * or is killed between the claim and the provider call completing, the row
 * is left in `sending` rather than `fired` — it must never look like a
 * confirmed delivery it wasn't. A separate recovery pass below finds rows
 * stuck in `sending` past a timeout and marks them `failed` with an
 * "unknown outcome" error. It deliberately does NOT retry them
 * automatically: for a call/SMS, the provider call may have actually gone
 * out right before the crash, so silently re-firing could double-deliver a
 * real-world call or message. A human (via chat) has to decide whether to
 * resend.
 *
 * Survives a server restart — rows are in the DB, not in memory.
 */

import { and, eq, lte, lt } from "drizzle-orm";
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

// How long a row may sit in the in-flight "sending" state before the
// recovery pass gives up waiting for it to resolve and marks it "failed".
// Provider calls (fireCallContact/fireMessageContact) normally resolve in
// well under a minute; this only kicks in after a crash left a row stranded.
const STUCK_SENDING_TIMEOUT_MS = 10 * 60_000; // 10 minutes

/**
 * Recovers rows left stuck in the in-flight "sending" state by a crash
 * (server killed/restarted between the claim and the provider call
 * completing). Marks them "failed" with an explanatory error — never
 * resurrects them as "fired", and never auto-retries them, since the
 * underlying call/message may have actually been delivered right before
 * the crash.
 */
async function recoverStuckSendingActions(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_SENDING_TIMEOUT_MS);

  const stuck = await db
    .update(elaineScheduledActions)
    .set({
      status: "failed",
      error:
        "Delivery outcome unknown: the server restarted or crashed while this action was in flight, so we can't confirm whether it actually went out. Please check and resend manually if needed.",
    })
    .where(
      and(
        eq(elaineScheduledActions.status, "sending"),
        lt(elaineScheduledActions.firedAt, cutoff),
      ),
    )
    .returning({
      id: elaineScheduledActions.id,
      actionType: elaineScheduledActions.actionType,
      initiatedByUserId: elaineScheduledActions.initiatedByUserId,
      actionPayload: elaineScheduledActions.actionPayload,
    });

  if (stuck.length === 0) return;

  logger.error(
    { count: stuck.length, ids: stuck.map((r) => r.id) },
    "elaine-scheduler: recovered scheduled actions stuck in 'sending' after an apparent crash — marked failed, not retried",
  );

  for (const row of stuck) {
    const contactName =
      (row.actionPayload as { contactName?: string } | null)?.contactName ?? "";
    if (!contactName) continue;
    const msg =
      row.actionType === "call_contact"
        ? `I'm not sure whether my scheduled call to ${contactName} actually went through — the server restarted while it was in progress. Please check and try again if needed.`
        : `I'm not sure whether my scheduled message to ${contactName} actually went through — the server restarted while it was in progress. Please check and try again if needed.`;
    await appendScheduledActionChatMessage(row.initiatedByUserId, msg).catch(
      (chatErr) =>
        logger.warn(
          { scheduledActionId: row.id, chatErr },
          "elaine-scheduler: could not append crash-recovery chat message",
        ),
    );
  }
}

async function runDueScheduledActions(): Promise<void> {
  // Recover any rows a prior crash left stranded in "sending" before
  // claiming new work, so a stuck row can never masquerade as delivered.
  await recoverStuckSendingActions().catch((err) =>
    logger.error(
      { err },
      "elaine-scheduler: stuck-sending recovery pass failed",
    ),
  );

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
      // Atomically claim the row into the in-flight "sending" state only if
      // it is still "pending". We use UPDATE...RETURNING rather than a
      // separate SELECT so that two concurrent scheduler instances (e.g.
      // after an autoscale restart) cannot both pass the status check and
      // both fire the same action — only the process whose UPDATE touches 1
      // row proceeds. `firedAt` is stamped here (claim time) so the stale-
      // "sending" recovery pass can tell how long a row has been in flight;
      // it is NOT re-stamped on actual success, so it always reflects when
      // delivery was attempted, whichever status the row ends up in.
      const [claimed] = await db
        .update(elaineScheduledActions)
        .set({ status: "sending", firedAt: new Date() })
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

        // Only now — after the provider call has actually returned success —
        // is the row marked "fired". This is the crash-safety boundary: if
        // the process dies before this line runs, the row stays "sending"
        // and the recovery pass above will correct it to "failed" rather
        // than letting a not-actually-confirmed row look like a delivery.
        await db
          .update(elaineScheduledActions)
          .set({ status: "fired" })
          .where(eq(elaineScheduledActions.id, row.id));

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
    channel: "web",
  });

  await db
    .update(elaineHistoryConversations)
    .set({ updatedAt: new Date() })
    .where(eq(elaineHistoryConversations.id, convId));
}
