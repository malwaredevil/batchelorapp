import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mockExecute = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ rows: [{ id: "cancelled-receipt" }] }),
);
vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  elaineCommunicationReceipts: {},
}));

import {
  claimCommunicationProposal,
  cancelScheduledCommunicationReceipts,
  communicationPayloadHash,
  createCommunicationProposalId,
  updateCallCommunicationReceiptsByProviderId,
  verifyCommunicationProposalId,
} from "./communication-receipts";

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
