import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import {
  makeEagerSelectBuilder,
  createTrackedMutationBuilders,
} from "../test-helpers/db-mock";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const {
  insertCalls,
  updateCalls,
  lastReturning,
  makeInsertBuilder,
  makeUpdateBuilder,
} = createTrackedMutationBuilders();

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  insert: vi.fn((table: unknown) => makeInsertBuilder(table)),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("./notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(null),
  NOTIFICATION_TYPES: {
    TRAVEL_RESERVATION_CHANGE: "travel_reservation_change",
  },
}));

vi.mock("./scheduler-guard", () => ({
  shouldRunScheduledTask: vi.fn().mockResolvedValue(true),
  recordScheduledTaskSuccess: vi.fn().mockResolvedValue(undefined),
  recordScheduledTaskFailure: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Pre-warmed in beforeAll — both of these are dynamic imports (rather than
// static top-level imports) so the mocked "@workspace/db" module isn't
// evaluated until after the dbMock/selectQueue consts above have already
// been initialized. A static top-level import here would be hoisted ahead
// of those consts and throw "Cannot access 'dbMock' before initialization".
let runMonitoringCheckForReservation: (typeof import("./monitoring-scheduler"))["runMonitoringCheckForReservation"];
let travelsReservations: (typeof import("@workspace/db"))["travelsReservations"];

beforeAll(async () => {
  const mod = await import("./monitoring-scheduler");
  runMonitoringCheckForReservation = mod.runMonitoringCheckForReservation;
  const dbModule = await import("@workspace/db");
  travelsReservations = dbModule.travelsReservations;
}, 30_000);

function resetSelectDefault(): void {
  dbMock.select.mockReset();
  dbMock.select.mockImplementation(() => makeEagerSelectBuilder(selectQueue));
}

function findLastCheckedAtUpdate() {
  return updateCalls.find(
    (c) =>
      c.table === travelsReservations &&
      c.set &&
      typeof c.set === "object" &&
      "lastCheckedAt" in c.set,
  );
}

beforeEach(() => {
  selectQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  lastReturning.value = [];
  resetSelectDefault();
});

// ---------------------------------------------------------------------------
// runMonitoringCheckForReservation — used by both the "Check now" job
// handler and (indirectly) the hourly scheduler's forced single-reservation
// path. lastCheckedAt must only ever be written once the real checks below
// it have actually completed, never optimistically.
// ---------------------------------------------------------------------------

describe("runMonitoringCheckForReservation", () => {
  const baseReservation = {
    id: 1,
    tripId: 10,
    reservationType: "general",
    monitoringEnabled: true,
    monitoringPolicy: "standard",
    checkInDate: null,
    checkOutDate: null,
    status: "confirmed",
    createdByUserId: 1,
    lastCheckedAt: null,
  };

  const baseTrip = {
    id: 10,
    lat: null,
    lng: null,
    startDate: "2026-09-01",
    endDate: "2026-09-05",
  };

  it("records lastCheckedAt only after the underlying checks complete successfully", async () => {
    selectQueue.push([baseReservation]); // reservation lookup
    selectQueue.push([baseTrip]); // trip lookup

    await runMonitoringCheckForReservation(1);

    const update = findLastCheckedAtUpdate();
    expect(update).toBeDefined();
    expect(
      (update!.set as { lastCheckedAt: Date }).lastCheckedAt,
    ).toBeInstanceOf(Date);
  });

  it("throws (and never touches lastCheckedAt) when the reservation does not exist", async () => {
    selectQueue.push([]); // reservation lookup → not found

    await expect(runMonitoringCheckForReservation(999)).rejects.toThrow(
      /reservation 999/,
    );
    expect(findLastCheckedAtUpdate()).toBeUndefined();
  });

  it("throws (and never touches lastCheckedAt) when the reservation's trip does not exist", async () => {
    selectQueue.push([baseReservation]); // reservation lookup
    selectQueue.push([]); // trip lookup → not found

    await expect(runMonitoringCheckForReservation(1)).rejects.toThrow(
      /trip 10/,
    );
    expect(findLastCheckedAtUpdate()).toBeUndefined();
  });

  it("is a no-op (never touches lastCheckedAt) when monitoring is disabled at execution time", async () => {
    // Simulates a job queued while monitoring was on, then the user disables it
    // before the worker fires.
    selectQueue.push([{ ...baseReservation, monitoringEnabled: false }]);

    await runMonitoringCheckForReservation(1);

    expect(findLastCheckedAtUpdate()).toBeUndefined();
  });

  it("is a no-op (never touches lastCheckedAt) when the reservation is no longer confirmed at execution time", async () => {
    // Simulates a job queued for a confirmed reservation that was later
    // cancelled or changed before the worker fires.
    selectQueue.push([{ ...baseReservation, status: "cancelled" }]);

    await runMonitoringCheckForReservation(1);

    expect(findLastCheckedAtUpdate()).toBeUndefined();
  });

  it("does not update lastCheckedAt when a downstream check throws mid-way through", async () => {
    // A hotel reservation with check-in today makes checkCheckInWindow reach
    // its dedup-key select — the 3rd db.select() call in this run (after the
    // reservation and trip lookups). Forcing that call to throw simulates a
    // real downstream failure (e.g. a transient DB error) partway through
    // the checks, which must leave lastCheckedAt untouched rather than
    // recording a check that didn't actually finish.
    const today = new Date().toISOString().slice(0, 10);
    const reservation = {
      ...baseReservation,
      id: 2,
      reservationType: "hotel",
      checkInDate: today,
    };
    selectQueue.push([reservation]); // reservation lookup
    selectQueue.push([baseTrip]); // trip lookup

    let callCount = 0;
    dbMock.select.mockImplementation(() => {
      callCount++;
      if (callCount > 2) {
        throw new Error("simulated downstream db failure");
      }
      return makeEagerSelectBuilder(selectQueue);
    });

    await expect(runMonitoringCheckForReservation(2)).rejects.toThrow(
      /simulated downstream db failure/,
    );
    expect(findLastCheckedAtUpdate()).toBeUndefined();
  });
});
