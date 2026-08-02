import { z } from "zod/v4";
import type OpenAI from "openai";
import { and, eq, ilike, lte } from "drizzle-orm";
import { db, appUsers, elaineScheduledActions } from "@workspace/db";
import {
  sendSms,
  SmsOptedOutError,
  SmsRegistrationPendingError,
} from "../lib/sms";
import { initiateOutboundCall } from "../lib/calls";
import { openDmChannel, postSlackMessage, slackConfigured } from "../lib/slack";
import { sendAssistantEmail, resendConfigured } from "../lib/email";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Optional scheduleAt in ISO 8601 — when present the action is deferred to
// that time rather than fired immediately. The scheduler worker polls every
// minute for due rows and dispatches them.
const scheduleAtField = z
  .string()
  .datetime({ offset: true })
  .optional()
  .describe(
    "ISO 8601 datetime to fire this action at. Omit to execute immediately.",
  );

const CallContactPayload = z.object({
  contactName: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  scheduleAt: scheduleAtField,
});

const MessageContactPayload = z.object({
  contactName: z.string().min(1).max(100),
  message: z.string().min(1).max(1600),
  channel: z.enum(["auto", "sms", "slack"]).default("auto"),
  scheduleAt: scheduleAtField,
});

const CancelScheduledContactPayload = z.object({
  scheduledActionId: z.number().int().positive(),
});

// continue_in_channel: send a message to the requesting user's OWN account on
// another channel. This is purely self-directed (user → themselves), not a
// household-member contact, so it is safe to execute from any channel.
// It should NOT be added to RESTRICTED_EXCLUDED_ACTION_TYPES.
const ContinueInChannelPayload = z.object({
  targetChannel: z.enum(["slack", "sms", "email"]).describe(
    "Channel to deliver the continuation message on. Choose whichever the user asked for.",
  ),
  message: z.string().min(1).max(2000).describe(
    "The text to deliver to the user on the target channel.",
  ),
});

// broadcast_message: fan out a message to ALL of the requesting user's own
// connected channels simultaneously (Slack DM, SMS, email — whichever are
// configured and opted in). Web-only to avoid delivery loops (an SMS-triggered
// broadcast would re-deliver to the SMS channel it came from).
const BroadcastMessagePayload = z.object({
  message: z
    .string()
    .min(1)
    .max(500)
    .describe("The text to broadcast to all your connected channels."),
});

// Per-user broadcast rate limit: max 3 per hour (in-process rolling window).
// Single-process Node.js server — in-memory is fine; restarts reset the
// counter, which is acceptable for an abuse-prevention guard.
const _broadcastTimestamps = new Map<number, number[]>();
const BROADCAST_HOURLY_LIMIT = 3;
const BROADCAST_WINDOW_MS = 60 * 60 * 1000;

function checkBroadcastRateLimit(userId: number): {
  allowed: boolean;
  resetInMinutes: number;
} {
  const now = Date.now();
  const cutoff = now - BROADCAST_WINDOW_MS;
  const prev = (_broadcastTimestamps.get(userId) ?? []).filter(
    (ts) => ts > cutoff,
  );
  if (prev.length >= BROADCAST_HOURLY_LIMIT) {
    const oldest = prev[0] ?? now;
    const resetInMs = oldest + BROADCAST_WINDOW_MS - now;
    return { allowed: false, resetInMinutes: Math.ceil(resetInMs / 60_000) };
  }
  prev.push(now);
  _broadcastTimestamps.set(userId, prev);
  return { allowed: true, resetInMinutes: 0 };
}

// call_me: initiate an outbound voice call to the requesting user's OWN
// verified phone number. Self-directed — always resolves from userId, never
// from a contact name. Available on web + SMS (excluded from email).
const CallMePayload = z.object({
  greeting: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Opening words Elaine says when the call connects. Omit for the default warm greeting.",
    ),
});

export const communicationActionSchemas = [
  z.object({
    type: z.literal("call_contact"),
    payload: CallContactPayload,
  }),
  z.object({
    type: z.literal("message_contact"),
    payload: MessageContactPayload,
  }),
  z.object({
    type: z.literal("cancel_scheduled_contact"),
    payload: CancelScheduledContactPayload,
  }),
  z.object({
    type: z.literal("continue_in_channel"),
    payload: ContinueInChannelPayload,
  }),
  z.object({
    type: z.literal("call_me"),
    payload: CallMePayload,
  }),
  z.object({
    type: z.literal("broadcast_message"),
    payload: BroadcastMessagePayload,
  }),
] as const;

export const COMMUNICATION_ACTION_TYPES = [
  "call_contact",
  "message_contact",
  "cancel_scheduled_contact",
  "continue_in_channel",
  "call_me",
  "broadcast_message",
] as const;

export type CommunicationActionType =
  (typeof COMMUNICATION_ACTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Contact resolver — case-insensitive search against app_users.displayName.
// Prefers exact match, then starts-with, then any partial match.
// ---------------------------------------------------------------------------

interface ResolvedContact {
  id: number;
  displayName: string | null;
  phoneNumber: string | null;
  slackUserId: string | null;
  phoneVerified: boolean;
  smsConsentAt: Date | null;
  smsOptedOutAt: Date | null;
}

async function resolveContact(name: string): Promise<ResolvedContact | null> {
  const trimmed = name.trim();
  const rows = await db
    .select({
      id: appUsers.id,
      displayName: appUsers.displayName,
      phoneNumber: appUsers.phoneNumber,
      slackUserId: appUsers.slackUserId,
      phoneVerified: appUsers.phoneVerified,
      smsConsentAt: appUsers.smsConsentAt,
      smsOptedOutAt: appUsers.smsOptedOutAt,
    })
    .from(appUsers)
    .where(ilike(appUsers.displayName, `%${trimmed}%`))
    .limit(10);

  if (rows.length === 0) return null;

  const lower = trimmed.toLowerCase();
  return (
    rows.find((r) => r.displayName?.toLowerCase() === lower) ??
    rows.find((r) => r.displayName?.toLowerCase().startsWith(lower)) ??
    rows[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Shared helpers — called by both the immediate executor path and the
// scheduler worker so the two paths never diverge.
// ---------------------------------------------------------------------------

export async function fireCallContact(
  contactName: string,
  message: string,
): Promise<{ status: number; body: unknown }> {
  const contact = await resolveContact(contactName);
  if (!contact) {
    return {
      status: 404,
      body: {
        error: `No household member named "${contactName}" found. Check the name and try again.`,
      },
    };
  }
  if (!contact.phoneNumber) {
    return {
      status: 422,
      body: {
        error: `${contact.displayName ?? contactName} doesn't have a phone number on file. They can add one on their profile page.`,
      },
    };
  }
  if (!contact.phoneVerified) {
    return {
      status: 422,
      body: {
        error: `${contact.displayName ?? contactName}'s phone number hasn't been verified yet. They need to verify it before calls can be placed.`,
      },
    };
  }
  try {
    const { callId } = await initiateOutboundCall({
      toNumber: contact.phoneNumber,
      initialGreeting: message,
      callScreeningPurpose: "household message",
    });
    logger.info(
      { callId, toNumber: contact.phoneNumber },
      "elaine: initiated outbound call",
    );
    return {
      status: 200,
      body: {
        type: "call_contact",
        result: {
          callId,
          contactName: contact.displayName ?? contactName,
        },
      },
    };
  } catch (err) {
    logger.error({ err }, "elaine: failed to initiate outbound call");
    return {
      status: 500,
      body: { error: "Failed to place the call. Please try again." },
    };
  }
}

export async function fireMessageContact(
  contactName: string,
  message: string,
  channel: "auto" | "sms" | "slack",
): Promise<{ status: number; body: unknown }> {
  const contact = await resolveContact(contactName);
  if (!contact) {
    return {
      status: 404,
      body: {
        error: `No household member named "${contactName}" found.`,
      },
    };
  }

  // Prefer Slack (free, instant) when available and not forced to SMS.
  const trySlack =
    channel !== "sms" && !!contact.slackUserId && slackConfigured();

  if (trySlack && contact.slackUserId) {
    try {
      const channelId = await openDmChannel(contact.slackUserId);
      await postSlackMessage(channelId, message);
      return {
        status: 200,
        body: {
          type: "message_contact",
          result: {
            channel: "slack",
            contactName: contact.displayName ?? contactName,
          },
        },
      };
    } catch (err) {
      logger.warn({ err }, "elaine: slack DM failed, falling back to SMS");
      // fall through to SMS
    }
  }

  if (!contact.phoneNumber) {
    return {
      status: 422,
      body: {
        error: `${contact.displayName ?? contactName} has no phone number or Slack account linked. They can add these on their profile page.`,
      },
    };
  }
  if (!contact.phoneVerified) {
    return {
      status: 422,
      body: {
        error: `${contact.displayName ?? contactName}'s phone number hasn't been verified yet. They need to verify it before SMS can be sent.`,
      },
    };
  }
  if (!contact.smsConsentAt) {
    return {
      status: 422,
      body: {
        error: `${contact.displayName ?? contactName} hasn't given SMS consent. They can enable SMS notifications on their profile page.`,
      },
    };
  }
  if (contact.smsOptedOutAt) {
    return {
      status: 409,
      body: {
        error: `${contact.displayName ?? contactName} has opted out of SMS. They can re-subscribe by texting START to the Batchelor App number.`,
      },
    };
  }

  try {
    await sendSms(contact.phoneNumber, message);
    return {
      status: 200,
      body: {
        type: "message_contact",
        result: {
          channel: "sms",
          contactName: contact.displayName ?? contactName,
        },
      },
    };
  } catch (err) {
    if (err instanceof SmsOptedOutError) {
      return {
        status: 409,
        body: {
          error: `${contact.displayName ?? contactName} has opted out of SMS. They can re-subscribe by texting START to the Batchelor App number.`,
        },
      };
    }
    if (err instanceof SmsRegistrationPendingError) {
      return {
        status: 503,
        body: {
          error:
            "SMS isn't fully enabled yet — carrier registration is still pending. Try again in a few days.",
        },
      };
    }
    logger.error({ err }, "elaine: failed to send contact message");
    return { status: 500, body: { error: "Failed to send the message." } };
  }
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

// Formats a Date for human-readable confirmation: "3:45 PM" or "Jan 15 at 3:45 PM"
function formatScheduledTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export const communicationActionExecutors: Record<
  CommunicationActionType,
  ActionExecutor
> = {
  call_contact: (async (
    payload: z.infer<typeof CallContactPayload>,
    userId: number,
  ) => {
    if (payload.scheduleAt) {
      // Deferred — write a row to the scheduler table and return a confirmation.
      const contact = await resolveContact(payload.contactName);
      const storedPayload = {
        contactName: payload.contactName,
        message: payload.message,
      };
      const [row] = await db
        .insert(elaineScheduledActions)
        .values({
          scheduledFor: new Date(payload.scheduleAt),
          actionType: "call_contact",
          actionPayload: storedPayload,
          initiatedByUserId: userId,
          targetContactId: contact?.id ?? null,
        })
        .returning({ id: elaineScheduledActions.id });
      const formattedTime = formatScheduledTime(payload.scheduleAt);
      logger.info(
        {
          scheduledActionId: row?.id,
          scheduledFor: payload.scheduleAt,
          contactName: payload.contactName,
        },
        "elaine: scheduled outbound call",
      );
      return {
        status: 200,
        body: {
          type: "call_contact",
          result: {
            scheduled: true,
            scheduledActionId: row?.id,
            scheduledFor: payload.scheduleAt,
            contactName: contact?.displayName ?? payload.contactName,
            confirmationMessage: `Got it — I'll call ${contact?.displayName ?? payload.contactName} at ${formattedTime}.`,
          },
        },
      };
    }
    return fireCallContact(payload.contactName, payload.message);
  }) as ActionExecutor,

  message_contact: (async (
    payload: z.infer<typeof MessageContactPayload>,
    userId: number,
  ) => {
    if (payload.scheduleAt) {
      // Deferred — write a row to the scheduler table and return a confirmation.
      const contact = await resolveContact(payload.contactName);
      const storedPayload = {
        contactName: payload.contactName,
        message: payload.message,
        channel: payload.channel,
      };
      const [row] = await db
        .insert(elaineScheduledActions)
        .values({
          scheduledFor: new Date(payload.scheduleAt),
          actionType: "message_contact",
          actionPayload: storedPayload,
          initiatedByUserId: userId,
          targetContactId: contact?.id ?? null,
        })
        .returning({ id: elaineScheduledActions.id });
      const formattedTime = formatScheduledTime(payload.scheduleAt);
      logger.info(
        {
          scheduledActionId: row?.id,
          scheduledFor: payload.scheduleAt,
          contactName: payload.contactName,
        },
        "elaine: scheduled contact message",
      );
      return {
        status: 200,
        body: {
          type: "message_contact",
          result: {
            scheduled: true,
            scheduledActionId: row?.id,
            scheduledFor: payload.scheduleAt,
            contactName: contact?.displayName ?? payload.contactName,
            confirmationMessage: `Got it — I'll message ${contact?.displayName ?? payload.contactName} at ${formattedTime}.`,
          },
        },
      };
    }
    return fireMessageContact(
      payload.contactName,
      payload.message,
      payload.channel,
    );
  }) as ActionExecutor,

  continue_in_channel: (async (
    payload: z.infer<typeof ContinueInChannelPayload>,
    userId: number,
  ) => {
    // Look up the requesting user's OWN contact details (not a household member).
    const [user] = await db
      .select({
        email: appUsers.email,
        phoneNumber: appUsers.phoneNumber,
        phoneVerified: appUsers.phoneVerified,
        smsConsentAt: appUsers.smsConsentAt,
        smsOptedOutAt: appUsers.smsOptedOutAt,
        slackUserId: appUsers.slackUserId,
        displayName: appUsers.displayName,
      })
      .from(appUsers)
      .where(eq(appUsers.id, userId));

    if (!user) {
      return { status: 404, body: { error: "User account not found." } };
    }

    const { targetChannel, message } = payload;

    if (targetChannel === "slack") {
      if (!user.slackUserId) {
        return {
          status: 422,
          body: {
            error:
              "You don't have a Slack account linked. You can connect it from your account settings in the app.",
          },
        };
      }
      if (!slackConfigured()) {
        return {
          status: 503,
          body: { error: "Slack isn't configured on this installation." },
        };
      }
      try {
        const channelId = await openDmChannel(user.slackUserId);
        await postSlackMessage(channelId, message);
        return {
          status: 200,
          body: {
            type: "continue_in_channel",
            result: { channel: "slack", sent: true },
          },
        };
      } catch (err) {
        logger.error({ err }, "elaine: continue_in_channel slack send failed");
        return {
          status: 500,
          body: { error: "Failed to send the Slack message. Try again." },
        };
      }
    }

    if (targetChannel === "sms") {
      if (!user.phoneNumber) {
        return {
          status: 422,
          body: {
            error:
              "You don't have a phone number on file. Add and verify one from your account settings.",
          },
        };
      }
      if (!user.phoneVerified) {
        return {
          status: 422,
          body: {
            error:
              "Your phone number hasn't been verified yet. Verify it from your account settings before SMS can be used.",
          },
        };
      }
      if (!user.smsConsentAt) {
        return {
          status: 422,
          body: {
            error:
              "You haven't given SMS consent. Enable SMS notifications on your profile page.",
          },
        };
      }
      if (user.smsOptedOutAt) {
        return {
          status: 409,
          body: {
            error:
              "You've opted out of SMS. Text START to the Batchelor App number to re-subscribe.",
          },
        };
      }
      try {
        await sendSms(user.phoneNumber, message);
        return {
          status: 200,
          body: {
            type: "continue_in_channel",
            result: { channel: "sms", sent: true },
          },
        };
      } catch (err) {
        if (err instanceof SmsOptedOutError) {
          return {
            status: 409,
            body: {
              error:
                "You've opted out of SMS. Text START to the Batchelor App number to re-subscribe.",
            },
          };
        }
        if (err instanceof SmsRegistrationPendingError) {
          return {
            status: 503,
            body: {
              error:
                "SMS isn't fully enabled yet — carrier registration is pending. Try again in a few days.",
            },
          };
        }
        logger.error({ err }, "elaine: continue_in_channel sms send failed");
        return {
          status: 500,
          body: { error: "Failed to send the SMS. Try again." },
        };
      }
    }

    if (targetChannel === "email") {
      try {
        await sendAssistantEmail(
          user.email,
          "From Elaine — continued conversation",
          message,
        );
        return {
          status: 200,
          body: {
            type: "continue_in_channel",
            result: { channel: "email", sent: true },
          },
        };
      } catch (err) {
        logger.error({ err }, "elaine: continue_in_channel email send failed");
        return {
          status: 500,
          body: { error: "Failed to send the email. Try again." },
        };
      }
    }

    return { status: 400, body: { error: "Unknown target channel." } };
  }) as ActionExecutor,

  broadcast_message: (async (
    payload: z.infer<typeof BroadcastMessagePayload>,
    userId: number,
  ) => {
    // Rate-limit check first — before any DB work.
    const rateCheck = checkBroadcastRateLimit(userId);
    if (!rateCheck.allowed) {
      return {
        status: 429,
        body: {
          error: `You've sent 3 broadcasts in the last hour. You can send another in about ${rateCheck.resetInMinutes} minute${rateCheck.resetInMinutes === 1 ? "" : "s"}.`,
        },
      };
    }

    // Look up the user's own contact details.
    const [user] = await db
      .select({
        email: appUsers.email,
        phoneNumber: appUsers.phoneNumber,
        phoneVerified: appUsers.phoneVerified,
        smsConsentAt: appUsers.smsConsentAt,
        smsOptedOutAt: appUsers.smsOptedOutAt,
        slackUserId: appUsers.slackUserId,
        displayName: appUsers.displayName,
      })
      .from(appUsers)
      .where(eq(appUsers.id, userId));

    if (!user) {
      return { status: 404, body: { error: "User account not found." } };
    }

    const { message } = payload;
    const results: string[] = [];
    const skipped: string[] = [];

    // Fan out concurrently to all configured channels.
    await Promise.all([
      // --- Slack ---
      (async () => {
        if (!slackConfigured() || !user.slackUserId) {
          skipped.push("Slack (not connected)");
          return;
        }
        try {
          const channelId = await openDmChannel(user.slackUserId);
          await postSlackMessage(channelId, message);
          results.push("Slack ✓");
        } catch (err) {
          logger.warn({ err, userId }, "elaine: broadcast Slack DM failed");
          results.push("Slack ✗ (failed)");
        }
      })(),

      // --- SMS ---
      (async () => {
        if (!user.phoneNumber || !user.phoneVerified) {
          skipped.push("SMS (no verified phone)");
          return;
        }
        if (!user.smsConsentAt || user.smsOptedOutAt) {
          skipped.push("SMS (opted out)");
          return;
        }
        try {
          await sendSms(user.phoneNumber, message);
          results.push("SMS ✓");
        } catch (err) {
          if (err instanceof SmsOptedOutError) {
            skipped.push("SMS (opted out)");
          } else if (err instanceof SmsRegistrationPendingError) {
            skipped.push("SMS (carrier registration pending)");
          } else {
            logger.warn({ err, userId }, "elaine: broadcast SMS failed");
            results.push("SMS ✗ (failed)");
          }
        }
      })(),

      // --- Email ---
      (async () => {
        if (!resendConfigured()) {
          skipped.push("Email (not configured)");
          return;
        }
        try {
          await sendAssistantEmail(
            user.email,
            "From Elaine — broadcast message",
            message,
          );
          results.push("Email ✓");
        } catch (err) {
          logger.warn({ err, userId }, "elaine: broadcast email failed");
          results.push("Email ✗ (failed)");
        }
      })(),
    ]);

    logger.info(
      { userId, results, skipped },
      "elaine: broadcast_message completed",
    );

    if (results.length === 0) {
      const skippedList = skipped.join(", ");
      return {
        status: 422,
        body: {
          error: `No channels were available to broadcast to (${skippedList}). Connect more channels in your account settings.`,
        },
      };
    }

    const sentSummary = results.join(", ");
    const skippedNote =
      skipped.length > 0 ? ` (${skipped.join(", ")} skipped)` : "";
    return {
      status: 200,
      body: {
        type: "broadcast_message",
        result: {
          sent: results,
          skipped,
          confirmationMessage: `Sent to ${sentSummary}${skippedNote}.`,
        },
      },
    };
  }) as ActionExecutor,

  call_me: (async (
    payload: z.infer<typeof CallMePayload>,
    userId: number,
  ) => {
    // Look up the requesting user's own verified phone number.
    const [user] = await db
      .select({
        phoneNumber: appUsers.phoneNumber,
        phoneVerified: appUsers.phoneVerified,
        smsOptedOutAt: appUsers.smsOptedOutAt,
        displayName: appUsers.displayName,
      })
      .from(appUsers)
      .where(eq(appUsers.id, userId));

    if (!user) {
      return { status: 404, body: { error: "User account not found." } };
    }
    if (!user.phoneNumber) {
      return {
        status: 422,
        body: {
          error:
            "You don't have a phone number on file. Add and verify one in your account settings, then ask me to call you again.",
        },
      };
    }
    if (!user.phoneVerified) {
      return {
        status: 422,
        body: {
          error:
            "Your phone number hasn't been verified yet. Verify it in your account settings first.",
        },
      };
    }
    if (user.smsOptedOutAt) {
      return {
        status: 409,
        body: {
          error:
            "You've opted out of SMS and voice calls. Text START to the Batchelor App number to re-subscribe, then ask me to call you again.",
        },
      };
    }

    const greeting =
      payload.greeting ??
      (user.displayName
        ? `Hi ${user.displayName}, it's Elaine from the Batchelor app calling. How can I help you?`
        : "Hi, it's Elaine from the Batchelor app. How can I help you?");

    try {
      const { callId } = await initiateOutboundCall({
        toNumber: user.phoneNumber,
        initialGreeting: greeting,
        callScreeningPurpose: "Elaine callback request",
      });
      logger.info(
        { callId, toNumber: user.phoneNumber, userId },
        "elaine: initiated self-callback call",
      );
      return {
        status: 200,
        body: {
          type: "call_me",
          result: {
            callId,
            confirmationMessage: "Calling you now — pick up in a moment!",
          },
        },
      };
    } catch (err) {
      logger.error({ err }, "elaine: failed to initiate self-callback call");
      return {
        status: 500,
        body: { error: "Failed to place the call. Please try again shortly." },
      };
    }
  }) as ActionExecutor,

  cancel_scheduled_contact: (async (
    payload: z.infer<typeof CancelScheduledContactPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({
        id: elaineScheduledActions.id,
        status: elaineScheduledActions.status,
        actionType: elaineScheduledActions.actionType,
        actionPayload: elaineScheduledActions.actionPayload,
        scheduledFor: elaineScheduledActions.scheduledFor,
      })
      .from(elaineScheduledActions)
      .where(
        and(
          eq(elaineScheduledActions.id, payload.scheduledActionId),
          eq(elaineScheduledActions.initiatedByUserId, userId),
        ),
      );

    if (!existing) {
      return {
        status: 404,
        body: { error: "Scheduled contact not found." },
      };
    }
    if (existing.status !== "pending") {
      return {
        status: 409,
        body: {
          error: `This scheduled contact has already been ${existing.status} and can't be cancelled.`,
        },
      };
    }

    // Atomic cancel: include user + status guard in WHERE so that if the
    // scheduler fires the row between our read and our write, we detect the
    // race instead of silently overwriting "fired" with "cancelled".
    const [cancelled] = await db
      .update(elaineScheduledActions)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(elaineScheduledActions.id, payload.scheduledActionId),
          eq(elaineScheduledActions.initiatedByUserId, userId),
          eq(elaineScheduledActions.status, "pending"),
        ),
      )
      .returning({ id: elaineScheduledActions.id });

    if (!cancelled) {
      return {
        status: 409,
        body: {
          error:
            "This scheduled contact could not be cancelled — it may have just fired. Check your call or message history.",
        },
      };
    }

    const p = existing.actionPayload as { contactName?: string } | null;
    logger.info(
      { scheduledActionId: payload.scheduledActionId },
      "elaine: cancelled scheduled contact",
    );
    return {
      status: 200,
      body: {
        type: "cancel_scheduled_contact",
        result: {
          scheduledActionId: payload.scheduledActionId,
          contactName: p?.contactName ?? "unknown",
        },
      },
    };
  }) as ActionExecutor,
};

// ---------------------------------------------------------------------------
// Soft-tool: list_scheduled_contacts — no confirmation needed, returns the
// user's pending scheduled calls and messages.
// ---------------------------------------------------------------------------

export const LIST_SCHEDULED_CONTACTS_TOOL_NAME = "list_scheduled_contacts";

export async function executeListScheduledContacts(
  userId: number,
): Promise<string> {
  const rows = await db
    .select({
      id: elaineScheduledActions.id,
      actionType: elaineScheduledActions.actionType,
      actionPayload: elaineScheduledActions.actionPayload,
      scheduledFor: elaineScheduledActions.scheduledFor,
      status: elaineScheduledActions.status,
    })
    .from(elaineScheduledActions)
    .where(
      and(
        eq(elaineScheduledActions.initiatedByUserId, userId),
        eq(elaineScheduledActions.status, "pending"),
      ),
    )
    .orderBy(elaineScheduledActions.scheduledFor);

  if (rows.length === 0) {
    return "No pending scheduled calls or messages.";
  }

  const lines = rows.map((r) => {
    const p = r.actionPayload as {
      contactName?: string;
      message?: string;
      channel?: string;
    } | null;
    const when = r.scheduledFor
      ? new Date(r.scheduledFor).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "unknown time";
    const verb = r.actionType === "call_contact" ? "Call" : "Message";
    const who = p?.contactName ?? "unknown";
    const via =
      r.actionType === "message_contact" && p?.channel && p.channel !== "auto"
        ? ` via ${p.channel}`
        : "";
    return `• [#${r.id}] ${verb} ${who}${via} at ${when}`;
  });

  return `Pending scheduled contacts (${rows.length}):\n${lines.join("\n")}`;
}

export const listScheduledContactsTool: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: LIST_SCHEDULED_CONTACTS_TOOL_NAME,
      description:
        "List all pending scheduled calls and messages this user has set up for future delivery. " +
        "Call this when the user asks 'what calls do you have scheduled', 'show my scheduled messages', " +
        "'what are my upcoming contacts', etc. Returns each scheduled item with its ID, contact, time, and type.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  };

// ---------------------------------------------------------------------------
// Label builder
// ---------------------------------------------------------------------------

export async function buildCommunicationActionLabel(action: {
  type: CommunicationActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "call_contact": {
      const payload = CallContactPayload.parse(action.payload);
      if (payload.scheduleAt) {
        const when = formatScheduledTime(payload.scheduleAt);
        return `Schedule a call to ${payload.contactName} at ${when}`;
      }
      return `Call ${payload.contactName}`;
    }
    case "message_contact": {
      const payload = MessageContactPayload.parse(action.payload);
      if (payload.scheduleAt) {
        const when = formatScheduledTime(payload.scheduleAt);
        const via = payload.channel !== "auto" ? ` via ${payload.channel}` : "";
        return `Schedule a message to ${payload.contactName}${via} at ${when}`;
      }
      const via = payload.channel !== "auto" ? ` via ${payload.channel}` : "";
      return `Message ${payload.contactName}${via}`;
    }
    case "cancel_scheduled_contact": {
      const payload = CancelScheduledContactPayload.parse(action.payload);
      return `Cancel scheduled contact #${payload.scheduledActionId}`;
    }
    case "continue_in_channel": {
      const payload = ContinueInChannelPayload.parse(action.payload);
      const channelLabels = { slack: "Slack", sms: "SMS", email: "email" };
      return `Continue conversation on ${channelLabels[payload.targetChannel]}`;
    }
    case "call_me": {
      return "Call me back on my phone";
    }
    case "broadcast_message": {
      return "Broadcast message to all my channels";
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// First-person delivery is enforced in both descriptions with explicit
// WRONG/RIGHT examples so the model never attributes the message to the caller.
// ---------------------------------------------------------------------------

export const communicationActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "call_contact",
        description:
          "Propose calling a household member by phone. Elaine dials them and speaks the message when they answer. " +
          "CRITICAL — write `message` in FIRST PERSON as exactly what Elaine says. Do NOT attribute the message to the requester. " +
          "WRONG: 'Jonathan asked me to remind you to pick up the cat.' " +
          "RIGHT: 'Hey, just a reminder to pick up the cat from the vet today!' " +
          "Confirm the contact name and message wording before proposing this action. " +
          "If the user wants the call at a future time, include `scheduleAt` as an ISO 8601 datetime (e.g. '2026-08-01T15:45:00+02:00'). " +
          "When scheduling: confirm the time in your visible reply before calling this tool.",
        parameters: {
          type: "object",
          properties: {
            contactName: {
              type: "string",
              description:
                "First name (or full name) of the household member to call.",
            },
            message: {
              type: "string",
              description:
                "What Elaine says when the call is answered — first person, direct, as if Elaine herself is speaking. No attribution to the person who asked.",
            },
            scheduleAt: {
              type: "string",
              description:
                "Optional ISO 8601 datetime to fire the call at (e.g. '2026-08-01T15:45:00+02:00'). Omit to call immediately.",
            },
          },
          required: ["contactName", "message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "message_contact",
        description:
          "Propose sending a message to a household member. Uses Slack DM if they have Slack linked, SMS otherwise. " +
          "CRITICAL — write `message` in FIRST PERSON as exactly what Elaine sends. Do NOT attribute the message to the requester. " +
          "WRONG: 'Jonathan wants you to know dinner is at 7.' " +
          "RIGHT: 'Dinner is at 7 tonight, don\\'t forget!' " +
          "Confirm contact and message wording before proposing. " +
          "If the user wants the message at a future time, include `scheduleAt` as an ISO 8601 datetime. " +
          "When scheduling: confirm the time in your visible reply before calling this tool.",
        parameters: {
          type: "object",
          properties: {
            contactName: {
              type: "string",
              description:
                "First name (or full name) of the household member to message.",
            },
            message: {
              type: "string",
              description:
                "The message text — first person, direct, no attribution to anyone.",
            },
            channel: {
              type: "string",
              enum: ["auto", "sms", "slack"],
              description:
                "'auto' (default) uses Slack if available, falls back to SMS. Only specify when the user explicitly requests a channel.",
            },
            scheduleAt: {
              type: "string",
              description:
                "Optional ISO 8601 datetime to send the message at. Omit to send immediately.",
            },
          },
          required: ["contactName", "message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "cancel_scheduled_contact",
        description:
          "Cancel a pending scheduled call or message that hasn't fired yet. " +
          "Use list_scheduled_contacts first to get the scheduledActionId. " +
          "Only cancels pending items — already-fired or already-cancelled items will return an error.",
        parameters: {
          type: "object",
          properties: {
            scheduledActionId: {
              type: "number",
              description:
                "The numeric ID of the scheduled contact to cancel (from list_scheduled_contacts).",
            },
          },
          required: ["scheduledActionId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "continue_in_channel",
        description:
          "Send a message to the REQUESTING USER THEMSELVES on a different channel (Slack DM, SMS, or email). " +
          "Use this when the user asks to move or continue the current conversation on another channel — " +
          "e.g. 'text me that', 'send this to my Slack', 'let's continue on Slack', 'email me a summary'. " +
          "IMPORTANT: this sends to THE SAME USER who is talking to you, not to a household member. " +
          "After calling this tool, confirm in your visible reply that you've forwarded the message and on which channel. " +
          "Do NOT use this to send information to other people — use message_contact for that.",
        parameters: {
          type: "object",
          properties: {
            targetChannel: {
              type: "string",
              enum: ["slack", "sms", "email"],
              description:
                "The channel to deliver the message on. Match what the user asked for.",
            },
            message: {
              type: "string",
              description:
                "The text to deliver to the user on the target channel. Can be a summary, a continuation, or the exact reply — whatever makes sense in context.",
            },
          },
          required: ["targetChannel", "message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "broadcast_message",
        description:
          "Send a message to ALL of the requesting user's own connected channels simultaneously " +
          "(Slack DM, SMS, and/or email — whichever are configured and opted in). " +
          "Use this when the user says 'send this to all my channels', 'broadcast that', " +
          "'push this everywhere', 'send it to all of them', or similar. " +
          "Self-directed only — always goes to THE SAME USER, never to household members. " +
          "Only available on web. Rate-limited: at most 3 broadcasts per hour. " +
          "After the action executes, Elaine receives a summary of which channels succeeded and which were skipped.",
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description:
                "The text to broadcast. Keep it concise (max 500 characters) since SMS has length limits.",
            },
          },
          required: ["message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "call_me",
        description:
          "Initiate an outbound voice call to THE REQUESTING USER'S OWN verified phone number. " +
          "Use this when the user says 'call me back', 'give me a call', 'can you call me?', " +
          "'I'd rather talk — call my phone', 'I'm driving, call me', or any similar request. " +
          "This calls THE SAME USER who is chatting, never another household member — use call_contact for that. " +
          "Available on web and SMS channels. NOT available over email. " +
          "After proposing, confirm in your reply that Elaine is calling them. " +
          "If they have no verified phone number, the executor returns an error message you should relay.",
        parameters: {
          type: "object",
          properties: {
            greeting: {
              type: "string",
              description:
                "Optional opening words Elaine says when the call connects (1–2 warm sentences). Omit to use the default greeting.",
            },
          },
          required: [],
        },
      },
    },
  ];
