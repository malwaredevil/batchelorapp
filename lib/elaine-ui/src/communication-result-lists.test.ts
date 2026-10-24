import { describe, expect, it } from "vitest";
import { communicationResultLists } from "./communication-result-lists";

describe("communication result lists", () => {
  it("recognizes saved scheduled SMS names instead of displaying Failed", () => {
    const result = communicationResultLists({
      scheduled: true,
      scheduledActionIds: [37],
      scheduledFor: "2026-10-22T17:00:00.000Z",
      recipients: ["Test recipient"],
      receipts: [{ id: "saved-receipt", channel: "sms", status: "scheduled" }],
    });
    expect(result.recipients).toEqual([
      {
        name: "Test recipient",
        channel: "sms",
        ok: true,
        error: null,
        status: "scheduled",
        receiptStatus: "scheduled",
        receiptId: "saved-receipt",
      },
    ]);
    expect(result.receipts).toEqual([
      {
        receiptId: "saved-receipt",
        channel: "sms",
        status: "scheduled",
      },
    ]);
    expect(result.recipients?.[0]?.status).not.toBe("delivered");
  });

  it("recognizes schedules without receipts without claiming delivery", () => {
    expect(
      communicationResultLists({
        scheduled: true,
        recipients: ["One", "Two"],
      }).recipients,
    ).toEqual([
      expect.objectContaining({
        name: "One",
        ok: true,
        receiptStatus: "scheduled",
      }),
      expect.objectContaining({
        name: "Two",
        ok: true,
        receiptStatus: "scheduled",
      }),
    ]);
  });

  it("does not pair unnamed receipt IDs with multiple named recipients", () => {
    const result = communicationResultLists({
      scheduled: true,
      recipients: ["One", "Two"],
      receipts: [
        { id: "only-one-receipt", channel: "sms", status: "scheduled" },
      ],
    });
    expect(result.recipients?.every((r) => r.receiptId === undefined)).toBe(
      true,
    );
  });

  it("preserves genuine immediate-delivery failures and successes", () => {
    const recipients = [
      {
        name: "One",
        channel: "sms",
        ok: false,
        error: "Provider rejected",
        status: "failed",
        receiptStatus: "failed",
        receiptId: "failed-id",
      },
      {
        name: "Two",
        channel: "sms",
        ok: true,
        error: null,
        status: "pending",
        receiptStatus: "pending",
        receiptId: "pending-id",
      },
    ];
    expect(communicationResultLists({ recipients }).recipients).toEqual(
      recipients,
    );
  });

  it("accepts receiptId and id response variants", () => {
    expect(
      communicationResultLists({
        receipts: [
          { receiptId: "first", channel: "sms", status: "pending" },
          { id: "second", channel: "email", status: "scheduled" },
        ],
      }).receipts?.map((r) => r.receiptId),
    ).toEqual(["first", "second"]);
  });

  it("does not infer a successful action from unscheduled names or malformed input", () => {
    expect(
      communicationResultLists({
        recipients: ["One", null, {}, { name: "Two" }],
        receipts: [null, { id: 2 }, []],
      }),
    ).toEqual({ recipients: [], receipts: [] });
    expect(
      communicationResultLists({ recipients: "One", receipts: {} }),
    ).toEqual({ recipients: undefined, receipts: undefined });
  });
});
