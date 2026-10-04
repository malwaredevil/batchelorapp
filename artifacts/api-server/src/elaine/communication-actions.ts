import { z } from "zod/v4";
import type OpenAI from "openai";
import { and, count, eq, gt, ilike, isNull, min, sql } from "drizzle-orm";
import {
  db,
  appUsers,
  elaineBroadcastLog,
  elaineHistoryConversations,
  elaineHistoryMessages,
  reminders,
} from "@workspace/db";
import { isServiceHealthy } from "../routes/admin/integrations-health";
import {
  sendSms,
  SmsOptedOutError,
  SmsRegistrationPendingError,
} from "../lib/sms";
import {
  initiateOutboundCall,
  OutboundCallIndeterminateError,
  reconcileOutboundCallOutcome,
} from "../lib/calls";
import { openDmChannel, postSlackMessage, slackConfigured } from "../lib/slack";
import { sendAssistantEmail, resendConfigured } from "../lib/email";
import { getElaineGlobalConfig } from "../lib/elaine-config";
import { logger } from "../lib/logger";
import {
  resolveRelativeTime,
  resolveNaiveIsoInTimeZone,
  hasUtcOffset,
  getUserTimezone,
  RelativeTimeResolutionError,
  RelativeTimeSpecZod,
  RELATIVE_TIME_SPEC_JSON_SCHEMA,
  explicitTimezoneField,
  EXPLICIT_TIMEZONE_JSON_SCHEMA,
  type RelativeTimeSpec,
} from "../lib/relative-time-resolver";
import { isValidIanaTimeZone } from "../lib/timezone";
import {
  claimCommunicationProposal,
  cancelScheduledCommunicationReceipts,
  createOrReadCommunicationReceipt,
  createOrReadCommunicationReceiptWithRepeatCheck,
  findRecentCommunicationReceiptById,
  listRecentCommunicationReceiptsForRecipientChannels,
  removeUnstartedCommunicationReceipts,
  updateCallCommunicationReceiptsByProviderId,
  updateCommunicationReceipt,
  type CommunicationReceiptStatus,
} from "./communication-receipts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// scheduleAt accepts EITHER an exact ISO 8601 datetime OR a structured
// RelativeTimeSpec (see relative-time-resolver.ts, issue #525/#526) — when
// present the action is deferred rather than fired immediately. The
// scheduler worker polls every minute for due rows and dispatches them.
// resolveScheduleAt() below normalizes either form to a concrete ISO string
// before it's stored.
// `local: true` additionally accepts offset-less datetimes
// ("2026-08-17T16:15:00") — fallback/OpenRouter models routinely emit these
// even when told to include an offset (#1110); resolveScheduleAt interprets
// them as wall-clock time in the requesting user's timezone.
const scheduleAtField = z
  .union([
    z.string().datetime({ offset: true, local: true }),
    RelativeTimeSpecZod,
  ])
  .optional()
  .describe(
    "Either an exact ISO 8601 datetime, or a structured relative-time spec (see its own description), to fire this action at. Omit to execute immediately.",
  );

// Resolves a scheduleAt field (already-exact ISO string, or a
// RelativeTimeSpec the model produced) to a concrete ISO datetime string.
// `timezone` must already be the EFFECTIVE timezone for this request (see
// resolveEffectiveTimezone) — the user's own profile timezone by default, or
// an explicit override the user named for this specific request. Throws
// RelativeTimeResolutionError for a malformed spec — callers must surface
// that as "please clarify", never guess a fallback time.
function resolveScheduleAt(
  scheduleAt: string | RelativeTimeSpec,
  timezone: string,
): string {
  if (typeof scheduleAt === "string") {
    if (hasUtcOffset(scheduleAt)) return scheduleAt;
    // Naive (offset-less) datetime — fallback/OpenRouter models routinely
    // emit these (#1110): interpret as wall-clock time in the effective
    // timezone.
    return resolveNaiveIsoInTimeZone(scheduleAt, timezone).toISOString();
  }
  return resolveRelativeTime(scheduleAt, timezone).toISOString();
}

function normalizeExactIsoForDisplay(iso: string, tz: string): string {
  if (hasUtcOffset(iso)) return iso;
  try {
    return resolveNaiveIsoInTimeZone(iso, tz).toISOString();
  } catch {
    return iso;
  }
}

function safeErrorType(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}

// Picks the timezone to use for BOTH resolving a scheduled time and
// formatting its confirmation for a single request: the user's explicit
// override when they named one and it's a valid IANA identifier, otherwise
// their own profile timezone. Every scheduling call site must go through
// this rather than calling getUserTimezone directly, so an explicit
// override is honored consistently everywhere the tz is needed (resolution,
// duplicate-warning text, and the confirmation message) instead of only
// some of them.
async function resolveEffectiveTimezone(
  userId: number,
  explicitTimezone?: string,
): Promise<string> {
  if (explicitTimezone && isValidIanaTimeZone(explicitTimezone)) {
    return explicitTimezone;
  }
  return getUserTimezone(userId);
}

const CallContactPayload = z.object({
  contactName: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  scheduleAt: scheduleAtField,
  timezone: explicitTimezoneField,
});

// Canonical channel enum values for message_contact. Exported so the JSON
// tool-schema enum (below) and the Zod schema share a single array — a drift
// between them was the root cause of the relative-time-spec "relative_minutes"
// Sentry incident. Keep this in sync with the JSON schema in
// communicationActionTools; tool-schema-description-coverage.test.ts enforces
// the invariant automatically.
export const MESSAGE_CONTACT_CHANNEL_ENUM = [
  "auto",
  "sms",
  "slack",
  "email",
  "elaine_chat",
] as const;

const MessageContactPayload = z.object({
  // Accept a single name or a list of names for multi-recipient fanout
  // ("SMS users B, C, and D and tell them to come home").
  contactName: z.union([
    z.string().min(1).max(100),
    z.array(z.string().min(1).max(100)).min(1).max(20),
  ]),
  message: z.string().min(1).max(1600),
  // "auto"       — Slack DM if available, fall back to SMS
  // "slack"      — Slack DM only
  // "sms"        — SMS only
  // "email"      — send to contact's account email via Resend
  // "elaine_chat"— write into the contact's Elaine conversation history so
  //                it appears in their Elaine chat widget / main Elaine page
  channel: z.enum(MESSAGE_CONTACT_CHANNEL_ENUM).default("auto"),
  scheduleAt: scheduleAtField,
  timezone: explicitTimezoneField,
});

const CancelScheduledContactPayload = z.object({
  scheduledActionId: z.number().int().positive(),
});

export interface CommunicationReceiptContext {
  attemptKey: string;
  attemptKeyIsFinal?: boolean;
  proposalClaimKey?: string;
  payloadHash: string;
  ownerUserId: number;
  actionType: string;
  conversationId: number | null;
  acknowledgeRepeat?: string;
  status?: CommunicationReceiptStatus;
  scheduledActionId?: number;
  onClaimed?: (receipt: {
    id: string;
    actionType: string;
    channel: string;
    status: string;
    conversationId: number | null;
  }) => void;
}

async function claimCommunicationReceipt(
  context: CommunicationReceiptContext | undefined,
  recipientUserId: number | null,
  channel: string,
): Promise<Awaited<
  ReturnType<typeof createOrReadCommunicationReceipt>
> | null> {
  if (!context) return null;
  let attemptKey = context.attemptKeyIsFinal
    ? context.attemptKey
    : `${context.attemptKey}:${recipientUserId ?? "none"}` +
      (context.actionType === "broadcast_message" ? `:${channel}` : "");
  if (
    context.proposalClaimKey &&
    recipientUserId !== null &&
    context.status !== "scheduled"
  ) {
    const result = await createOrReadCommunicationReceiptWithRepeatCheck({
      attemptKey,
      payloadHash: context.payloadHash,
      ownerUserId: context.ownerUserId,
      actionType: context.actionType,
      channel,
      conversationId: context.conversationId,
      recipientUserId,
      ...(context.acknowledgeRepeat
        ? { acknowledgedReceiptId: context.acknowledgeRepeat }
        : {}),
    });
    if (result.kind === "repeat_confirmation") {
      throw new RepeatConfirmationRequiredError(
        result.receipt.id,
        result.receipt.status,
      );
    }
    if (result.kind === "stale_acknowledgement") {
      throw new StaleRepeatAcknowledgementError();
    }
    if (result.claimed) {
      context.onClaimed?.({
        id: result.receipt.id,
        actionType: result.receipt.actionType,
        channel: result.receipt.channel,
        status: result.receipt.status,
        conversationId: result.receipt.conversationId,
      });
    }
    return result;
  }
  const result = await createOrReadCommunicationReceipt({
    attemptKey,
    payloadHash: context.payloadHash,
    ownerUserId: context.ownerUserId,
    actionType: context.actionType,
    channel,
    ...(context.status ? { status: context.status } : {}),
    conversationId: context.conversationId,
    recipientUserId,
    ...(context.scheduledActionId !== undefined
      ? { scheduledActionId: context.scheduledActionId }
      : {}),
  });
  if (result.claimed) {
    context.onClaimed?.({
      id: result.receipt.id,
      actionType: result.receipt.actionType,
      channel: result.receipt.channel,
      status: result.receipt.status,
      conversationId: result.receipt.conversationId,
    });
  }
  return result;
}

export class RepeatConfirmationRequiredError extends Error {
  constructor(
    readonly receiptId: string,
    readonly status: string,
  ) {
    super("This recipient has a recent communication receipt");
    this.name = "RepeatConfirmationRequiredError";
  }
}

export class StaleRepeatAcknowledgementError extends Error {
  constructor() {
    super("The repeat confirmation is stale");
    this.name = "StaleRepeatAcknowledgementError";
  }
}

async function claimProposalBeforeExecution(
  context: CommunicationReceiptContext | undefined,
): Promise<boolean> {
  if (!context?.proposalClaimKey) return true;
  return claimCommunicationProposal({
    proposalKey: context.proposalClaimKey,
    ownerUserId: context.ownerUserId,
    payloadHash: context.payloadHash,
  });
}

async function finishCommunicationReceipt(
  receipt: Awaited<
    ReturnType<typeof createOrReadCommunicationReceipt>
  >["receipt"],
  status: CommunicationReceiptStatus,
  details?: {
    channel?: string;
    providerId?: string | null;
    callStatus?: string | null;
  },
): Promise<void> {
  await updateCommunicationReceipt(receipt.id, { status, ...details });
}

function receiptDuplicateResult(
  actionType: string,
  claimed: Awaited<ReturnType<typeof createOrReadCommunicationReceipt>>,
): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      type: actionType,
      result: {
        receiptId: claimed.receipt.id,
        receiptStatus: claimed.receipt.status,
        channel: claimed.receipt.channel,
        ...(claimed.receipt.providerId
          ? { providerId: claimed.receipt.providerId }
          : {}),
        ...(claimed.receipt.callStatus
          ? { callStatus: claimed.receipt.callStatus }
          : {}),
      },
    },
  };
}

function addReceiptToResult(
  result: { status: number; body: unknown },
  receiptId: string,
  receiptStatus: CommunicationReceiptStatus,
): { status: number; body: unknown } {
  if (!result.body || typeof result.body !== "object") return result;
  const body = result.body as Record<string, unknown>;
  const inner = body.result;
  if (!inner || typeof inner !== "object") return result;
  return {
    ...result,
    body: {
      ...body,
      result: {
        ...(inner as Record<string, unknown>),
        receiptId,
        receiptStatus,
      },
    },
  };
}

// Canonical channel enum values for continue_in_channel. Exported so the JSON
// tool-schema enum and the Zod schema share a single array — same drift-
// prevention pattern as MESSAGE_CONTACT_CHANNEL_ENUM. Enforced by
// tool-schema-description-coverage.test.ts.
export const CONTINUE_IN_CHANNEL_ENUM = ["slack", "sms", "email"] as const;

// continue_in_channel: send a message to the requesting user's OWN account on
// another channel. This is purely self-directed (user → themselves), not a
// household-member contact, so it is safe to execute from any channel.
// It should NOT be added to RESTRICTED_EXCLUDED_ACTION_TYPES.
const ContinueInChannelPayload = z.object({
  targetChannel: z
    .enum(CONTINUE_IN_CHANNEL_ENUM)
    .describe(
      "Channel to deliver the continuation message on. Choose whichever the user asked for.",
    ),
  message: z
    .string()
    .min(1)
    .max(2000)
    .describe("The text to deliver to the user on the target channel."),
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

// Per-user broadcast rate limit.
// Persisted in the DB so the cap survives server restarts and deployments.
// Each successful broadcast inserts a row into elaine_broadcast_log; the
// check counts rows WHERE user_id = ? AND created_at > now() - 1 hour.
// The limit is owner-configurable via getElaineGlobalConfig().thresholds.broadcastHourlyLimit.
const BROADCAST_WINDOW_MS = 60 * 60 * 1000;

async function checkBroadcastRateLimit(userId: number): Promise<{
  allowed: boolean;
  resetInMinutes: number;
}> {
  // Wrap count + insert in a transaction protected by a per-user PostgreSQL
  // advisory transaction lock. pg_advisory_xact_lock serializes concurrent
  // requests for the same userId so two simultaneous callers cannot both
  // observe count < limit and each sneak in a row (and a broadcast). The lock
  // is released automatically when the transaction ends.
  //
  // The row is inserted BEFORE delivery begins (a "slot reservation" model):
  // this means a delivery failure does not reclaim the slot, which is
  // intentional — it prevents retries from bypassing the limit.
  const config = await getElaineGlobalConfig();
  const broadcastHourlyLimit = config.thresholds.broadcastHourlyLimit;

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${userId}::bigint)`);

    const cutoff = new Date(Date.now() - BROADCAST_WINDOW_MS);
    const [result] = await tx
      .select({
        total: count(),
        oldest: min(elaineBroadcastLog.createdAt),
      })
      .from(elaineBroadcastLog)
      .where(
        and(
          eq(elaineBroadcastLog.userId, userId),
          gt(elaineBroadcastLog.createdAt, cutoff),
        ),
      );

    const total = result?.total ?? 0;
    if (total >= broadcastHourlyLimit) {
      const oldestMs = result?.oldest
        ? new Date(result.oldest).getTime()
        : Date.now();
      const resetInMs = oldestMs + BROADCAST_WINDOW_MS - Date.now();
      return {
        allowed: false,
        resetInMinutes: Math.max(1, Math.ceil(resetInMs / 60_000)),
      };
    }

    // Reserve this slot atomically inside the same transaction.
    await tx.insert(elaineBroadcastLog).values({ userId });
    return { allowed: true, resetInMinutes: 0 };
  });
}

const DUPLICATE_DUE_WINDOW_MS = 30 * 60 * 1000;
/** Synchronous read of the last-known AgentPhone health from the 30-min cache. */
function isAgentPhoneHealthy(): boolean {
  return isServiceHealthy("AgentPhone");
}

/** Human-readable label for a channel, optionally showing a masked phone/email. */
function contactChannelLabel(
  channel: string,
  contact: ResolvedContact,
): string {
  switch (channel) {
    case "elaine_chat":
      return "Elaine chat";
    case "slack":
      return "Slack DM";
    case "sms":
      return contact.phoneNumber
        ? `SMS (•••-${contact.phoneNumber.slice(-4)})`
        : "SMS";
    case "voice":
      return contact.phoneNumber
        ? `Phone call (•••-${contact.phoneNumber.slice(-4)})`
        : "Phone call";
    case "email":
      return contact.email ? `Email (${contact.email})` : "Email";
    default:
      return channel;
  }
}

interface ChannelAvailability {
  available: string[];
  unavailable: Array<{ channel: string; reason: string }>;
}

/**
 * Returns which channels are available for a given resolved contact right now.
 * Always includes "elaine_chat" (writing to their Elaine conversation history
 * never requires an external service). Other channels depend on the contact's
 * linked accounts and current service health.
 */
async function resolveContactChannels(
  contact: ResolvedContact,
): Promise<ChannelAvailability> {
  const available: string[] = ["elaine_chat"];
  const unavailable: Array<{ channel: string; reason: string }> = [];
  const name = contact.displayName ?? "They";

  // ── Slack ──────────────────────────────────────────────────────────────────
  if (contact.slackUserId && slackConfigured()) {
    available.push("slack");
  } else if (contact.slackUserId && !slackConfigured()) {
    unavailable.push({
      channel: "slack",
      reason: "Slack is not configured on this server",
    });
  } else {
    unavailable.push({
      channel: "slack",
      reason: `${name} hasn't linked a Slack account`,
    });
  }

  // ── SMS / Voice ────────────────────────────────────────────────────────────
  const phoneReady =
    !!contact.phoneNumber &&
    contact.phoneVerified &&
    !!contact.smsConsentAt &&
    !contact.smsOptedOutAt;

  if (phoneReady) {
    if (isAgentPhoneHealthy()) {
      available.push("sms");
      available.push("voice");
    } else {
      unavailable.push({
        channel: "sms",
        reason: "AgentPhone is currently unavailable",
      });
      unavailable.push({
        channel: "voice",
        reason: "AgentPhone is currently unavailable",
      });
    }
  } else if (!contact.phoneNumber || !contact.phoneVerified) {
    unavailable.push({
      channel: "sms",
      reason: `${name} hasn't verified a phone number`,
    });
    unavailable.push({
      channel: "voice",
      reason: `${name} hasn't verified a phone number`,
    });
  } else {
    unavailable.push({
      channel: "sms",
      reason: `${name} has opted out of SMS`,
    });
    unavailable.push({
      channel: "voice",
      reason: `${name} has opted out of SMS`,
    });
  }

  // ── Email ──────────────────────────────────────────────────────────────────
  if (resendConfigured()) {
    available.push("email");
  } else {
    unavailable.push({
      channel: "email",
      reason: "Email delivery is not configured on this server",
    });
  }

  return { available, unavailable };
}

// ---------------------------------------------------------------------------
// Elaine in-app chat delivery — writes a message directly into the contact's
// Elaine conversation history so it appears in their chat widget / main page.
// Finds or creates their widget-default conversation.
// ---------------------------------------------------------------------------

async function deliverElaineChat(
  contact: ResolvedContact,
  message: string,
): Promise<{ status: number; body: unknown }> {
  let [conv] = await db
    .select({ id: elaineHistoryConversations.id })
    .from(elaineHistoryConversations)
    .where(
      and(
        eq(elaineHistoryConversations.userId, contact.id),
        eq(elaineHistoryConversations.isWidgetDefault, true),
      ),
    )
    .limit(1);

  if (!conv) {
    const [inserted] = await db
      .insert(elaineHistoryConversations)
      .values({
        userId: contact.id,
        isWidgetDefault: true,
        title: "Elaine",
      })
      .returning({ id: elaineHistoryConversations.id });
    conv = inserted;
  }

  if (!conv) {
    logger.error(
      { contactId: contact.id },
      "elaine: deliverElaineChat — could not find or create conversation",
    );
    return {
      status: 500,
      body: { error: "Failed to deliver in-app message." },
    };
  }

  await db.insert(elaineHistoryMessages).values({
    conversationId: conv.id,
    userId: contact.id,
    role: "assistant",
    content: message,
    channel: "web",
  });

  // Bump the conversation's updatedAt so it surfaces at the top of the
  // recipient's conversation list (ordered by userId, updatedAt DESC).
  await db
    .update(elaineHistoryConversations)
    .set({ updatedAt: new Date() })
    .where(eq(elaineHistoryConversations.id, conv.id));

  logger.info(
    { contactId: contact.id, conversationId: conv.id },
    "elaine: delivered elaine_chat message",
  );
  return {
    status: 200,
    body: {
      type: "message_contact",
      result: {
        channel: "elaine_chat",
        contactName: contact.displayName ?? "them",
      },
    },
  };
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
      "Opening words Elaine says after the recipient first speaks. Omit for the default warm introduction.",
    ),
  scheduleAt: scheduleAtField,
  timezone: explicitTimezoneField,
});

export const communicationActionSchemas = [
  z.object({
    type: z.literal("call_contact"),
    payload: CallContactPayload,
    proposalId: z.string().min(1).max(2048).optional(),
    acknowledgeRepeat: z.string().uuid().optional(),
    conversationId: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    type: z.literal("message_contact"),
    payload: MessageContactPayload,
    proposalId: z.string().min(1).max(2048).optional(),
    acknowledgeRepeat: z.string().uuid().optional(),
    conversationId: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    type: z.literal("cancel_scheduled_contact"),
    payload: CancelScheduledContactPayload,
  }),
  z.object({
    type: z.literal("continue_in_channel"),
    payload: ContinueInChannelPayload,
    proposalId: z.string().min(1).max(2048).optional(),
    acknowledgeRepeat: z.string().uuid().optional(),
    conversationId: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    type: z.literal("call_me"),
    payload: CallMePayload,
    proposalId: z.string().min(1).max(2048).optional(),
    acknowledgeRepeat: z.string().uuid().optional(),
    conversationId: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    type: z.literal("broadcast_message"),
    payload: BroadcastMessagePayload,
    proposalId: z.string().min(1).max(2048).optional(),
    acknowledgeRepeat: z.string().uuid().optional(),
    conversationId: z.number().int().positive().nullable().optional(),
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

export const RECEIPT_ACTION_TYPES = [
  "call_contact",
  "message_contact",
  "continue_in_channel",
  "call_me",
  "broadcast_message",
] as const;

export const GET_COMMUNICATION_RECEIPTS_TOOL_NAME =
  "get_recent_communication_receipts";

export const communicationReceiptsReadTool: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: GET_COMMUNICATION_RECEIPTS_TOOL_NAME,
      description:
        "Read recent communication execution receipts for this user. MUST call this when asked whether Elaine called, texted, emailed, or otherwise sent something, or whether an attempt went through. Report the recorded status exactly; accepted/pending is not delivered. If no receipt is returned, say there is no recorded execution.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Maximum recent receipts to return; defaults to 10.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  };

export type CommunicationActionType =
  (typeof COMMUNICATION_ACTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Contact resolver — case-insensitive search against app_users.displayName.
// Prefers exact match, then starts-with, then any partial match.
// ---------------------------------------------------------------------------

interface ResolvedContact {
  id: number;
  email: string;
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
      email: appUsers.email,
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
  receiptContext?: CommunicationReceiptContext,
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
  // Gate on AgentPhone health before attempting the call — consistent with
  // how fireMessageContactToResolved gates SMS and how resolveContactChannels
  // reports voice availability.
  if (!isAgentPhoneHealthy()) {
    return {
      status: 503,
      body: {
        error: `Calling is temporarily unavailable (AgentPhone service issue). Try messaging ${contact.displayName ?? contactName} via Elaine chat or email instead.`,
      },
    };
  }
  const claimed = await claimCommunicationReceipt(
    receiptContext,
    contact.id,
    "voice",
  );
  if (claimed && !claimed.claimed) {
    return {
      status: 200,
      body: {
        type: "call_contact",
        result: {
          channel: "voice",
          receiptId: claimed.receipt.id,
          receiptStatus: claimed.receipt.status,
          callStatus: claimed.receipt.callStatus,
          callId: claimed.receipt.providerId,
          contactName: contact.displayName ?? contactName,
        },
      },
    };
  }
  try {
    const { callId, pendingOutboundContext } = await initiateOutboundCall({
      toNumber: contact.phoneNumber,
      userId: contact.id,
      openingMessage: message,
      callScreeningPurpose: "household message",
    });
    logger.info({ callId }, "elaine: initiated outbound call");
    if (claimed) {
      await finishCommunicationReceipt(claimed.receipt, "accepted", {
        providerId: callId,
        callStatus: "pending",
      });
    }

    // Poll for a terminal status (answered / voicemail / no-answer / error).
    // Returns "pending" if the 12-second window closes without a terminal
    // status — callers should treat "pending" as "call initiated, outcome unknown".
    let providerCallStatus = "pending";
    const callOutcome = await reconcileOutboundCallOutcome(
      callId,
      pendingOutboundContext,
      {
        onProviderStatus: async (status) => {
          providerCallStatus = status;
          if (claimed) {
            await updateCallCommunicationReceiptsByProviderId(callId, status);
          }
        },
      },
    );
    logger.info({ callId, callOutcome }, "elaine: outbound call outcome");

    return {
      status: 200,
      body: {
        type: "call_contact",
        result: {
          channel: "voice",
          callId,
          callStatus: providerCallStatus,
          contactName: contact.displayName ?? contactName,
          ...(claimed
            ? {
                receiptId: claimed.receipt.id,
                receiptStatus:
                  callOutcome === "pending"
                    ? "accepted"
                    : callOutcome === "error"
                      ? "failed"
                      : "completed",
              }
            : {}),
        },
      },
    };
  } catch (err) {
    if (
      typeof OutboundCallIndeterminateError === "function" &&
      err instanceof OutboundCallIndeterminateError
    ) {
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "unknown", {
          callStatus: "pending",
        });
      }
      logger.warn(
        { errorType: safeErrorType(err) },
        "elaine: outbound call acceptance indeterminate; avoiding duplicate fallback",
      );
      return {
        status: 202,
        body: {
          type: "call_contact",
          result: {
            channel: "voice",
            callId: null,
            callStatus: "pending",
            contactName: contact.displayName ?? contactName,
            ...(claimed
              ? {
                  receiptId: claimed.receipt.id,
                  receiptStatus: "unknown",
                }
              : {}),
          },
        },
      };
    }
    if (claimed) {
      await finishCommunicationReceipt(claimed.receipt, "unknown");
    }
    logger.error(
      { errorType: safeErrorType(err) },
      "elaine: failed to initiate outbound call",
    );
    return {
      status: 500,
      body: {
        error: claimed
          ? "Call status is unknown; check its receipt before retrying."
          : "Failed to place the call. Please try again.",
        ...(claimed
          ? {
              result: {
                receiptId: claimed.receipt.id,
                receiptStatus: "unknown",
                channel: "voice",
              },
            }
          : {}),
      },
    };
  }
}

/**
 * Places the actual outbound call to the requesting user's own verified
 * phone number — the phone-number/verification/opt-out guardrails and
 * default-greeting logic shared by the immediate `call_me` executor and the
 * scheduler's dispatch of a deferred `call_me` reminder (see
 * dispatchElaineActionReminder in reminders-scheduler.ts). Re-resolves the
 * user's current phone/verification/opt-out state every time it's called so
 * a scheduled call fired later re-checks these, not just at scheduling time.
 */
export async function fireCallMe(
  userId: number,
  greeting?: string,
  receiptContext?: CommunicationReceiptContext,
): Promise<{ status: number; body: unknown }> {
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

  const resolvedGreeting =
    greeting ??
    (user.displayName
      ? `Hi ${user.displayName}, it's Elaine from the Batchelor app calling. How can I help you?`
      : "Hi, it's Elaine from the Batchelor app. How can I help you?");

  const claimed = await claimCommunicationReceipt(
    receiptContext,
    userId,
    "voice",
  );
  if (claimed && !claimed.claimed) {
    return receiptDuplicateResult("call_me", claimed);
  }
  try {
    const call = await initiateOutboundCall({
      toNumber: user.phoneNumber,
      userId,
      openingMessage: resolvedGreeting,
      callScreeningPurpose: "Elaine callback request",
    });
    if (claimed) {
      await finishCommunicationReceipt(claimed.receipt, "accepted", {
        providerId: call.callId,
        callStatus: "pending",
      });
    }
    // Reconcile every accepted call in the background so terminal outcomes
    // clear stored context even when the immediate attach already succeeded.
    // When attach raced a transient failure, retain the exact pending token;
    // without it, waitForCallOutcome clears only by the provider callId.
    const reconciliation = claimed
      ? reconcileOutboundCallOutcome(call.callId, call.pendingOutboundContext, {
          onProviderStatus: async (providerCallStatus) => {
            await updateCallCommunicationReceiptsByProviderId(
              call.callId,
              providerCallStatus,
            );
          },
        })
      : reconcileOutboundCallOutcome(call.callId, call.pendingOutboundContext);
    void reconciliation.catch((err) =>
      logger.warn(
        { errorType: safeErrorType(err), callId: call.callId, userId },
        "elaine: failed to reconcile self-callback context",
      ),
    );
    logger.info(
      { callId: call.callId, userId },
      "elaine: initiated self-callback call",
    );
    return {
      status: 200,
      body: {
        type: "call_me",
        result: {
          channel: "voice",
          callId: call.callId,
          confirmationMessage: "Calling you now — pick up in a moment!",
          ...(claimed
            ? {
                receiptId: claimed.receipt.id,
                receiptStatus: "accepted",
                callStatus: "pending",
              }
            : {}),
        },
      },
    };
  } catch (err) {
    if (
      typeof OutboundCallIndeterminateError === "function" &&
      err instanceof OutboundCallIndeterminateError
    ) {
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "unknown", {
          callStatus: "pending",
        });
      }
      logger.warn(
        { errorType: safeErrorType(err), userId },
        "elaine: self-callback acceptance indeterminate; avoiding duplicate retry",
      );
      return {
        status: 202,
        body: {
          type: "call_me",
          result: {
            channel: "voice",
            callId: null,
            callStatus: "pending",
            confirmationMessage:
              "Your call may already be connecting. Please wait a moment before trying again.",
            ...(claimed
              ? { receiptId: claimed.receipt.id, receiptStatus: "unknown" }
              : {}),
          },
        },
      };
    }
    logger.error(
      { errorType: safeErrorType(err) },
      "elaine: failed to initiate self-callback call",
    );
    if (claimed) {
      await finishCommunicationReceipt(claimed.receipt, "unknown");
    }
    return {
      status: 500,
      body: {
        error: claimed
          ? "Call status is unknown; check its receipt before retrying."
          : "Failed to place the call. Please try again shortly.",
        ...(claimed
          ? {
              result: {
                receiptId: claimed.receipt.id,
                receiptStatus: "unknown",
                channel: "voice",
              },
            }
          : {}),
      },
    };
  }
}

export async function fireMessageContact(
  contactName: string,
  message: string,
  channel: "auto" | "sms" | "slack" | "email" | "elaine_chat",
  receiptContext?: CommunicationReceiptContext,
): Promise<{ status: number; body: unknown }> {
  const contact = await resolveContact(contactName);
  if (!contact) {
    return {
      status: 404,
      body: { error: `No household member named "${contactName}" found.` },
    };
  }
  return fireMessageContactToResolved(
    contact,
    message,
    channel,
    contactName,
    receiptContext,
  );
}

/**
 * Deliver a message to an already-resolved contact on the requested channel.
 * Extracted so the multi-recipient fanout can reuse it without re-resolving.
 */
async function fireMessageContactToResolved(
  contact: ResolvedContact,
  message: string,
  channel: "auto" | "sms" | "slack" | "email" | "elaine_chat",
  originalName: string,
  receiptContext?: CommunicationReceiptContext,
): Promise<{ status: number; body: unknown }> {
  const name = contact.displayName ?? originalName;

  // ── elaine_chat: write to the contact's Elaine conversation history ───────
  if (channel === "elaine_chat") {
    const claimed = await claimCommunicationReceipt(
      receiptContext,
      contact.id,
      "elaine_chat",
    );
    if (claimed && !claimed.claimed) {
      return receiptDuplicateResult("message_contact", claimed);
    }
    const result = await deliverElaineChat(contact, message);
    if (!claimed) return result;
    const receiptStatus = result.status < 400 ? "completed" : "failed";
    await finishCommunicationReceipt(claimed.receipt, receiptStatus, {
      channel: "elaine_chat",
    });
    return addReceiptToResult(result, claimed.receipt.id, receiptStatus);
  }

  // ── email: send to the contact's account email address via Resend ─────────
  if (channel === "email") {
    if (!resendConfigured()) {
      return {
        status: 503,
        body: { error: "Email delivery is not configured on this server." },
      };
    }
    const claimed = await claimCommunicationReceipt(
      receiptContext,
      contact.id,
      "email",
    );
    if (claimed && !claimed.claimed) {
      return receiptDuplicateResult("message_contact", claimed);
    }
    try {
      await sendAssistantEmail(contact.email, "Message from Elaine", message);
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "accepted", {
          channel: "email",
        });
      }
      return {
        status: 200,
        body: {
          type: "message_contact",
          result: {
            channel: "email",
            contactName: name,
            ...(claimed
              ? { receiptId: claimed.receipt.id, receiptStatus: "accepted" }
              : {}),
          },
        },
      };
    } catch (err) {
      logger.error(
        { errorType: safeErrorType(err), contactId: contact.id },
        "elaine: email to contact failed",
      );
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "unknown", {
          channel: "email",
        });
      }
      return {
        status: 500,
        body: {
          error: "Email status is unknown; check its receipt before retrying.",
          ...(claimed
            ? {
                result: {
                  receiptId: claimed.receipt.id,
                  receiptStatus: "unknown",
                },
              }
            : {}),
        },
      };
    }
  }

  // ── slack / auto: prefer Slack when available ─────────────────────────────
  // For an explicit "slack" request, gate early: if the contact has no Slack
  // account linked or Slack isn't configured, return a clear error immediately
  // rather than silently falling through to SMS (which would violate the user's
  // explicit channel selection).
  if (channel === "slack") {
    if (!contact.slackUserId) {
      return {
        status: 422,
        body: {
          error: `${name} hasn't linked a Slack account. They can connect Slack on their profile page, or choose a different channel (sms, email, elaine_chat).`,
        },
      };
    }
    if (!slackConfigured()) {
      return {
        status: 503,
        body: {
          error: `Slack is not configured on this server. Use a different channel (sms, email, elaine_chat).`,
        },
      };
    }
  }

  const trySlack =
    channel !== "sms" && !!contact.slackUserId && slackConfigured();

  if (trySlack && contact.slackUserId) {
    const claimed = await claimCommunicationReceipt(
      receiptContext,
      contact.id,
      "slack",
    );
    if (claimed && !claimed.claimed) {
      return receiptDuplicateResult("message_contact", claimed);
    }
    try {
      const channelId = await openDmChannel(contact.slackUserId);
      await postSlackMessage(channelId, message);
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "accepted", {
          channel: "slack",
        });
      }
      return {
        status: 200,
        body: {
          type: "message_contact",
          result: {
            channel: "slack",
            contactName: name,
            ...(claimed
              ? { receiptId: claimed.receipt.id, receiptStatus: "accepted" }
              : {}),
          },
        },
      };
    } catch (err) {
      if (channel === "slack") {
        // send failed mid-flight — don't fall back
        logger.error(
          { errorType: safeErrorType(err), contactId: contact.id },
          "elaine: explicit slack DM failed",
        );
        if (claimed) {
          await finishCommunicationReceipt(claimed.receipt, "unknown", {
            channel: "slack",
          });
        }
        return {
          status: 500,
          body: {
            error:
              "Slack status is unknown; check its receipt before retrying.",
            ...(claimed
              ? {
                  result: {
                    receiptId: claimed.receipt.id,
                    receiptStatus: "unknown",
                  },
                }
              : {}),
          },
        };
      }
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "unknown", {
          channel: "slack",
        });
      }
      logger.warn(
        { errorType: safeErrorType(err) },
        "elaine: Slack status is unknown; avoiding SMS fallback",
      );
      return {
        status: 202,
        body: {
          type: "message_contact",
          result: {
            channel: "slack",
            ...(claimed
              ? { receiptId: claimed.receipt.id, receiptStatus: "unknown" }
              : {}),
          },
        },
      };
    }
  }

  // ── SMS ───────────────────────────────────────────────────────────────────
  if (!contact.phoneNumber) {
    const channelHint =
      channel === "slack"
        ? `${name} has no Slack account linked.`
        : `${name} has no phone number or Slack account linked.`;
    return {
      status: 422,
      body: {
        error: `${channelHint} They can add these on their profile page.`,
      },
    };
  }
  if (!contact.phoneVerified) {
    return {
      status: 422,
      body: {
        error: `${name}'s phone number hasn't been verified yet. They need to verify it before SMS can be sent.`,
      },
    };
  }
  if (!contact.smsConsentAt) {
    return {
      status: 422,
      body: {
        error: `${name} hasn't given SMS consent. They can enable SMS notifications on their profile page.`,
      },
    };
  }
  if (contact.smsOptedOutAt) {
    return {
      status: 409,
      body: {
        error: `${name} has opted out of SMS. They can re-subscribe by texting START to the Batchelor App number.`,
      },
    };
  }

  if (!isAgentPhoneHealthy()) {
    return {
      status: 503,
      body: {
        error: `SMS is temporarily unavailable (AgentPhone service issue). Try Elaine chat or email instead.`,
      },
    };
  }

  const claimed = await claimCommunicationReceipt(
    receiptContext,
    contact.id,
    "sms",
  );
  if (claimed && !claimed.claimed) {
    return receiptDuplicateResult("message_contact", claimed);
  }
  try {
    await sendSms(contact.phoneNumber, message);
    if (claimed) {
      await finishCommunicationReceipt(claimed.receipt, "accepted", {
        channel: "sms",
      });
    }
    return {
      status: 200,
      body: {
        type: "message_contact",
        result: {
          channel: "sms",
          contactName: name,
          ...(claimed
            ? { receiptId: claimed.receipt.id, receiptStatus: "accepted" }
            : {}),
        },
      },
    };
  } catch (err) {
    if (err instanceof SmsOptedOutError) {
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "failed", {
          channel: "sms",
        });
      }
      return {
        status: 409,
        body: {
          error: `${name} has opted out of SMS. They can re-subscribe by texting START to the Batchelor App number.`,
        },
      };
    }
    if (err instanceof SmsRegistrationPendingError) {
      if (claimed) {
        await finishCommunicationReceipt(claimed.receipt, "failed", {
          channel: "sms",
        });
      }
      return {
        status: 503,
        body: {
          error:
            "SMS isn't fully enabled yet — carrier registration is still pending. Try again in a few days.",
        },
      };
    }
    logger.error(
      { errorType: safeErrorType(err) },
      "elaine: failed to send contact message",
    );
    if (claimed) {
      await finishCommunicationReceipt(claimed.receipt, "unknown", {
        channel: "sms",
      });
    }
    return {
      status: 500,
      body: {
        error: "Message status is unknown; check its receipt before retrying.",
        ...(claimed
          ? {
              result: {
                receiptId: claimed.receipt.id,
                receiptStatus: "unknown",
              },
            }
          : {}),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

type ActionExecutor = (
  payload: never,
  userId: number,
  context?: CommunicationReceiptContext,
) => Promise<{ status: number; body: unknown }>;

// Formats a Date for human-readable confirmation: "3:45 PM" or "Jan 15 at 3:45 PM"
// Exported for reuse by reminder-actions.ts's create_reminder confirmation
// message — keep this the single formatting implementation rather than
// duplicating it (see the "always consolidate" convention in replit.md).
//
// `timezone` MUST be the requesting user's own profile timezone (from
// getUserTimezone) — every caller must resolve and pass it. Without it,
// Intl falls back to the server process's local timezone, which has no
// relationship to where the user actually is: a user in Stuttgart could see
// a confirmation card rendered in whatever zone the container happens to run
// in (historically UTC), silently disagreeing with the time Elaine just
// confirmed in her reply text (see the JST/UTC/Stuttgart display-mismatch
// bug this parameter fixes).
export function formatScheduledTime(iso: string, timezone: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    // Compare calendar day in the USER'S timezone, not the server's — a
    // server-local "same day" check can disagree with what the user
    // actually sees once the instant is rendered in their own zone.
    const dayFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const sameDay = dayFmt.format(d) === dayFmt.format(now);
    if (sameDay) {
      return d.toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    return d.toLocaleString("en-US", {
      timeZone: timezone,
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
    receiptContext?: CommunicationReceiptContext,
  ) => {
    if (!(await claimProposalBeforeExecution(receiptContext))) {
      return {
        status: 409,
        body: { error: "This communication proposal has already been used." },
      };
    }
    if (payload.scheduleAt) {
      const tz = await resolveEffectiveTimezone(userId, payload.timezone);
      let scheduledFor: string;
      try {
        scheduledFor = resolveScheduleAt(payload.scheduleAt, tz);
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
      // Deferred — write a row to the generic reminders table (entityType
      // 'elaine_action') and return a confirmation. The unified reminder
      // delivery scheduler claims and fires this the same way it fires every
      // other reminder, calling fireCallContact as the delivery mechanism.
      const contact = await resolveContact(payload.contactName);
      const storedPayload = {
        contactName: payload.contactName,
        message: payload.message,
      };
      const duplicate = await findDuplicateScheduledReminder({
        userId,
        elaineActionType: "call_contact",
        contactName: payload.contactName,
        message: payload.message,
        dueAt: new Date(scheduledFor),
      });
      const scheduledReceipt = await claimCommunicationReceipt(
        receiptContext ? { ...receiptContext, status: "scheduled" } : undefined,
        contact?.id ?? null,
        "voice",
      );
      if (scheduledReceipt && !scheduledReceipt.claimed) {
        return {
          status: 200,
          body: {
            type: "call_contact",
            result: {
              channel: "voice",
              scheduled: true,
              scheduledActionId:
                scheduledReceipt.receipt.scheduledActionId ?? undefined,
              receiptId: scheduledReceipt.receipt.id,
              receiptStatus: scheduledReceipt.receipt.status,
              contactName: contact?.displayName ?? payload.contactName,
            },
          },
        };
      }
      const [row] = await db
        .insert(reminders)
        .values({
          entityType: "elaine_action",
          createdByUserId: userId,
          title: `Call ${contact?.displayName ?? payload.contactName}`,
          dueAt: new Date(scheduledFor),
          leadTimes: [{ value: 0, unit: "minutes" }],
          elaineActionType: "call_contact",
          elaineActionPayload: storedPayload,
        })
        .returning({ id: reminders.id });
      if (scheduledReceipt && row?.id) {
        await updateCommunicationReceipt(scheduledReceipt.receipt.id, {
          scheduledActionId: row.id,
        });
      }
      const formattedTime = formatScheduledTime(scheduledFor, tz);
      logger.info(
        {
          scheduledActionId: row?.id,
          scheduledFor,
          contactName: payload.contactName,
          duplicateOfReminderId: duplicate?.id,
        },
        duplicate
          ? "elaine: scheduled outbound call — near-duplicate of an existing reminder"
          : "elaine: scheduled outbound call",
      );
      return {
        status: 200,
        body: {
          type: "call_contact",
          result: {
            channel: "voice",
            scheduled: true,
            scheduledActionId: row?.id,
            ...(scheduledReceipt
              ? {
                  receiptId: scheduledReceipt.receipt.id,
                  receiptStatus: "scheduled",
                }
              : {}),
            scheduledFor,
            contactName: contact?.displayName ?? payload.contactName,
            ...(duplicate ? { duplicateOfReminderId: duplicate.id } : {}),
            confirmationMessage: `Got it — I'll call ${contact?.displayName ?? payload.contactName} at ${formattedTime}.${duplicate ? duplicateWarningClause(duplicate, tz) : ""}`,
          },
        },
      };
    }
    return fireCallContact(
      payload.contactName,
      payload.message,
      receiptContext,
    );
  }) as ActionExecutor,

  message_contact: (async (
    payload: z.infer<typeof MessageContactPayload>,
    userId: number,
    receiptContext?: CommunicationReceiptContext,
  ) => {
    if (!(await claimProposalBeforeExecution(receiptContext))) {
      return {
        status: 409,
        body: { error: "This communication proposal has already been used." },
      };
    }
    // Normalize contactName to an array so the rest of the executor is uniform.
    const names = Array.isArray(payload.contactName)
      ? payload.contactName
      : [payload.contactName];

    if (payload.scheduleAt) {
      const tz = await resolveEffectiveTimezone(userId, payload.timezone);
      let scheduledFor: string;
      try {
        scheduledFor = resolveScheduleAt(payload.scheduleAt, tz);
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
      // Deferred — write one reminders row per recipient (entityType
      // 'elaine_action') and return a summary.
      const formattedTime = formatScheduledTime(scheduledFor, tz);

      const rows = await Promise.all(
        names.map(async (name) => {
          const contact = await resolveContact(name);
          const scheduledReceipt = await claimCommunicationReceipt(
            receiptContext
              ? { ...receiptContext, status: "scheduled" }
              : undefined,
            contact?.id ?? null,
            payload.channel,
          );
          if (scheduledReceipt && !scheduledReceipt.claimed) {
            return {
              name: contact?.displayName ?? name,
              id: scheduledReceipt.receipt.scheduledActionId ?? undefined,
              duplicate: null,
              receiptId: scheduledReceipt.receipt.id,
              receiptStatus: scheduledReceipt.receipt.status,
              channel: payload.channel,
            };
          }
          const storedPayload = {
            contactName: name,
            message: payload.message,
            channel: payload.channel,
          };
          const duplicate = await findDuplicateScheduledReminder({
            userId,
            elaineActionType: "message_contact",
            contactName: name,
            message: payload.message,
            dueAt: new Date(scheduledFor),
          });
          const [row] = await db
            .insert(reminders)
            .values({
              entityType: "elaine_action",
              createdByUserId: userId,
              title: `Message ${contact?.displayName ?? name}`,
              dueAt: new Date(scheduledFor),
              leadTimes: [{ value: 0, unit: "minutes" }],
              elaineActionType: "message_contact",
              elaineActionPayload: storedPayload,
            })
            .returning({ id: reminders.id });
          if (scheduledReceipt && row?.id) {
            await updateCommunicationReceipt(scheduledReceipt.receipt.id, {
              scheduledActionId: row.id,
            });
          }
          logger.info(
            {
              scheduledActionId: row?.id,
              scheduledFor,
              contactName: name,
              duplicateOfReminderId: duplicate?.id,
            },
            duplicate
              ? "elaine: scheduled contact message — near-duplicate of an existing reminder"
              : "elaine: scheduled contact message",
          );
          return {
            name: contact?.displayName ?? name,
            id: row?.id,
            duplicate,
            receiptId: scheduledReceipt?.receipt.id,
            receiptStatus: scheduledReceipt ? "scheduled" : undefined,
            channel: payload.channel,
          };
        }),
      );

      const recipientList = rows.map((r) => r.name).join(", ");
      const duplicates = rows.filter(
        (r): r is typeof r & { duplicate: DuplicateReminderMatch } =>
          r.duplicate !== null,
      );
      const duplicateNote =
        duplicates.length === 0
          ? ""
          : duplicates.length === 1
            ? duplicateWarningClause(duplicates[0]!.duplicate, tz)
            : ` Heads up — some of these (${duplicates.map((d) => d.name).join(", ")}) already had a near-identical message scheduled moments ago (reminder #${duplicates.map((d) => d.duplicate.id).join(", #")}). I've left both in place for each; let me know if you'd like me to cancel any.`;
      return {
        status: 200,
        body: {
          type: "message_contact",
          result: {
            scheduled: true,
            scheduledActionIds: rows.map((r) => r.id),
            receipts: rows
              .filter((row) => row.receiptId)
              .map((row) => ({
                id: row.receiptId,
                status: row.receiptStatus,
                channel: row.channel,
              })),
            scheduledFor,
            recipients: rows.map((r) => r.name),
            ...(duplicates.length > 0
              ? {
                  duplicateOfReminderIds: duplicates.map((d) => d.duplicate.id),
                }
              : {}),
            confirmationMessage: `Got it — I'll message ${recipientList} at ${formattedTime}.${duplicateNote}`,
          },
        },
      };
    }

    // Immediate delivery — resolve all contacts concurrently then deliver.
    if (names.length === 1) {
      // Single recipient: return errors directly so Elaine can relay them.
      return fireMessageContact(
        names[0]!,
        payload.message,
        payload.channel,
        receiptContext,
      );
    }

    // Multi-recipient: fan out, collect per-recipient results.
    const recipientResults = await Promise.all(
      names.map(async (name) => {
        const contact = await resolveContact(name);
        if (!contact) {
          return {
            name,
            channel: null as string | null,
            ok: false,
            error: `No household member named "${name}" found.`,
            receiptId: undefined,
            receiptStatus: undefined,
            recipientUserId: undefined,
          };
        }
        const result = await fireMessageContactToResolved(
          contact,
          payload.message,
          payload.channel,
          name,
          receiptContext,
        );
        const resultBody = result.body as {
          error?: string;
          result?: {
            receiptId?: string;
            receiptStatus?: string;
            channel?: string;
          };
        } | null;
        const outcomeUnknown = resultBody?.result?.receiptStatus === "unknown";
        if (result.status >= 400 || outcomeUnknown) {
          return {
            name: contact.displayName ?? name,
            channel: null as string | null,
            ok: false,
            error: outcomeUnknown
              ? "The provider outcome is unknown; check its receipt before retrying."
              : (resultBody?.error ?? "Failed."),
            receiptId: resultBody?.result?.receiptId,
            receiptStatus: resultBody?.result?.receiptStatus,
            recipientUserId: contact.id,
          };
        }
        const body = resultBody;
        return {
          name: contact.displayName ?? name,
          channel: body?.result?.channel ?? null,
          ok: true,
          error: null as string | null,
          receiptId: body?.result?.receiptId,
          receiptStatus: body?.result?.receiptStatus,
          recipientUserId: contact.id,
        };
      }),
    );

    const delivered = recipientResults.filter((r) => r.ok);
    const failed = recipientResults.filter((r) => !r.ok);

    logger.info(
      { delivered: delivered.length, failed: failed.length },
      "elaine: multi-recipient message_contact completed",
    );

    const summaryLines = recipientResults.map((r) =>
      r.ok
        ? `  • ${r.name}: provider accepted via ${r.channel} ✓`
        : `  • ${r.name}: ${r.error} ✗`,
    );

    return {
      status: delivered.length > 0 ? 207 : 422,
      body: {
        type: "message_contact",
        result: {
          recipients: recipientResults,
          receipts: recipientResults
            .filter((result) => result.receiptId)
            .map((result) => ({
              id: result.receiptId,
              status: result.receiptStatus,
              recipientUserId: result.recipientUserId,
              channel: result.channel,
            })),
          confirmationMessage:
            `Message sent to ${delivered.length}/${recipientResults.length} recipient(s).\n` +
            summaryLines.join("\n"),
        },
      },
    };
  }) as ActionExecutor,

  continue_in_channel: (async (
    payload: z.infer<typeof ContinueInChannelPayload>,
    userId: number,
    receiptContext?: CommunicationReceiptContext,
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
      const claimed = await claimCommunicationReceipt(
        receiptContext,
        userId,
        "slack",
      );
      if (claimed && !claimed.claimed) {
        return receiptDuplicateResult("continue_in_channel", claimed);
      }
      try {
        const channelId = await openDmChannel(user.slackUserId);
        await postSlackMessage(channelId, message);
        if (claimed) {
          await finishCommunicationReceipt(claimed.receipt, "accepted", {
            channel: "slack",
          });
        }
        return {
          status: 200,
          body: {
            type: "continue_in_channel",
            result: {
              channel: "slack",
              sent: true,
              ...(claimed
                ? { receiptId: claimed.receipt.id, receiptStatus: "accepted" }
                : {}),
            },
          },
        };
      } catch (err) {
        logger.error(
          { errorType: safeErrorType(err) },
          "elaine: continue_in_channel slack send failed",
        );
        if (claimed) {
          await finishCommunicationReceipt(claimed.receipt, "unknown", {
            channel: "slack",
          });
        }
        return {
          status: 500,
          body: {
            error:
              "Slack message status is unknown; check its receipt before retrying.",
            ...(claimed
              ? {
                  result: {
                    receiptId: claimed.receipt.id,
                    receiptStatus: "unknown",
                  },
                }
              : {}),
          },
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
      const claimed = await claimCommunicationReceipt(
        receiptContext,
        userId,
        "sms",
      );
      if (claimed && !claimed.claimed) {
        return receiptDuplicateResult("continue_in_channel", claimed);
      }
      try {
        await sendSms(user.phoneNumber, message);
        if (claimed) {
          await finishCommunicationReceipt(claimed.receipt, "accepted", {
            channel: "sms",
          });
        }
        return {
          status: 200,
          body: {
            type: "continue_in_channel",
            result: {
              channel: "sms",
              sent: true,
              ...(claimed
                ? { receiptId: claimed.receipt.id, receiptStatus: "accepted" }
                : {}),
            },
          },
        };
      } catch (err) {
        if (err instanceof SmsOptedOutError) {
          if (claimed) {
            await finishCommunicationReceipt(claimed.receipt, "failed", {
              channel: "sms",
            });
          }
          return {
            status: 409,
            body: {
              error:
                "You've opted out of SMS. Text START to the Batchelor App number to re-subscribe.",
            },
          };
        }
        if (err instanceof SmsRegistrationPendingError) {
          if (claimed) {
            await finishCommunicationReceipt(claimed.receipt, "failed", {
              channel: "sms",
            });
          }
          return {
            status: 503,
            body: {
              error:
                "SMS isn't fully enabled yet — carrier registration is pending. Try again in a few days.",
            },
          };
        }
        logger.error(
          { errorType: safeErrorType(err) },
          "elaine: continue_in_channel sms send failed",
        );
        if (claimed) {
          await finishCommunicationReceipt(claimed.receipt, "unknown", {
            channel: "sms",
          });
        }
        return {
          status: 500,
          body: {
            error: "SMS status is unknown; check its receipt before retrying.",
            ...(claimed
              ? {
                  result: {
                    receiptId: claimed.receipt.id,
                    receiptStatus: "unknown",
                  },
                }
              : {}),
          },
        };
      }
    }

    if (targetChannel === "email") {
      const claimed = await claimCommunicationReceipt(
        receiptContext,
        userId,
        "email",
      );
      if (claimed && !claimed.claimed) {
        return receiptDuplicateResult("continue_in_channel", claimed);
      }
      try {
        await sendAssistantEmail(
          user.email,
          "From Elaine — continued conversation",
          message,
        );
        if (claimed) {
          await finishCommunicationReceipt(claimed.receipt, "accepted", {
            channel: "email",
          });
        }
        return {
          status: 200,
          body: {
            type: "continue_in_channel",
            result: {
              channel: "email",
              sent: true,
              ...(claimed
                ? { receiptId: claimed.receipt.id, receiptStatus: "accepted" }
                : {}),
            },
          },
        };
      } catch (err) {
        logger.error(
          { errorType: safeErrorType(err) },
          "elaine: continue_in_channel email send failed",
        );
        if (claimed) {
          await finishCommunicationReceipt(claimed.receipt, "unknown", {
            channel: "email",
          });
        }
        return {
          status: 500,
          body: {
            error:
              "Email status is unknown; check its receipt before retrying.",
            ...(claimed
              ? {
                  result: {
                    receiptId: claimed.receipt.id,
                    receiptStatus: "unknown",
                  },
                }
              : {}),
          },
        };
      }
    }

    return { status: 400, body: { error: "Unknown target channel." } };
  }) as ActionExecutor,

  broadcast_message: (async (
    payload: z.infer<typeof BroadcastMessagePayload>,
    userId: number,
    receiptContext?: CommunicationReceiptContext,
  ) => {
    // Rate-limit check first — inserts a log row if allowed, queries count if not.
    const rateCheck = await checkBroadcastRateLimit(userId);
    if (!rateCheck.allowed) {
      return {
        status: 429,
        body: {
          error: `You've sent 3 broadcasts in the last hour. You can send another in about ${rateCheck.resetInMinutes} minute${rateCheck.resetInMinutes === 1 ? "" : "s"}.`,
        },
      };
    }
    if (!(await claimProposalBeforeExecution(receiptContext))) {
      return {
        status: 409,
        body: { error: "This communication proposal has already been used." },
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
    const receiptOutcomes: Array<{
      receiptId: string;
      channel: string;
      status: string;
    }> = [];

    const channelAvailable = {
      slack: slackConfigured() && Boolean(user.slackUserId),
      sms:
        Boolean(user.phoneNumber) &&
        user.phoneVerified &&
        Boolean(user.smsConsentAt) &&
        !user.smsOptedOutAt,
      email: resendConfigured(),
    };
    let channelsToDispatch = Object.entries(channelAvailable)
      .filter(([, available]) => available)
      .map(([channel]) => channel);
    if (receiptContext?.acknowledgeRepeat) {
      const acknowledgedReceipt = await findRecentCommunicationReceiptById({
        ownerUserId: userId,
        recipientUserId: userId,
        receiptId: receiptContext.acknowledgeRepeat,
      });
      if (
        !acknowledgedReceipt ||
        !channelAvailable[
          acknowledgedReceipt.channel as keyof typeof channelAvailable
        ]
      ) {
        throw new StaleRepeatAcknowledgementError();
      }
      // A broadcast repeat confirmation authorizes only the acknowledged
      // recipient/channel pair. In particular, don't send to a newly available
      // channel merely because the same proposal is being replayed.
      channelsToDispatch = [acknowledgedReceipt.channel];
    } else if (receiptContext?.proposalClaimKey) {
      const recentReceipts =
        await listRecentCommunicationReceiptsForRecipientChannels({
          ownerUserId: userId,
          recipientUserId: userId,
          channels: channelsToDispatch,
        });
      if (recentReceipts[0]) {
        throw new RepeatConfirmationRequiredError(
          recentReceipts[0].id,
          recentReceipts[0].status,
        );
      }
    }

    const stagedClaims = new Map<
      string,
      Awaited<ReturnType<typeof claimCommunicationReceipt>>
    >();
    const stagedReceiptIds: string[] = [];
    try {
      for (const channel of channelsToDispatch) {
        const claim = await claimCommunicationReceipt(
          receiptContext
            ? { ...receiptContext, onClaimed: undefined }
            : undefined,
          userId,
          channel,
        );
        stagedClaims.set(channel, claim);
        if (claim?.claimed) stagedReceiptIds.push(claim.receipt.id);
      }
    } catch (err) {
      await removeUnstartedCommunicationReceipts(stagedReceiptIds);
      throw err;
    }
    for (const claim of stagedClaims.values()) {
      if (claim?.claimed && receiptContext?.onClaimed) {
        receiptContext.onClaimed({
          id: claim.receipt.id,
          actionType: claim.receipt.actionType,
          channel: claim.receipt.channel,
          status: claim.receipt.status,
          conversationId: claim.receipt.conversationId,
        });
      }
    }

    // Fan out concurrently to all configured channels.
    await Promise.all([
      // --- Slack ---
      (async () => {
        if (!slackConfigured() || !user.slackUserId) {
          skipped.push("Slack (not connected)");
          return;
        }
        if (!channelsToDispatch.includes("slack")) {
          skipped.push("Slack (repeat not acknowledged)");
          return;
        }
        const claimed = stagedClaims.get("slack") ?? null;
        if (claimed && !claimed.claimed) {
          receiptOutcomes.push({
            receiptId: claimed.receipt.id,
            channel: "slack",
            status: claimed.receipt.status,
          });
          results.push(`Slack (${claimed.receipt.status})`);
          return;
        }
        try {
          const channelId = await openDmChannel(user.slackUserId);
          await postSlackMessage(channelId, message);
          if (claimed) {
            await finishCommunicationReceipt(claimed.receipt, "accepted", {
              channel: "slack",
            });
            receiptOutcomes.push({
              receiptId: claimed.receipt.id,
              channel: "slack",
              status: "accepted",
            });
          }
          results.push("Slack ✓");
        } catch (err) {
          logger.warn(
            { errorType: safeErrorType(err), userId },
            "elaine: broadcast Slack DM failed",
          );
          if (claimed) {
            await finishCommunicationReceipt(claimed.receipt, "unknown", {
              channel: "slack",
            });
            receiptOutcomes.push({
              receiptId: claimed.receipt.id,
              channel: "slack",
              status: "unknown",
            });
          }
          results.push("Slack ? (status unknown)");
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
        if (!channelsToDispatch.includes("sms")) {
          skipped.push("SMS (repeat not acknowledged)");
          return;
        }
        const claimed = stagedClaims.get("sms") ?? null;
        if (claimed && !claimed.claimed) {
          receiptOutcomes.push({
            receiptId: claimed.receipt.id,
            channel: "sms",
            status: claimed.receipt.status,
          });
          results.push(`SMS (${claimed.receipt.status})`);
          return;
        }
        try {
          await sendSms(user.phoneNumber, message);
          if (claimed) {
            await finishCommunicationReceipt(claimed.receipt, "accepted", {
              channel: "sms",
            });
            receiptOutcomes.push({
              receiptId: claimed.receipt.id,
              channel: "sms",
              status: "accepted",
            });
          }
          results.push("SMS ✓");
        } catch (err) {
          if (err instanceof SmsOptedOutError) {
            if (claimed) {
              await finishCommunicationReceipt(claimed.receipt, "failed", {
                channel: "sms",
              });
              receiptOutcomes.push({
                receiptId: claimed.receipt.id,
                channel: "sms",
                status: "failed",
              });
            }
            skipped.push("SMS (opted out)");
          } else if (err instanceof SmsRegistrationPendingError) {
            if (claimed) {
              await finishCommunicationReceipt(claimed.receipt, "failed", {
                channel: "sms",
              });
              receiptOutcomes.push({
                receiptId: claimed.receipt.id,
                channel: "sms",
                status: "failed",
              });
            }
            skipped.push("SMS (carrier registration pending)");
          } else {
            logger.warn(
              { errorType: safeErrorType(err), userId },
              "elaine: broadcast SMS failed",
            );
            if (claimed) {
              await finishCommunicationReceipt(claimed.receipt, "unknown", {
                channel: "sms",
              });
              receiptOutcomes.push({
                receiptId: claimed.receipt.id,
                channel: "sms",
                status: "unknown",
              });
            }
            results.push("SMS ? (status unknown)");
          }
        }
      })(),

      // --- Email ---
      (async () => {
        if (!resendConfigured()) {
          skipped.push("Email (not configured)");
          return;
        }
        if (!channelsToDispatch.includes("email")) {
          skipped.push("Email (repeat not acknowledged)");
          return;
        }
        const claimed = stagedClaims.get("email") ?? null;
        if (claimed && !claimed.claimed) {
          receiptOutcomes.push({
            receiptId: claimed.receipt.id,
            channel: "email",
            status: claimed.receipt.status,
          });
          results.push(`Email (${claimed.receipt.status})`);
          return;
        }
        try {
          await sendAssistantEmail(
            user.email,
            "From Elaine — broadcast message",
            message,
          );
          if (claimed) {
            await finishCommunicationReceipt(claimed.receipt, "accepted", {
              channel: "email",
            });
            receiptOutcomes.push({
              receiptId: claimed.receipt.id,
              channel: "email",
              status: "accepted",
            });
          }
          results.push("Email ✓");
        } catch (err) {
          logger.warn(
            { errorType: safeErrorType(err), userId },
            "elaine: broadcast email failed",
          );
          if (claimed) {
            await finishCommunicationReceipt(claimed.receipt, "unknown", {
              channel: "email",
            });
            receiptOutcomes.push({
              receiptId: claimed.receipt.id,
              channel: "email",
              status: "unknown",
            });
          }
          results.push("Email ? (status unknown)");
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
          ...(receiptOutcomes.length > 0
            ? { result: { receipts: receiptOutcomes } }
            : {}),
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
          receipts: receiptOutcomes,
          confirmationMessage: `Sent to ${sentSummary}${skippedNote}.`,
        },
      },
    };
  }) as ActionExecutor,

  call_me: (async (
    payload: z.infer<typeof CallMePayload>,
    userId: number,
    receiptContext?: CommunicationReceiptContext,
  ) => {
    if (payload.scheduleAt) {
      const tz = await resolveEffectiveTimezone(userId, payload.timezone);
      let scheduledFor: string;
      try {
        scheduledFor = resolveScheduleAt(payload.scheduleAt, tz);
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
      // Deferred — write a row to the generic reminders table (entityType
      // 'elaine_action'), same pattern as scheduled call_contact/
      // message_contact. The scheduler re-runs the full phone-number/
      // verification/opt-out checks via fireCallMe at fire time, not just
      // now — see dispatchElaineActionReminder in reminders-scheduler.ts.
      const storedPayload = { greeting: payload.greeting };
      const scheduledReceipt = await claimCommunicationReceipt(
        receiptContext ? { ...receiptContext, status: "scheduled" } : undefined,
        userId,
        "voice",
      );
      if (scheduledReceipt && !scheduledReceipt.claimed) {
        return {
          status: 200,
          body: {
            type: "call_me",
            result: {
              channel: "voice",
              scheduled: true,
              scheduledActionId:
                scheduledReceipt.receipt.scheduledActionId ?? undefined,
              receiptId: scheduledReceipt.receipt.id,
              receiptStatus: scheduledReceipt.receipt.status,
            },
          },
        };
      }
      const [row] = await db
        .insert(reminders)
        .values({
          entityType: "elaine_action",
          createdByUserId: userId,
          title: "Call me back",
          dueAt: new Date(scheduledFor),
          leadTimes: [{ value: 0, unit: "minutes" }],
          elaineActionType: "call_me",
          elaineActionPayload: storedPayload,
        })
        .returning({ id: reminders.id });
      if (scheduledReceipt && row?.id) {
        await updateCommunicationReceipt(scheduledReceipt.receipt.id, {
          scheduledActionId: row.id,
        });
      }
      const formattedTime = formatScheduledTime(scheduledFor, tz);
      logger.info(
        { scheduledActionId: row?.id, scheduledFor, userId },
        "elaine: scheduled self-callback call",
      );
      return {
        status: 200,
        body: {
          type: "call_me",
          result: {
            channel: "voice",
            scheduled: true,
            scheduledActionId: row?.id,
            ...(scheduledReceipt
              ? {
                  receiptId: scheduledReceipt.receipt.id,
                  receiptStatus: "scheduled",
                }
              : {}),
            scheduledFor,
            confirmationMessage: `Got it — I'll call you at ${formattedTime}.`,
          },
        },
      };
    }
    return fireCallMe(userId, payload.greeting, receiptContext);
  }) as ActionExecutor,

  cancel_scheduled_contact: (async (
    payload: z.infer<typeof CancelScheduledContactPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({
        id: reminders.id,
        status: reminders.status,
        elaineActionType: reminders.elaineActionType,
        elaineActionPayload: reminders.elaineActionPayload,
        dueAt: reminders.dueAt,
      })
      .from(reminders)
      .where(
        and(
          eq(reminders.id, payload.scheduledActionId),
          eq(reminders.createdByUserId, userId),
          eq(reminders.entityType, "elaine_action"),
        ),
      );

    if (!existing) {
      return {
        status: 404,
        body: { error: "Scheduled contact not found." },
      };
    }
    if (existing.status !== "active") {
      return {
        status: 409,
        body: {
          error: `This scheduled contact has already been ${existing.status === "done" ? "delivered" : existing.status} and can't be cancelled.`,
        },
      };
    }

    // Atomic cancel: include user + status guard in WHERE so that if the
    // scheduler fires the row between our read and our write, we detect the
    // race instead of silently overwriting "done" with "cancelled".
    const [cancelled] = await db
      .update(reminders)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(reminders.id, payload.scheduledActionId),
          eq(reminders.createdByUserId, userId),
          eq(reminders.entityType, "elaine_action"),
          eq(reminders.status, "active"),
        ),
      )
      .returning({ id: reminders.id });

    if (!cancelled) {
      return {
        status: 409,
        body: {
          error:
            "This scheduled contact could not be cancelled — it may have just fired. Check your call or message history.",
        },
      };
    }

    await cancelScheduledCommunicationReceipts(
      payload.scheduledActionId,
      userId,
    );

    const { contactName } = describeScheduledElaineAction(
      existing.elaineActionType,
      existing.elaineActionPayload,
    );
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
          contactName,
        },
      },
    };
  }) as ActionExecutor,
};

// ---------------------------------------------------------------------------
// Shared display helper for a scheduled `elaine_action` reminder — used by
// both list_scheduled_contacts and cancel_scheduled_contact so the two
// surfaces describe the same row identically. `call_me` has no contactName
// in its stored payload (it's always the requesting user themselves), so it
// gets its own branch rather than falling into the "unknown" default.
// ---------------------------------------------------------------------------

function describeScheduledElaineAction(
  actionType: string | null,
  payload: unknown,
): { label: string; contactName: string } {
  const p = (payload ?? {}) as {
    contactName?: string;
    channel?: string;
  } | null;
  if (actionType === "call_me") {
    return { label: "Call you back", contactName: "you" };
  }
  if (actionType === "message_contact") {
    const via = p?.channel && p.channel !== "auto" ? ` via ${p.channel}` : "";
    const who = p?.contactName ?? "unknown";
    return { label: `Message ${who}${via}`, contactName: who };
  }
  // call_contact and any unrecognized future type — default to the
  // call_contact-style "Call {name}" label.
  const who = p?.contactName ?? "unknown";
  return { label: `Call ${who}`, contactName: who };
}

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
      id: reminders.id,
      actionType: reminders.elaineActionType,
      actionPayload: reminders.elaineActionPayload,
      scheduledFor: reminders.dueAt,
      status: reminders.status,
    })
    .from(reminders)
    .where(
      and(
        eq(reminders.createdByUserId, userId),
        eq(reminders.entityType, "elaine_action"),
        eq(reminders.status, "active"),
      ),
    )
    .orderBy(reminders.dueAt);

  if (rows.length === 0) {
    return "No pending scheduled calls or messages.";
  }

  const lines = rows.map((r) => {
    const when = r.scheduledFor
      ? new Date(r.scheduledFor).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "unknown time";
    const { label } = describeScheduledElaineAction(
      r.actionType,
      r.actionPayload,
    );
    return `• [#${r.id}] ${label} at ${when}`;
  });

  return `Pending scheduled contacts (${rows.length}):\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Soft-tool: list_contact_channels — returns which channels are available for
// a named household member right now. Used by Elaine to present options when
// the user doesn't specify a channel, instead of picking silently.
// ---------------------------------------------------------------------------

export const LIST_CONTACT_CHANNELS_TOOL_NAME = "list_contact_channels";

export async function executeListContactChannels(
  contactName: string,
): Promise<string> {
  const contact = await resolveContact(contactName);
  if (!contact) {
    return `No household member named "${contactName}" found. Check the spelling or try a partial name.`;
  }

  const { available, unavailable } = await resolveContactChannels(contact);
  const name = contact.displayName ?? contactName;
  const lines: string[] = [
    `Available channels for ${name} right now:`,
    ...available.map((ch) => `  • ${contactChannelLabel(ch, contact)}`),
  ];

  if (unavailable.length > 0) {
    lines.push(`Not available:`);
    for (const { channel, reason } of unavailable) {
      lines.push(`  • ${channel}: ${reason}`);
    }
  }

  lines.push(
    `\nYou can use these channel names in message_contact or call_contact: ${available.join(", ")}`,
  );

  return lines.join("\n");
}

export const listContactChannelsTool: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: LIST_CONTACT_CHANNELS_TOOL_NAME,
      description:
        "Look up which communication channels are available for a household member right now. " +
        "Call this BEFORE message_contact or call_contact whenever the user has NOT specified a channel " +
        "(e.g. 'tell User B X', 'contact User B about Y'). " +
        "Returns the available channels (elaine_chat, slack, sms, email, voice) with masked contact details, " +
        "plus a list of unavailable channels and reasons. " +
        "After getting this result, ask the user which channel they prefer — list only the available ones. " +
        "Do NOT call this when the user has explicitly named a channel ('SMS User B', 'email User B', etc.).",
      parameters: {
        type: "object",
        properties: {
          contactName: {
            type: "string",
            description:
              "First name (or full name) of the household member to look up.",
          },
        },
        required: ["contactName"],
      },
    },
  };

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

// Formats a scheduleAt field (exact ISO string OR a RelativeTimeSpec) for the
// pre-confirm label card using `tz`. For a RelativeTimeSpec this actually
// resolves it (resolveRelativeTime is pure/synchronous) rather than showing a
// generic "the resolved time" placeholder — so the card the user approves
// shows the SAME computed time the executor will confirm a moment later, in
// the same effective timezone. Falls back to a placeholder only if resolution
// throws (surfaced properly as an error once the user actually confirms).
function describeScheduledTime(
  scheduleAt: string | RelativeTimeSpec,
  tz: string,
): string {
  if (typeof scheduleAt === "string")
    return formatScheduledTime(normalizeExactIsoForDisplay(scheduleAt, tz), tz);
  try {
    return formatScheduledTime(
      resolveRelativeTime(scheduleAt, tz).toISOString(),
      tz,
    );
  } catch {
    return "the resolved time";
  }
}

export async function buildCommunicationActionLabel(
  action: {
    type: CommunicationActionType;
    payload: unknown;
  },
  userId: number,
): Promise<string> {
  switch (action.type) {
    case "call_contact": {
      const payload = CallContactPayload.parse(action.payload);
      if (payload.scheduleAt) {
        const tz = await resolveEffectiveTimezone(userId, payload.timezone);
        const when = describeScheduledTime(payload.scheduleAt, tz);
        return `Schedule a call to ${payload.contactName} at ${when}`;
      }
      return `Call ${payload.contactName}`;
    }
    case "message_contact": {
      const payload = MessageContactPayload.parse(action.payload);
      const names = Array.isArray(payload.contactName)
        ? payload.contactName
        : [payload.contactName];
      const recipientStr =
        names.length === 1
          ? names[0]!
          : names.slice(0, -1).join(", ") + ` and ${names[names.length - 1]}`;
      const via = payload.channel !== "auto" ? ` via ${payload.channel}` : "";
      if (payload.scheduleAt) {
        const tz = await resolveEffectiveTimezone(userId, payload.timezone);
        const when = describeScheduledTime(payload.scheduleAt, tz);
        return `Schedule a message to ${recipientStr}${via} at ${when}`;
      }
      return `Message ${recipientStr}${via}`;
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
      const payload = CallMePayload.parse(action.payload);
      if (payload.scheduleAt) {
        const tz = await resolveEffectiveTimezone(userId, payload.timezone);
        const when = describeScheduledTime(payload.scheduleAt, tz);
        return `Schedule a call-back at ${when}`;
      }
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
          "If the user wants the call at a future time, include `scheduleAt` — either an exact ISO 8601 datetime, or (STRONGLY preferred, including for a bare clock time like 'at 3:45pm' with no explicit day) the structured relative-time spec described on that field; never hand-compute the datetime (or its UTC offset) yourself. " +
          "Only include `timezone` when the user explicitly names a different timezone/city for this call than their own (see that field's description) — omit it otherwise. " +
          "When scheduling: confirm the resolved time in your visible reply before calling this tool. " +
          "After the tool returns, the result includes a `callStatus` field — incorporate it naturally: " +
          "'answered' → 'I called [name] — they answered.'; " +
          "'voicemail' → 'I called [name] — went to voicemail.'; " +
          "'no-answer' → 'I called [name] — no answer.'; " +
          "'error' → 'I tried calling [name] but the call failed.'; " +
          "'pending' → 'Call initiated — I'll let you know if there's an issue.'",
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
              oneOf: [
                {
                  type: "string",
                  description:
                    "Exact ISO 8601 datetime to fire the call at (e.g. '2026-08-01T15:45:00+02:00').",
                },
                RELATIVE_TIME_SPEC_JSON_SCHEMA,
              ],
              description:
                "Optional. Omit to call immediately. Otherwise either an exact ISO datetime or a relative-time spec — strongly prefer the relative-time spec, including its at-clock-time kind for a bare time of day.",
            },
            timezone: EXPLICIT_TIMEZONE_JSON_SCHEMA,
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
          "Propose sending a message to one or more household members. " +
          "CRITICAL — write `message` in FIRST PERSON as exactly what Elaine sends. Do NOT attribute the message to the requester. " +
          "WRONG: 'Jonathan wants you to know dinner is at 7.' " +
          "RIGHT: 'Dinner is at 7 tonight, don\\'t forget!' " +
          "Channels available: 'auto' (Slack→SMS fallback), 'slack', 'sms', 'email', 'elaine_chat' (appears in their Elaine chat widget / main Elaine page in the Batchelor app). " +
          "IMPORTANT: if the user hasn't specified a channel, call list_contact_channels first to see what's available, then ask which they prefer. " +
          "For multi-recipient ('tell B, C, and D'), pass an array in contactName. " +
          "Confirm contact(s) and message wording before proposing. " +
          "If the user wants the message at a future time, include `scheduleAt` — either an exact ISO 8601 datetime, or (STRONGLY preferred, including for a bare clock time like 'at 3:45pm' with no explicit day) the structured relative-time spec described on that field; never hand-compute the datetime (or its UTC offset) yourself. " +
          "Only include `timezone` when the user explicitly names a different timezone/city for this message than their own (see that field's description) — omit it otherwise. " +
          "When scheduling: confirm the resolved time in your visible reply before calling this tool.",
        parameters: {
          type: "object",
          properties: {
            contactName: {
              oneOf: [
                {
                  type: "string",
                  description:
                    "First name (or full name) of the single household member to message.",
                },
                {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "List of household member names for multi-recipient fanout (e.g. ['Alice', 'Bob', 'Carol']).",
                },
              ],
              description:
                "Recipient name(s). Use an array for multiple recipients.",
            },
            message: {
              type: "string",
              description:
                "The message text — first person, direct, no attribution to anyone.",
            },
            channel: {
              type: "string",
              enum: [...MESSAGE_CONTACT_CHANNEL_ENUM],
              description:
                "'auto' uses Slack if available, then SMS. 'elaine_chat' writes to their Elaine chat widget. Only specify when the user explicitly requests a channel; otherwise call list_contact_channels first.",
            },
            scheduleAt: {
              oneOf: [
                {
                  type: "string",
                  description:
                    "Exact ISO 8601 datetime to send the message at.",
                },
                RELATIVE_TIME_SPEC_JSON_SCHEMA,
              ],
              description:
                "Optional. Omit to send immediately. Otherwise either an exact ISO datetime or a relative-time spec — strongly prefer the relative-time spec, including its at-clock-time kind for a bare time of day.",
            },
            timezone: EXPLICIT_TIMEZONE_JSON_SCHEMA,
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
              enum: [...CONTINUE_IN_CHANNEL_ENUM],
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
          "'I'd rather talk — call my phone', 'I'm driving, call me', or any similar request — " +
          "whether they want the call right now or at a future time. " +
          "This calls THE SAME USER who is chatting, never another household member — use call_contact for that. " +
          "Available on web and SMS channels. NOT available over email. " +
          "If the user wants the call at a future time (e.g. 'call me at 2:30', 'call me in an hour', " +
          "'call me tomorrow morning and remind me to X'), include `scheduleAt` — either an exact ISO 8601 " +
          "datetime, or (STRONGLY preferred, including for a bare clock time like 'call me at 2:30' with no " +
          "explicit day — use the at-clock-time spec kind) the structured relative-time spec described on that " +
          "field; never hand-compute the datetime (or its UTC offset) yourself. Put any reminder content the " +
          "user wants ('remind me to pick up X') into `greeting` so Elaine says it after the recipient first speaks. " +
          "Only include `timezone` when the user explicitly names a different timezone/city for this call than " +
          "their own (see that field's description) — omit it otherwise. " +
          "When scheduling: confirm the resolved time in your visible reply before calling this tool. " +
          "After proposing, confirm in your reply that Elaine is calling them (now, or at the scheduled time). " +
          "If they have no verified phone number, the executor returns an error message you should relay.",
        parameters: {
          type: "object",
          properties: {
            greeting: {
              type: "string",
              description:
                "Optional opening words Elaine says after the recipient first speaks (1–2 warm sentences). Omit to use the default introduction.",
            },
            scheduleAt: {
              oneOf: [
                {
                  type: "string",
                  description:
                    "Exact ISO 8601 datetime to fire the call at (e.g. '2026-08-01T15:45:00+02:00').",
                },
                RELATIVE_TIME_SPEC_JSON_SCHEMA,
              ],
              description:
                "Optional. Omit to call immediately. Otherwise either an exact ISO datetime or a relative-time spec — strongly prefer the relative-time spec, including its at-clock-time kind for a bare time of day.",
            },
            timezone: EXPLICIT_TIMEZONE_JSON_SCHEMA,
          },
          required: [],
        },
      },
    },
  ];

async function findDuplicateScheduledReminder(params: {
  userId: number;
  elaineActionType: "call_contact" | "message_contact";
  contactName: string;
  message: string;
  dueAt: Date;
}): Promise<DuplicateReminderMatch | null> {
  const { userId, elaineActionType, contactName, message, dueAt } = params;
  const windowStart = new Date(dueAt.getTime() - DUPLICATE_DUE_WINDOW_MS);
  const windowEnd = new Date(dueAt.getTime() + DUPLICATE_DUE_WINDOW_MS);
  const createdAfter = new Date(Date.now() - DUPLICATE_LOOKBACK_MS);
  const [match] = await db
    .select({ id: reminders.id, dueAt: reminders.dueAt })
    .from(reminders)
    .where(
      and(
        eq(reminders.entityType, "elaine_action"),
        eq(reminders.elaineActionType, elaineActionType),
        eq(reminders.createdByUserId, userId),
        eq(reminders.status, "active"),
        isNull(reminders.deletedAt),
        gt(reminders.createdAt, createdAfter),
        sql`${reminders.dueAt} between ${windowStart} and ${windowEnd}`,
        sql`${reminders.elaineActionPayload} ->> 'contactName' = ${contactName}`,
        sql`${reminders.elaineActionPayload} ->> 'message' = ${message}`,
      ),
    )
    .limit(1);
  return match?.dueAt ? { id: match.id, dueAt: match.dueAt } : null;
}

interface DuplicateReminderMatch {
  id: number;
  dueAt: Date;
}

/** Short, user-facing clause appended to a scheduling confirmation when
 * findDuplicateScheduledReminder found a near-identical reminder already
 * scheduled moments ago — points the user at both list_scheduled_contacts
 * and cancel_scheduled_contact so they can resolve it themselves rather than
 * Elaine silently guessing which one (if either) to remove. */
function duplicateWarningClause(
  duplicate: DuplicateReminderMatch,
  timezone: string,
): string {
  return ` Heads up — you already had a near-identical one scheduled for ${formatScheduledTime(duplicate.dueAt.toISOString(), timezone)} (reminder #${duplicate.id}). I've left both in place; let me know if you'd like me to cancel one.`;
}

const DUPLICATE_LOOKBACK_MS = 2 * 60 * 60 * 1000;
