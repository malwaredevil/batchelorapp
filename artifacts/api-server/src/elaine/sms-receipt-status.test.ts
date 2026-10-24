import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  statuses: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
  select: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("./communication-receipts", () => ({
  listCommunicationReceipts: mocks.list,
}));
vi.mock("../lib/sms", () => ({ getSmsMessageStatuses: mocks.statuses }));
vi.mock("../lib/logger", () => ({ logger: { warn: mocks.warn } }));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: { update: mocks.update, select: mocks.select },
}));
import { readCommunicationReceipts } from "./sms-receipt-status";

const receipt = {
  id: "receipt_test",
  ownerUserId: 4,
  channel: "sms",
  providerId: "message_test",
  status: "accepted",
  scheduledActionId: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([{ ...receipt }]);
  mocks.statuses.mockResolvedValue(new Map());
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([]);
});
describe("readCommunicationReceipts", () => {
  it("uses provider-confirmed delivery and scopes the atomic update to its owner and attempt", async () => {
    mocks.statuses.mockResolvedValue(new Map([["message_test", "delivered"]]));
    mocks.returning.mockResolvedValue([{ ...receipt, status: "completed" }]);
    const result = await readCommunicationReceipts({
      ownerUserId: 4,
      limit: 10,
    });
    expect(result[0]?.status).toBe("completed");
    expect(mocks.set.mock.calls[0]?.[0].status).toBe("completed");
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    expect(query.params).toEqual([
      "receipt_test",
      4,
      "sms",
      "message_test",
      "accepted",
      "unknown",
      "executing",
    ]);
  });
  it.each(["accepted", "queued", "sending", "sent", undefined])(
    "does not equate %s with delivery",
    async (status) => {
      mocks.statuses.mockResolvedValue(new Map([["message_test", status]]));
      expect(
        (await readCommunicationReceipts({ ownerUserId: 4, limit: 10 }))[0]
          ?.status,
      ).toBe("accepted");
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it("records an explicit provider failure without exposing its raw payload", async () => {
    mocks.statuses.mockResolvedValue(
      new Map([["message_test", "undelivered"]]),
    );
    mocks.returning.mockResolvedValue([{ ...receipt, status: "failed" }]);
    expect(
      (await readCommunicationReceipts({ ownerUserId: 4, limit: 10 }))[0]
        ?.status,
    ).toBe("failed");
  });
  it("does not overwrite receipts that have already settled", async () => {
    mocks.list.mockResolvedValue([{ ...receipt, status: "completed" }]);
    expect(
      (await readCommunicationReceipts({ ownerUserId: 4, limit: 10 }))[0]
        ?.status,
    ).toBe("completed");
    expect(mocks.statuses).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not assert a terminal update when a concurrent change rejected it", async () => {
    mocks.statuses.mockResolvedValue(new Map([["message_test", "delivered"]]));
    expect(
      (await readCommunicationReceipts({ ownerUserId: 4, limit: 10 }))[0]
        ?.status,
    ).toBe("accepted");
  });
  it("preserves accepted evidence when the provider lookup fails", async () => {
    mocks.statuses.mockRejectedValue(new Error("private provider failure"));
    expect(
      (await readCommunicationReceipts({ ownerUserId: 4, limit: 10 }))[0]
        ?.status,
    ).toBe("accepted");
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
      "private provider failure",
    );
  });
  it("returns a saved schedule timestamp using an owner-scoped lookup", async () => {
    mocks.list.mockResolvedValue([
      {
        ...receipt,
        status: "scheduled",
        providerId: null,
        scheduledActionId: 38,
      },
    ]);
    const scheduleWhere = vi
      .fn()
      .mockResolvedValue([{ id: 38, dueAt: new Date("2026-10-23T13:30:00Z") }]);
    mocks.select.mockReturnValue({ from: () => ({ where: scheduleWhere }) });
    const rows = await readCommunicationReceipts({ ownerUserId: 4, limit: 10 });
    expect(rows[0]?.scheduledFor).toBe("2026-10-23T13:30:00.000Z");
    expect(
      new PgDialect().sqlToQuery(scheduleWhere.mock.calls[0]![0]).params,
    ).toEqual([38, 4]);
    expect(mocks.statuses).not.toHaveBeenCalled();
  });
});
