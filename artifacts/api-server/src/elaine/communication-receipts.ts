import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db, elaineCommunicationReceipts } from "@workspace/db";

export const COMMUNICATION_RECEIPT_STATUSES = [
  "executing",
  "accepted",
  "completed",
  "failed",
  "unknown",
  "scheduled",
  "cancelled",
] as const;
export type CommunicationReceiptStatus =
  (typeof COMMUNICATION_RECEIPT_STATUSES)[number];

const RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_COMMUNICATION_REPEAT_WINDOW_MS = 30 * 60 * 1000;
const REPEAT_CONFIRMATION_STATUSES = [
  "executing",
  "accepted",
  "unknown",
] as const;

export interface CommunicationProposalClaims {
  key: string;
  ownerUserId: number;
  actionType: string;
  payloadHash: string;
  expiresAt: number;
  conversationId?: number | null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function communicationPayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export async function createScheduledCommunicationReceiptContext(params: {
  scheduledActionId: number;
  deliveryId: number;
  ownerUserId: number;
  actionType: string;
  payload: unknown;
  secret: string;
}): Promise<{
  attemptKey: string;
  attemptKeyIsFinal: true;
  payloadHash: string;
  ownerUserId: number;
  actionType: string;
  conversationId: number | null;
  scheduledActionId: number;
}> {
  const [scheduledReceipt] = await db
    .select({
      attemptKey: elaineCommunicationReceipts.attemptKey,
      payloadHash: elaineCommunicationReceipts.payloadHash,
      conversationId: elaineCommunicationReceipts.conversationId,
    })
    .from(elaineCommunicationReceipts)
    .where(
      and(
        eq(
          elaineCommunicationReceipts.scheduledActionId,
          params.scheduledActionId,
        ),
        eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
        eq(elaineCommunicationReceipts.actionType, params.actionType),
      ),
    )
    .limit(1);
  const attemptKey = createHmac("sha256", params.secret)
    .update(
      `elaine-scheduled-communication:${params.ownerUserId}:${params.scheduledActionId}:${params.deliveryId}:${params.actionType}`,
    )
    .digest("hex");
  return {
    attemptKey: scheduledReceipt?.attemptKey ?? attemptKey,
    attemptKeyIsFinal: true,
    payloadHash:
      scheduledReceipt?.payloadHash ?? communicationPayloadHash(params.payload),
    ownerUserId: params.ownerUserId,
    actionType: params.actionType,
    conversationId: scheduledReceipt?.conversationId ?? null,
    scheduledActionId: params.scheduledActionId,
  };
}

/**
 * Stable key for one restricted-channel turn's communication proposals.
 * Never derived from message text/history: a recurring request (same text,
 * same recent exchange) would collide with an earlier, already-claimed
 * proposal and be suppressed. Without an inbound identity, fall back to a
 * unique key — losing redelivery dedupe is safer than blocking a new request.
 */
export function restrictedCommunicationTurnId(params: {
  userId: number;
  channelLabel: string;
  inboundMessageId?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        userId: params.userId,
        channelLabel: params.channelLabel,
        inboundMessageId: params.inboundMessageId ?? randomUUID(),
      }),
    )
    .digest("hex");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Mint an opaque server-issued proposal token. Auto-run callers may provide a
 * deterministic stableKey derived from their turn/tool-call identity.
 */
export function createCommunicationProposalId(params: {
  ownerUserId: number;
  actionType: string;
  payload: unknown;
  secret: string;
  stableKey?: string;
  conversationId?: number | null;
  now?: number;
}): string {
  const claims: CommunicationProposalClaims = {
    key: params.stableKey
      ? createHmac("sha256", params.secret)
          .update(`elaine-communication:${params.stableKey}`)
          .digest("hex")
      : randomUUID(),
    ownerUserId: params.ownerUserId,
    actionType: params.actionType,
    payloadHash: communicationPayloadHash(params.payload),
    expiresAt: (params.now ?? Date.now()) + PROPOSAL_TTL_MS,
    ...(params.conversationId !== undefined
      ? { conversationId: params.conversationId }
      : {}),
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${sign(encoded, params.secret)}`;
}

export function verifyCommunicationProposalId(params: {
  proposalId: string;
  ownerUserId: number;
  actionType: string;
  payload: unknown;
  conversationId?: number | null;
  secret: string;
  now?: number;
}): CommunicationProposalClaims | null {
  const [encoded, providedSignature, extra] = params.proposalId.split(".");
  if (!encoded || !providedSignature || extra !== undefined) return null;
  const expected = sign(encoded, params.secret);
  const providedBytes = Buffer.from(providedSignature);
  const expectedBytes = Buffer.from(expected);
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as CommunicationProposalClaims;
    if (
      !claims.key ||
      claims.ownerUserId !== params.ownerUserId ||
      claims.actionType !== params.actionType ||
      claims.payloadHash !== communicationPayloadHash(params.payload) ||
      (params.conversationId !== undefined &&
        claims.conversationId !== params.conversationId) ||
      !Number.isFinite(claims.expiresAt) ||
      claims.expiresAt < (params.now ?? Date.now())
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export async function createOrReadCommunicationReceipt(params: {
  attemptKey: string;
  payloadHash: string;
  ownerUserId: number;
  actionType: string;
  channel: string;
  status?: CommunicationReceiptStatus;
  conversationId: number | null;
  recipientUserId: number | null;
  scheduledActionId?: number | null;
}): Promise<{
  receipt: typeof elaineCommunicationReceipts.$inferSelect;
  claimed: boolean;
}> {
  if (params.scheduledActionId != null) {
    const [scheduledReceipt] = await db
      .update(elaineCommunicationReceipts)
      .set({
        status: params.status ?? "executing",
        recipientUserId: params.recipientUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(
            elaineCommunicationReceipts.scheduledActionId,
            params.scheduledActionId,
          ),
          eq(elaineCommunicationReceipts.attemptKey, params.attemptKey),
          eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
          eq(elaineCommunicationReceipts.actionType, params.actionType),
          params.recipientUserId === null
            ? isNull(elaineCommunicationReceipts.recipientUserId)
            : or(
                isNull(elaineCommunicationReceipts.recipientUserId),
                eq(
                  elaineCommunicationReceipts.recipientUserId,
                  params.recipientUserId,
                ),
              ),
          eq(elaineCommunicationReceipts.status, "scheduled"),
        ),
      )
      .returning();
    if (scheduledReceipt) return { receipt: scheduledReceipt, claimed: true };
  }

  const id = randomUUID();
  const result = await db.execute(
    // INSERT conflict handling is the atomic dispatch claim. The key is shared
    // by every recipient from one action; append the recipient for fanout.
    // The hash is persisted only as a non-reversible binding check.
    sql`
      INSERT INTO elaine_communication_receipts
        (id, attempt_key, payload_hash, owner_user_id, action_type, channel,
         status, conversation_id, recipient_user_id, scheduled_action_id,
         created_at, updated_at)
      VALUES (
        ${id}::uuid,
        ${params.attemptKey},
        ${params.payloadHash},
        ${params.ownerUserId},
        ${params.actionType},
        ${params.channel},
        ${params.status ?? "executing"},
        ${params.conversationId},
        ${params.recipientUserId},
        ${params.scheduledActionId ?? null},
        NOW(),
        NOW()
      )
      ON CONFLICT (attempt_key) DO NOTHING
      RETURNING id
    `,
  );
  const claimed = Array.isArray(result.rows) && result.rows.length > 0;
  if (claimed) {
    const [receipt] = await db
      .select()
      .from(elaineCommunicationReceipts)
      .where(eq(elaineCommunicationReceipts.id, id))
      .limit(1);
    if (!receipt)
      throw new Error("Communication receipt claim was not readable");
    return { receipt, claimed: true };
  }
  const [receipt] = await db
    .select()
    .from(elaineCommunicationReceipts)
    .where(eq(elaineCommunicationReceipts.attemptKey, params.attemptKey))
    .limit(1);
  if (!receipt)
    throw new Error("Communication receipt conflict was not readable");
  if (
    receipt.payloadHash !== params.payloadHash ||
    receipt.ownerUserId !== params.ownerUserId ||
    receipt.actionType !== params.actionType ||
    receipt.conversationId !== params.conversationId ||
    receipt.recipientUserId !== params.recipientUserId
  ) {
    throw new Error("Communication receipt attempt key identity mismatch");
  }
  return { receipt, claimed: false };
}

/**
 * Atomically consumes one approved proposal identity before contact resolution.
 * The repeat receipt ID is part of the identity only when the user explicitly
 * acknowledges that exact recent receipt, making a deliberate repeat a new
 * one-shot proposal while keeping ordinary replay blocked.
 */
export async function claimCommunicationProposal(params: {
  proposalKey: string;
  ownerUserId: number;
  payloadHash: string;
}): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO elaine_communication_proposal_claims
      (proposal_key, owner_user_id, payload_hash, created_at)
    VALUES (
      ${params.proposalKey},
      ${params.ownerUserId},
      ${params.payloadHash},
      NOW()
    )
    ON CONFLICT (owner_user_id, proposal_key) DO NOTHING
    RETURNING proposal_key
  `);
  return Array.isArray(result.rows) && result.rows.length > 0;
}

export async function createOrReadCommunicationReceiptWithRepeatCheck(params: {
  attemptKey: string;
  payloadHash: string;
  ownerUserId: number;
  actionType: string;
  channel: string;
  conversationId: number | null;
  recipientUserId: number;
  acknowledgedReceiptId?: string;
}): Promise<
  | {
      kind: "claimed";
      receipt: typeof elaineCommunicationReceipts.$inferSelect;
      claimed: boolean;
    }
  | {
      kind: "repeat_confirmation";
      receipt: typeof elaineCommunicationReceipts.$inferSelect;
    }
  | { kind: "stale_acknowledgement" }
> {
  return db.transaction(async (tx) => {
    // Serialize repeat detection and this attempt's receipt claim for a single
    // owner/recipient/channel. Different proposals cannot both observe an
    // empty recent window and independently dispatch.
    const repeatLockKey = `${params.ownerUserId}:${params.recipientUserId}:${params.channel}`;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${repeatLockKey})::bigint)`,
    );
    const attemptKey = params.acknowledgedReceiptId
      ? `${params.attemptKey}:repeat:${params.acknowledgedReceiptId}`
      : params.attemptKey;
    const [sameProposalReceipt] = await tx
      .select()
      .from(elaineCommunicationReceipts)
      .where(
        and(
          eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
          params.acknowledgedReceiptId
            ? eq(elaineCommunicationReceipts.attemptKey, attemptKey)
            : or(
                eq(elaineCommunicationReceipts.attemptKey, params.attemptKey),
                sql`${elaineCommunicationReceipts.attemptKey} LIKE ${`${params.attemptKey}:repeat:%`}`,
              ),
        ),
      )
      .orderBy(desc(elaineCommunicationReceipts.createdAt))
      .limit(1);
    if (sameProposalReceipt) {
      if (
        sameProposalReceipt.payloadHash !== params.payloadHash ||
        sameProposalReceipt.actionType !== params.actionType ||
        sameProposalReceipt.conversationId !== params.conversationId ||
        sameProposalReceipt.recipientUserId !== params.recipientUserId
      ) {
        throw new Error("Communication receipt attempt key identity mismatch");
      }
      return {
        kind: "claimed",
        receipt: sameProposalReceipt,
        claimed: false,
      };
    }
    const [recent] = await tx
      .select()
      .from(elaineCommunicationReceipts)
      .where(
        and(
          eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
          eq(
            elaineCommunicationReceipts.recipientUserId,
            params.recipientUserId,
          ),
          eq(elaineCommunicationReceipts.channel, params.channel),
          inArray(elaineCommunicationReceipts.status, [
            ...REPEAT_CONFIRMATION_STATUSES,
          ]),
          gt(
            elaineCommunicationReceipts.createdAt,
            new Date(Date.now() - RECENT_COMMUNICATION_REPEAT_WINDOW_MS),
          ),
        ),
      )
      .orderBy(desc(elaineCommunicationReceipts.createdAt))
      .limit(1);
    if (recent && params.acknowledgedReceiptId !== recent.id) {
      return { kind: "repeat_confirmation", receipt: recent };
    }
    if (!recent && params.acknowledgedReceiptId) {
      return { kind: "stale_acknowledgement" };
    }

    const id = randomUUID();
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO elaine_communication_receipts
        (id, attempt_key, payload_hash, owner_user_id, action_type, channel,
         status, conversation_id, recipient_user_id, created_at, updated_at)
      VALUES (
        ${id}::uuid, ${attemptKey}, ${params.payloadHash}, ${params.ownerUserId},
        ${params.actionType}, ${params.channel}, 'executing',
        ${params.conversationId}, ${params.recipientUserId}, NOW(), NOW()
      )
      ON CONFLICT (attempt_key) DO NOTHING
      RETURNING id
    `);
    if (inserted.rows.length > 0) {
      const [receipt] = await tx
        .select()
        .from(elaineCommunicationReceipts)
        .where(eq(elaineCommunicationReceipts.id, id))
        .limit(1);
      if (!receipt)
        throw new Error("Communication receipt claim was not readable");
      return { kind: "claimed", receipt, claimed: true };
    }
    const [receipt] = await tx
      .select()
      .from(elaineCommunicationReceipts)
      .where(eq(elaineCommunicationReceipts.attemptKey, attemptKey))
      .limit(1);
    if (!receipt)
      throw new Error("Communication receipt conflict was not readable");
    if (
      receipt.payloadHash !== params.payloadHash ||
      receipt.ownerUserId !== params.ownerUserId ||
      receipt.actionType !== params.actionType ||
      receipt.conversationId !== params.conversationId ||
      receipt.recipientUserId !== params.recipientUserId
    ) {
      throw new Error("Communication receipt attempt key identity mismatch");
    }
    return { kind: "claimed", receipt, claimed: false };
  });
}

/**
 * Receipts created from one consumed proposal, used to answer a duplicate
 * approval with the prior outcome instead of an error. Recipient/channel
 * fanout appends `:<suffix>` to the proposal key; an acknowledged repeat is
 * matched only by its own `:repeat:<receiptId>` attempts.
 */
export async function listProposalCommunicationReceipts(params: {
  attemptKey: string;
  ownerUserId: number;
  acknowledgedReceiptId?: string;
}): Promise<Array<typeof elaineCommunicationReceipts.$inferSelect>> {
  const rows = await db
    .select()
    .from(elaineCommunicationReceipts)
    .where(
      and(
        eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
        or(
          eq(elaineCommunicationReceipts.attemptKey, params.attemptKey),
          sql`${elaineCommunicationReceipts.attemptKey} LIKE ${`${params.attemptKey}:%`}`,
        ),
      ),
    )
    .orderBy(desc(elaineCommunicationReceipts.createdAt));
  const repeatSuffix = params.acknowledgedReceiptId
    ? `:repeat:${params.acknowledgedReceiptId}`
    : null;
  return rows.filter((receipt) =>
    repeatSuffix
      ? receipt.attemptKey.endsWith(repeatSuffix)
      : !receipt.attemptKey.includes(":repeat:"),
  );
}

export async function listRecentCommunicationReceiptsForRecipientChannels(params: {
  ownerUserId: number;
  recipientUserId: number;
  channels: string[];
}): Promise<Array<typeof elaineCommunicationReceipts.$inferSelect>> {
  if (params.channels.length === 0) return [];
  return db
    .select()
    .from(elaineCommunicationReceipts)
    .where(
      and(
        eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
        eq(elaineCommunicationReceipts.recipientUserId, params.recipientUserId),
        inArray(elaineCommunicationReceipts.channel, params.channels),
        inArray(elaineCommunicationReceipts.status, [
          ...REPEAT_CONFIRMATION_STATUSES,
        ]),
        gt(
          elaineCommunicationReceipts.createdAt,
          new Date(Date.now() - RECENT_COMMUNICATION_REPEAT_WINDOW_MS),
        ),
      ),
    )
    .orderBy(desc(elaineCommunicationReceipts.createdAt));
}

export async function findRecentCommunicationReceiptById(params: {
  ownerUserId: number;
  recipientUserId: number;
  receiptId: string;
}): Promise<typeof elaineCommunicationReceipts.$inferSelect | null> {
  const [receipt] = await db
    .select()
    .from(elaineCommunicationReceipts)
    .where(
      and(
        eq(elaineCommunicationReceipts.id, params.receiptId),
        eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
        eq(elaineCommunicationReceipts.recipientUserId, params.recipientUserId),
        inArray(elaineCommunicationReceipts.status, [
          ...REPEAT_CONFIRMATION_STATUSES,
        ]),
        gt(
          elaineCommunicationReceipts.createdAt,
          new Date(Date.now() - RECENT_COMMUNICATION_REPEAT_WINDOW_MS),
        ),
      ),
    )
    .limit(1);
  return receipt ?? null;
}

export async function removeUnstartedCommunicationReceipts(
  receiptIds: string[],
): Promise<void> {
  if (receiptIds.length === 0) return;
  await db
    .delete(elaineCommunicationReceipts)
    .where(
      and(
        inArray(elaineCommunicationReceipts.id, receiptIds),
        eq(elaineCommunicationReceipts.status, "executing"),
        sql`${elaineCommunicationReceipts.providerId} IS NULL`,
      ),
    );
}

export async function updateCommunicationReceipt(
  id: string,
  patch: {
    status?: CommunicationReceiptStatus;
    channel?: string;
    providerId?: string | null;
    callStatus?: string | null;
    scheduledActionId?: number | null;
  },
): Promise<void> {
  let receipt: { scheduledActionId: number | null } | undefined;
  if (patch.callStatus !== undefined) {
    const result = await db.execute<{ scheduled_action_id: number | null }>(sql`
      UPDATE elaine_communication_receipts
      SET
        status = CASE
          WHEN call_status IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
            THEN status
          WHEN status = 'unknown'
            AND ${patch.callStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
            THEN status
          WHEN call_status = 'ended'
            AND ${patch.callStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
            THEN status
          ELSE ${patch.status ?? "accepted"}
        END,
        provider_id = COALESCE(${patch.providerId ?? null}, provider_id),
        call_status = CASE
          WHEN call_status IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
            THEN call_status
          WHEN status = 'unknown'
            AND ${patch.callStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
            THEN call_status
          WHEN call_status = 'ended'
            AND ${patch.callStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
            THEN call_status
          ELSE ${patch.callStatus}
        END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING scheduled_action_id
    `);
    const row = result.rows[0];
    receipt = row ? { scheduledActionId: row.scheduled_action_id } : undefined;
  } else {
    const [updated] = await db
      .update(elaineCommunicationReceipts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(elaineCommunicationReceipts.id, id))
      .returning({
        scheduledActionId: elaineCommunicationReceipts.scheduledActionId,
      });
    receipt = updated;
  }
  if (
    patch.status &&
    (patch.status !== "accepted" || patch.callStatus === undefined) &&
    receipt?.scheduledActionId != null
  ) {
    await db
      .update(elaineCommunicationReceipts)
      .set({ status: patch.status, updatedAt: new Date() })
      .where(
        and(
          eq(
            elaineCommunicationReceipts.scheduledActionId,
            receipt.scheduledActionId,
          ),
          eq(elaineCommunicationReceipts.status, "scheduled"),
          ne(elaineCommunicationReceipts.id, id),
        ),
      );
  }
}

export async function updateCallCommunicationReceiptsByProviderId(
  providerId: string,
  providerCallStatus: string,
): Promise<number> {
  const receipts = await db.execute<{
    id: string;
    scheduled_action_id: number | null;
    status: CommunicationReceiptStatus;
  }>(sql`
    UPDATE elaine_communication_receipts
    SET
      status = CASE
        WHEN call_status IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
          THEN status
        WHEN status = 'unknown'
          AND ${providerCallStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
          THEN status
        WHEN call_status = 'ended'
          AND ${providerCallStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
          THEN status
        WHEN ${providerCallStatus} = 'failed' THEN 'failed'
        WHEN ${providerCallStatus} IN ('busy', 'canceled', 'cancelled', 'completed', 'ended', 'no-answer', 'voicemail')
          THEN 'completed'
        ELSE 'accepted'
      END,
      call_status = CASE
        WHEN call_status IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
          THEN call_status
        WHEN status = 'unknown'
          AND ${providerCallStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
          THEN call_status
        WHEN call_status = 'ended'
          AND ${providerCallStatus} NOT IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')
          THEN call_status
        ELSE ${providerCallStatus}
      END,
      updated_at = NOW()
    WHERE provider_id = ${providerId}
      AND channel = 'voice'
    RETURNING id, scheduled_action_id, status
  `);
  const scheduledStatusByAction = new Map<number, CommunicationReceiptStatus>();
  for (const receipt of receipts.rows) {
    if (
      receipt.scheduled_action_id !== null &&
      (receipt.status === "completed" || receipt.status === "failed")
    ) {
      scheduledStatusByAction.set(receipt.scheduled_action_id, receipt.status);
    }
  }
  for (const [scheduledActionId, status] of scheduledStatusByAction) {
    await db
      .update(elaineCommunicationReceipts)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(elaineCommunicationReceipts.status, "scheduled"),
          eq(elaineCommunicationReceipts.scheduledActionId, scheduledActionId),
        ),
      );
  }
  return receipts.rows.length;
}

/**
 * True while an outbound voice receipt has been claimed but not yet linked to
 * its provider call ID — the only window in which a call-ended webhook that
 * matched no receipt may still belong to an Elaine call. Calls Elaine never
 * placed (inbound calls, comm checks, reminder calls) have no such receipt.
 */
export async function hasUncorrelatedVoiceReceiptSince(
  since: Date,
): Promise<boolean> {
  const [receipt] = await db
    .select({ id: elaineCommunicationReceipts.id })
    .from(elaineCommunicationReceipts)
    .where(
      and(
        eq(elaineCommunicationReceipts.channel, "voice"),
        eq(elaineCommunicationReceipts.status, "executing"),
        isNull(elaineCommunicationReceipts.providerId),
        gt(elaineCommunicationReceipts.updatedAt, since),
      ),
    )
    .limit(1);
  return Boolean(receipt);
}

export async function cancelScheduledCommunicationReceipts(
  scheduledActionId: number,
  ownerUserId: number,
): Promise<number> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE elaine_communication_receipts
    SET status = 'cancelled', updated_at = NOW()
    WHERE scheduled_action_id = ${scheduledActionId}
      AND owner_user_id = ${ownerUserId}
      AND status = 'scheduled'
    RETURNING id
  `);
  return result.rows.length;
}

export async function pruneOldCommunicationReceipts(
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - RECEIPT_RETENTION_MS);
  await db
    .delete(elaineCommunicationReceipts)
    .where(lt(elaineCommunicationReceipts.createdAt, cutoff));
  await db.execute(sql`
    DELETE FROM elaine_communication_proposal_claims
    WHERE created_at < ${cutoff}
  `);
}

const SETTLED_CALL_STATUSES = new Set([
  "busy",
  "canceled",
  "cancelled",
  "completed",
  "ended",
  "failed",
  "no-answer",
  "voicemail",
]);

/**
 * Whether a receipt's status can still change, so clients know when to stop
 * polling. Only an in-flight send or an accepted call without a settled call
 * status can still move; message receipts stay "accepted" (there is no
 * delivery callback) and "unknown" is final unless a late webhook arrives.
 * Bounded by `windowMs` so a receipt orphaned by a restart stops polling.
 */
export function isCommunicationReceiptPending(
  receipt: {
    status: string;
    channel: string;
    callStatus: string | null;
    updatedAt: Date;
  },
  now: Date,
  windowMs: number,
): boolean {
  if (receipt.updatedAt.getTime() <= now.getTime() - windowMs) return false;
  if (receipt.status === "executing") return true;
  return (
    receipt.channel === "voice" &&
    receipt.status === "accepted" &&
    !SETTLED_CALL_STATUSES.has(receipt.callStatus ?? "")
  );
}

export async function listCommunicationReceipts(params: {
  ownerUserId: number;
  conversationId?: number;
  limit: number;
  before?: Date;
}): Promise<Array<typeof elaineCommunicationReceipts.$inferSelect>> {
  const clauses = [
    eq(elaineCommunicationReceipts.ownerUserId, params.ownerUserId),
    gt(
      elaineCommunicationReceipts.createdAt,
      new Date(Date.now() - RECEIPT_RETENTION_MS),
    ),
  ];
  if (params.conversationId !== undefined) {
    clauses.push(
      eq(elaineCommunicationReceipts.conversationId, params.conversationId),
    );
  }
  if (params.before) {
    clauses.push(lt(elaineCommunicationReceipts.createdAt, params.before));
  }
  return db
    .select()
    .from(elaineCommunicationReceipts)
    .where(and(...clauses))
    .orderBy(desc(elaineCommunicationReceipts.createdAt))
    .limit(params.limit);
}
