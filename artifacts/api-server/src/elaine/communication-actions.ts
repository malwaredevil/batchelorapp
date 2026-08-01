import { z } from "zod/v4";
import type OpenAI from "openai";
import { ilike } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import {
  sendSms,
  SmsOptedOutError,
  SmsRegistrationPendingError,
} from "../lib/sms";
import { initiateOutboundCall } from "../lib/calls";
import {
  openDmChannel,
  postSlackMessage,
  slackConfigured,
} from "../lib/slack";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CallContactPayload = z.object({
  contactName: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
});

const MessageContactPayload = z.object({
  contactName: z.string().min(1).max(100),
  message: z.string().min(1).max(1600),
  channel: z.enum(["auto", "sms", "slack"]).default("auto"),
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
] as const;

export const COMMUNICATION_ACTION_TYPES = [
  "call_contact",
  "message_contact",
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
// Executors
// ---------------------------------------------------------------------------

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const communicationActionExecutors: Record<
  CommunicationActionType,
  ActionExecutor
> = {
  call_contact: (async (payload: z.infer<typeof CallContactPayload>) => {
    const contact = await resolveContact(payload.contactName);
    if (!contact) {
      return {
        status: 404,
        body: {
          error: `No household member named "${payload.contactName}" found. Check the name and try again.`,
        },
      };
    }
    if (!contact.phoneNumber) {
      return {
        status: 422,
        body: {
          error: `${contact.displayName ?? payload.contactName} doesn't have a phone number on file. They can add one on their profile page.`,
        },
      };
    }
    try {
      const { callId } = await initiateOutboundCall({
        toNumber: contact.phoneNumber,
        initialGreeting: payload.message,
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
            contactName: contact.displayName ?? payload.contactName,
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
  }) as ActionExecutor,

  message_contact: (async (payload: z.infer<typeof MessageContactPayload>) => {
    const contact = await resolveContact(payload.contactName);
    if (!contact) {
      return {
        status: 404,
        body: {
          error: `No household member named "${payload.contactName}" found.`,
        },
      };
    }

    // Prefer Slack (free, instant) when available and not forced to SMS.
    const trySlack =
      payload.channel !== "sms" &&
      !!contact.slackUserId &&
      slackConfigured();

    if (trySlack && contact.slackUserId) {
      try {
        const channelId = await openDmChannel(contact.slackUserId);
        await postSlackMessage(channelId, payload.message);
        return {
          status: 200,
          body: {
            type: "message_contact",
            result: {
              channel: "slack",
              contactName: contact.displayName ?? payload.contactName,
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
          error: `${contact.displayName ?? payload.contactName} has no phone number or Slack account linked. They can add these on their profile page.`,
        },
      };
    }

    try {
      await sendSms(contact.phoneNumber, payload.message);
      return {
        status: 200,
        body: {
          type: "message_contact",
          result: {
            channel: "sms",
            contactName: contact.displayName ?? payload.contactName,
          },
        },
      };
    } catch (err) {
      if (err instanceof SmsOptedOutError) {
        return {
          status: 409,
          body: {
            error: `${contact.displayName ?? payload.contactName} has opted out of SMS. They can re-subscribe by texting START to the Batchelor App number.`,
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
  }) as ActionExecutor,
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
      return `Call ${payload.contactName}`;
    }
    case "message_contact": {
      const payload = MessageContactPayload.parse(action.payload);
      const via = payload.channel !== "auto" ? ` via ${payload.channel}` : "";
      return `Message ${payload.contactName}${via}`;
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
          "Confirm the contact name and message wording before proposing this action.",
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
          "Confirm contact and message wording before proposing.",
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
          },
          required: ["contactName", "message"],
        },
      },
    },
  ];
