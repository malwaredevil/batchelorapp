import { z } from "zod/v4";
import type OpenAI from "openai";
import { eq } from "drizzle-orm";
import { db, appUsers, reminders } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  resolveRelativeTime,
  getUserTimezone,
  RelativeTimeResolutionError,
  RelativeTimeSpecZod,
  RELATIVE_TIME_SPEC_JSON_SCHEMA,
  type RelativeTimeSpec,
} from "../lib/relative-time-resolver";
import { formatScheduledTime } from "./communication-actions";

// ---------------------------------------------------------------------------
// Natural-language reminder creation (issue #526).
//
// This is deliberately separate from the Travels-trip-scoped add_reminder /
// edit_reminder / delete_reminder actions already in index.ts (those require
// a tripId and only ever attach to a trip). create_reminder is the
// general-purpose "remind me..." entry point with no entity attachment,
// writing into the same generic `reminders` table via the same executor
// path introduced for Elaine's scheduled call/message actions in #515.
//
// The model NEVER computes the actual datetime — it only maps the user's
// words to one of the RelativeTimeSpec variants; resolveRelativeTime (#525)
// does the real, deterministic math. See relative-time-resolver.ts's module
// doc comment for why.
// ---------------------------------------------------------------------------

// RelativeTimeSpecZod (shared with communication-actions.ts's scheduleAt
// field) mirrors RelativeTimeSpec from relative-time-resolver.ts — see that
// module for the single source of truth.

// email/sms/slack always resolve to the REQUESTING user's own account — this
// tool has no concept of reminding someone else (that's call_contact /
// message_contact with scheduleAt, a separate, already-existing action).
// messenger is the default channel when none is specified: it's the one
// channel guaranteed to be checkable regardless of what other channels are
// configured for this household member.
const ReminderChannel = z.enum(["email", "sms", "slack", "messenger"]);

const CreateReminderPayload = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  when: RelativeTimeSpecZod,
  channels: z.array(ReminderChannel).max(4).optional(),
});

export const reminderActionSchemas = [
  z.object({
    type: z.literal("create_reminder"),
    payload: CreateReminderPayload,
  }),
] as const;

export const REMINDER_ACTION_TYPES = ["create_reminder"] as const;
export type ReminderActionType = (typeof REMINDER_ACTION_TYPES)[number];

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const reminderActionExecutors: Record<
  ReminderActionType,
  ActionExecutor
> = {
  create_reminder: (async (
    payload: z.infer<typeof CreateReminderPayload>,
    userId: number,
  ) => {
    const tz = await getUserTimezone(userId);
    let dueAt: Date;
    try {
      dueAt = resolveRelativeTime(payload.when as RelativeTimeSpec, tz);
    } catch (err) {
      if (err instanceof RelativeTimeResolutionError) {
        return {
          status: 400,
          body: {
            error: `I couldn't work out exactly when you mean (${err.message}). Could you give me a specific day and time?`,
          },
        };
      }
      throw err;
    }

    const channels: z.infer<typeof ReminderChannel>[] =
      payload.channels && payload.channels.length > 0
        ? payload.channels
        : ["messenger"];

    const [user] = await db
      .select({ email: appUsers.email })
      .from(appUsers)
      .where(eq(appUsers.id, userId));

    const [row] = await db
      .insert(reminders)
      .values({
        createdByUserId: userId,
        title: payload.title,
        description: payload.description ?? null,
        dueAt,
        leadTimes: [{ value: 0, unit: "minutes" }],
        emailRecipients:
          channels.includes("email") && user?.email ? [user.email] : [],
        smsRecipientUserIds: channels.includes("sms") ? [userId] : [],
        slackRecipientUserIds: channels.includes("slack") ? [userId] : [],
        messengerRecipientUserIds: channels.includes("messenger")
          ? [userId]
          : [],
      })
      .returning({ id: reminders.id, dueAt: reminders.dueAt });

    logger.info(
      {
        reminderId: row?.id,
        userId,
        dueAt: dueAt.toISOString(),
        channels,
      },
      "elaine: created natural-language reminder",
    );

    const formattedTime = formatScheduledTime(dueAt.toISOString());
    const channelLabel = channels.join(", ");
    return {
      status: 201,
      body: {
        type: "create_reminder",
        result: {
          id: row?.id,
          dueAt: dueAt.toISOString(),
          channels,
          confirmationMessage: `Got it — I'll remind you "${payload.title}" at ${formattedTime} via ${channelLabel}.`,
        },
      },
    };
  }) as ActionExecutor,
};

export async function buildReminderActionLabel(action: {
  type: ReminderActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "create_reminder": {
      const payload = CreateReminderPayload.parse(action.payload);
      return `Create a reminder: "${payload.title}"`;
    }
    default: {
      const _exhaustive: never = action.type;
      return `Perform this action (${_exhaustive as string})`;
    }
  }
}

export const reminderActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "create_reminder",
        description:
          "Propose creating a plain reminder for the requesting user (not attached to any trip, note, or other record — use add_reminder instead if the user is talking about a specific trip they're viewing). " +
          "Use for phrasing like 'remind me tomorrow to call the vet' or 'send me an email, sms, and slack next Tuesday at 9am about...'. " +
          "Resolve the time into the `when` structured spec — never write an ISO datetime yourself. " +
          "If the user's phrasing doesn't map cleanly onto one of the `when.kind` variants (e.g. a genuinely ambiguous date), ask them to clarify instead of guessing. " +
          "`channels` lists every delivery channel the user asked for in ONE request (e.g. email+sms+slack all in the same sentence creates ONE reminder with all three, not three reminders); omit it to default to the in-app messenger channel only. " +
          "Confirm the exact resolved date/time and channel(s) back to the user in your visible reply.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short reminder title, e.g. 'Call the vet'.",
            },
            description: {
              type: "string",
              description: "Optional longer description/details.",
            },
            when: RELATIVE_TIME_SPEC_JSON_SCHEMA,
            channels: {
              type: "array",
              items: {
                type: "string",
                enum: ["email", "sms", "slack", "messenger"],
              },
              description:
                "Delivery channel(s) for this reminder, all resolved to the requesting user's own account. Omit for the default (messenger only).",
            },
          },
          required: ["title", "when"],
        },
      },
    },
  ];
