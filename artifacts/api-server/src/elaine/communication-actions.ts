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
] as const;

export const COMMUNICATION_ACTION_TYPES = [
  "call_contact",
  "message_contact",
  "cancel_scheduled_contact",
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
  ];
