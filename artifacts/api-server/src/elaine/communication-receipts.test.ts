import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const {
  mockExecute,
  mockTransaction,
  mockSelectLimit,
  mockUpdateSet,
  mockUpdateWhere,
  mockScheduledUpdateReturning,
  mockSelectOrderBy,
} = vi.hoisted(() => ({
  mockExecute: vi
    .fn()
    .mockResolvedValue({ rows: [{ id: "cancelled-receipt" }] }),
  mockTransaction: vi.fn(),
  mockSelectLimit: vi.fn().mockResolvedValue([]),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockScheduledUpdateReturning: vi.fn().mockResolvedValue([]),
  mockSelectOrderBy: vi.fn().mockResolvedValue([]),
}));
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  return {
    db: {
      execute: mockExecute,
      transaction: mockTransaction,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: mockSelectLimit,
            orderBy: mockSelectOrderBy,
          }),
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          mockUpdateSet(values);
          return {
            where: (condition: unknown) => {
              mockUpdateWhere(condition);
              return { returning: mockScheduledUpdateReturning };
            },
          };
        },
      }),
    },
    elaineCommunicationReceipts: schema.elaineCommunicationReceipts,
  };
});

import {
  claimCommunicationProposal,
  cancelScheduledCommunicationReceipts,
  communicationPayloadHash,
  createCommunicationProposalId,
  createOrReadCommunicationReceipt,
  createOrReadCommunicationReceiptWithRepeatCheck,
  createScheduledCommunicationReceiptContext,
  hasUncorrelatedVoiceReceiptSince,
  isCommunicationReceiptPending,
  listProposalCommunicationReceipts,
  restrictedCommunicationTurnId,
  updateCallCommunicationReceiptsByProviderId,
  verifyCommunicationProposalId,
} from "./communication-receipts";
import { elaineCommunicationReceipts } from "@workspace/db/schema";

describe("communication receipt proposals", () => {
  const secret = "test-only-secret";
  const payload = {
    contactName: ["Morgan", "Riley"],
    message: "Meet at six",
    channel: "sms",
  };

  it("binds an approval token to its owner, action, and exact payload", () => {
    const proposalId = createCommunicationProposalId({
      ownerUserId: 12,
      actionType: "message_contact",
      payload,
      secret,
      now: 1_000,
    });

    expect(
      verifyCommunicationProposalId({
        proposalId,
        ownerUserId: 12,
        actionType: "message_contact",
        payload,
        secret,
        now: 2_000,
      }),
    ).toMatchObject({
      ownerUserId: 12,
      actionType: "message_contact",
      payloadHash: communicationPayloadHash(payload),
    });
    expect(
      verifyCommunicationProposalId({
        proposalId,
        ownerUserId: 13,
        actionType: "message_contact",
        payload,
        secret,
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      verifyCommunicationProposalId({
        proposalId,
        ownerUserId: 12,
        actionType: "message_contact",
        payload: { ...payload, message: "different text" },
        secret,
        now: 2_000,
      }),
    ).toBeNull();
    expect(
      verifyCommunicationProposalId({
        proposalId,
        ownerUserId: 12,
        actionType: "call_contact",
        payload,
        secret,
        now: 2_000,
      }),
    ).toBeNull();
  });

  it("expires approval tokens and makes auto-run identity stable per tool call", () => {
    const proposalId = createCommunicationProposalId({
      ownerUserId: 12,
      actionType: "message_contact",
      payload,
      secret,
      stableKey: "turn-1:tool-call-4",
      now: 100,
    });
    const repeated = createCommunicationProposalId({
      ownerUserId: 12,
      actionType: "message_contact",
      payload,
      secret,
      stableKey: "turn-1:tool-call-4",
      now: 100,
    });
    expect(repeated).toBe(proposalId);
    expect(
      verifyCommunicationProposalId({
        proposalId,
        ownerUserId: 12,
        actionType: "message_contact",
        payload,
        secret,
        now: 100 + 24 * 60 * 60 * 1000 + 1,
      }),
    ).toBeNull();
  });
});

describe("scheduled communication receipt claims", () => {
  it("reuses and claims the receipt already linked to the scheduled action", async () => {
    const scheduledReceipt = {
      id: "scheduled-receipt",
      attemptKey: "scheduled-attempt",
      payloadHash: "scheduled-payload-hash",
      ownerUserId: 42,
      actionType: "message_contact",
      channel: "sms",
      status: "scheduled",
      conversationId: null,
      recipientUserId: null,
      scheduledActionId: 77,
    } as typeof elaineCommunicationReceipts.$inferSelect;
    const executingReceipt = {
      ...scheduledReceipt,
      recipientUserId: 91,
      status: "executing",
    } as typeof elaineCommunicationReceipts.$inferSelect;

    mockSelectLimit.mockResolvedValueOnce([scheduledReceipt]);
    const context = await createScheduledCommunicationReceiptContext({
      scheduledActionId: 77,
      deliveryId: 12,
      ownerUserId: 42,
      actionType: "message_contact",
      payload: { contactName: "Morgan", message: "Hello" },
      secret: "test-only-secret",
    });

    expect(context.attemptKey).toBe(scheduledReceipt.attemptKey);
    expect(context.payloadHash).toBe(scheduledReceipt.payloadHash);

    mockScheduledUpdateReturning.mockResolvedValueOnce([executingReceipt]);
    const claim = await createOrReadCommunicationReceipt({
      ...context,
      channel: "sms",
      recipientUserId: 91,
    });

    expect(claim).toEqual({ receipt: executingReceipt, claimed: true });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "executing",
        recipientUserId: 91,
      }),
    );
    const update = new PgDialect().sqlToQuery(
      mockUpdateWhere.mock.calls.at(-1)?.[0] as Parameters<
        PgDialect["sqlToQuery"]
      >[0],
    );
    expect(update.params).toEqual(
      expect.arrayContaining([
        77,
        "scheduled-attempt",
        42,
        "message_contact",
        91,
        "scheduled",
      ]),
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("scheduled communication receipt cancellation", () => {
  it("cancels only scheduled receipts belonging to the supplied owner", async () => {
    const changed = await cancelScheduledCommunicationReceipts(91, 42);
    const statement = mockExecute.mock.calls.at(-1)?.[0] as Parameters<
      PgDialect["sqlToQuery"]
    >[0];
    const compiled = new PgDialect().sqlToQuery(statement);

    expect(changed).toBe(1);
    expect(compiled.params).toEqual([91, 42]);
    expect(compiled.sql).toContain("scheduled_action_id = $1");
    expect(compiled.sql).toContain("owner_user_id = $2");
    expect(compiled.sql).toContain("status = 'scheduled'");
    expect(compiled.sql).toContain("status = 'cancelled'");
  });
});

describe("proposal-level replay guard", () => {
  it("claims one owner-scoped proposal key atomically", async () => {
    const claimed = await claimCommunicationProposal({
      proposalKey: "signed-proposal-key",
      ownerUserId: 42,
      payloadHash: "opaque-payload-hash",
    });
    const statement = mockExecute.mock.calls.at(-1)?.[0] as Parameters<
      PgDialect["sqlToQuery"]
    >[0];
    const compiled = new PgDialect().sqlToQuery(statement);

    expect(claimed).toBe(true);
    expect(compiled.sql).toContain(
      "ON CONFLICT (owner_user_id, proposal_key) DO NOTHING",
    );
    expect(compiled.params).toEqual([
      "signed-proposal-key",
      42,
      "opaque-payload-hash",
    ]);

    mockExecute.mockResolvedValueOnce({ rows: [] });
    await expect(
      claimCommunicationProposal({
        proposalKey: "signed-proposal-key",
        ownerUserId: 42,
        payloadHash: "opaque-payload-hash",
      }),
    ).resolves.toBe(false);
  });
});

describe("acknowledged repeat receipt claims", () => {
  it("creates a distinct repeat attempt instead of returning the original receipt", async () => {
    const attemptKey = "proposal-attempt";
    const recentReceiptId = "recent-receipt";
    const originalReceipt = {
      id: "original-receipt",
      attemptKey,
      payloadHash: "payload-hash",
      ownerUserId: 42,
      actionType: "message_contact",
      conversationId: null,
      recipientUserId: 91,
      status: "accepted",
    };
    const recentReceipt = {
      ...originalReceipt,
      id: recentReceiptId,
      attemptKey: "previous-attempt",
    };
    const repeatedReceipt = {
      ...recentReceipt,
      id: "repeated-receipt",
      attemptKey: `${attemptKey}:repeat:${recentReceiptId}`,
      status: "executing",
    };
    let queryIndex = 0;
    const tx = {
      execute: mockExecute,
      select: () => {
        return {
          from: () => ({
            where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
              const query = {
                orderBy: () => query,
                limit: async () => {
                  const { params } = new PgDialect().sqlToQuery(condition);
                  if (queryIndex === 0) {
                    queryIndex++;
                    return params.includes(attemptKey) ? [originalReceipt] : [];
                  }
                  if (queryIndex === 1) {
                    queryIndex++;
                    return [recentReceipt];
                  }
                  queryIndex++;
                  return [repeatedReceipt];
                },
              };
              return query;
            },
          }),
        };
      },
    };
    mockExecute
      .mockClear()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: repeatedReceipt.id }] });
    mockTransaction.mockImplementation((callback) => callback(tx));

    const result = await createOrReadCommunicationReceiptWithRepeatCheck({
      attemptKey,
      payloadHash: "payload-hash",
      ownerUserId: 42,
      actionType: "message_contact",
      channel: "sms",
      conversationId: null,
      recipientUserId: 91,
      acknowledgedReceiptId: recentReceiptId,
    });

    expect(result).toEqual({
      kind: "claimed",
      receipt: repeatedReceipt,
      claimed: true,
    });
    const insertion = new PgDialect().sqlToQuery(
      mockExecute.mock.calls[1]?.[0] as Parameters<PgDialect["sqlToQuery"]>[0],
    );
    expect(insertion.params).toContain(
      `${attemptKey}:repeat:${recentReceiptId}`,
    );
    expect(queryIndex).toBe(3);
  });
});

describe("monotonic provider call updates", () => {
  it("uses atomic terminal-state predicates to prevent regression", async () => {
    await expect(
      updateCallCommunicationReceiptsByProviderId(
        "provider-call-id",
        "ringing",
      ),
    ).resolves.toBe(1);
    const statement = mockExecute.mock.calls.at(-1)?.[0] as Parameters<
      PgDialect["sqlToQuery"]
    >[0];
    const compiled = new PgDialect().sqlToQuery(statement);

    expect(compiled.sql).toContain(
      "WHEN call_status IN ('busy', 'canceled', 'cancelled', 'completed', 'failed', 'no-answer', 'voicemail')",
    );
    expect(compiled.sql).toContain("WHEN call_status = 'ended'");
    expect(compiled.sql).toContain("RETURNING id, scheduled_action_id");
    expect(compiled.params).toContain("ringing");
    expect(compiled.params).toContain("provider-call-id");
  });
});

describe("restricted communication turn identity", () => {
  it("is stable for a redelivery of the same inbound message", () => {
    const params = {
      userId: 4,
      channelLabel: "SMS/voice",
      inboundMessageId: "delivery-hash-1",
    };
    expect(restrictedCommunicationTurnId(params)).toBe(
      restrictedCommunicationTurnId({ ...params }),
    );
  });

  it("differs for a new inbound message even with identical text and history", () => {
    // Regression: the key used to hash text + recent history, so a recurring
    // request collided with an already-claimed proposal and was suppressed.
    expect(
      restrictedCommunicationTurnId({
        userId: 4,
        channelLabel: "SMS/voice",
        inboundMessageId: "delivery-hash-1",
      }),
    ).not.toBe(
      restrictedCommunicationTurnId({
        userId: 4,
        channelLabel: "SMS/voice",
        inboundMessageId: "delivery-hash-2",
      }),
    );
  });

  it("never collides when the caller has no inbound identity", () => {
    const params = { userId: 4, channelLabel: "email" };
    expect(restrictedCommunicationTurnId(params)).not.toBe(
      restrictedCommunicationTurnId(params),
    );
  });
});

describe("isCommunicationReceiptPending", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const windowMs = 60 * 60 * 1000;
  const recent = new Date("2026-10-04T11:59:00Z");

  it("keeps in-flight sends and unsettled calls pending", () => {
    expect(
      isCommunicationReceiptPending(
        {
          status: "executing",
          channel: "sms",
          callStatus: null,
          updatedAt: recent,
        },
        now,
        windowMs,
      ),
    ).toBe(true);
    expect(
      isCommunicationReceiptPending(
        {
          status: "accepted",
          channel: "voice",
          callStatus: "in-progress",
          updatedAt: recent,
        },
        now,
        windowMs,
      ),
    ).toBe(true);
  });

  it("settles message receipts that will never receive a delivery update", () => {
    for (const status of ["accepted", "unknown", "completed", "failed"]) {
      expect(
        isCommunicationReceiptPending(
          { status, channel: "sms", callStatus: null, updatedAt: recent },
          now,
          windowMs,
        ),
      ).toBe(false);
    }
  });

  it("settles calls with a final call status or an expired window", () => {
    expect(
      isCommunicationReceiptPending(
        {
          status: "accepted",
          channel: "voice",
          callStatus: "ended",
          updatedAt: recent,
        },
        now,
        windowMs,
      ),
    ).toBe(false);
    expect(
      isCommunicationReceiptPending(
        {
          status: "executing",
          channel: "voice",
          callStatus: null,
          updatedAt: new Date("2026-10-04T10:00:00Z"),
        },
        now,
        windowMs,
      ),
    ).toBe(false);
  });
});

describe("listProposalCommunicationReceipts", () => {
  const rows = [
    { id: "original", attemptKey: "proposal-key:2" },
    { id: "fanout", attemptKey: "proposal-key:3:sms" },
    { id: "repeat", attemptKey: "proposal-key:2:repeat:receipt-a" },
    { id: "other-repeat", attemptKey: "proposal-key:2:repeat:receipt-b" },
  ];

  it("returns only the original attempts for an ordinary duplicate", async () => {
    mockSelectOrderBy.mockResolvedValueOnce(rows);
    const receipts = await listProposalCommunicationReceipts({
      attemptKey: "proposal-key",
      ownerUserId: 1,
    });
    expect(receipts.map((r) => r.id)).toEqual(["original", "fanout"]);
  });

  it("returns only that repeat's attempts for an acknowledged repeat", async () => {
    mockSelectOrderBy.mockResolvedValueOnce(rows);
    const receipts = await listProposalCommunicationReceipts({
      attemptKey: "proposal-key",
      ownerUserId: 1,
      acknowledgedReceiptId: "receipt-a",
    });
    expect(receipts.map((r) => r.id)).toEqual(["repeat"]);
  });
});

describe("hasUncorrelatedVoiceReceiptSince", () => {
  it("reports whether an Elaine call is still awaiting its provider ID", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ id: "pending-call" }]);
    await expect(hasUncorrelatedVoiceReceiptSince(new Date())).resolves.toBe(
      true,
    );
    mockSelectLimit.mockResolvedValueOnce([]);
    await expect(hasUncorrelatedVoiceReceiptSince(new Date())).resolves.toBe(
      false,
    );
  });
});
