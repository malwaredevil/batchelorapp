/**
 * Verifies that the add_reminder executor (bell-icon flow) surfaces
 * duplicateOfReminderId + duplicateWarning on the second identical submission,
 * and leaves both fields absent when the title or trip differs.
 *
 * The test calls executeAddReminderAction — the real production executor
 * extracted from the elaine router — so a future refactor that breaks the
 * duplicate wiring will immediately fail here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
// selectQueue drives every db.select() call in order.
//   direct  – rows resolved when the chain is awaited directly (.where())
//   limited – rows resolved when .limit() is called on the where result
// This lets one mock handle both the trip lookup (await .where()) and the
// duplicate check inside findDuplicateTripReminder (await .where().limit(1)).
//
// insertQueue drives db.insert().values().returning() calls in order.

const { selectQueue, insertQueue, dbMock } = vi.hoisted(() => {
  const selectQueue: Array<{ direct: unknown[]; limited: unknown[] }> = [];
  const insertQueue: Array<unknown[]> = [];

  const dbMock = {
    select: vi.fn(() => {
      const entry = selectQueue.shift() ?? { direct: [], limited: [] };
      // Build a thenable that resolves to `entry.direct` when awaited directly,
      // and has a .limit() method that resolves to `entry.limited`.  This
      // covers both the trip-lookup path (no .limit()) and the duplicate-check
      // path (.limit(1)) with a single mock object.
      const whereResult = Object.assign(Promise.resolve(entry.direct), {
        limit: vi.fn(async () => entry.limited),
      });
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => whereResult),
        })),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => insertQueue.shift() ?? []),
      })),
    })),
  };

  return { selectQueue, insertQueue, dbMock };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks are registered.
import { executeAddReminderAction } from "../reminder-actions";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = 42;
const TRIP_ID = 100;
const OTHER_TRIP_ID = 200;
const TITLE = "Check in for flight";
const DUE_DATE = "2026-09-01";
// dueAt is derived by the executor as `${dueDate}T00:01:00.000Z`
const DUE_AT = new Date("2026-09-01T00:01:00.000Z");

const TRIP_ROW = { id: TRIP_ID, title: "Paris Trip" };

function makeInsertedRow(id: number, tripId = TRIP_ID, title = TITLE) {
  return {
    id,
    entityType: "travels_trip",
    entityId: tripId,
    createdByUserId: USER_ID,
    title,
    status: "active",
    dueAt: DUE_AT,
    emailRecipients: [],
    description: null,
  };
}

/** Push the standard sequence for one add_reminder call with no duplicate. */
function queueNoDuplicate(insertId: number, tripId = TRIP_ID) {
  // 1. Trip lookup
  selectQueue.push({ direct: [{ id: tripId, title: "Trip" }], limited: [] });
  // 2. Duplicate check — no existing row
  selectQueue.push({ direct: [], limited: [] });
  // 3. Insert result
  insertQueue.push([makeInsertedRow(insertId, tripId)]);
}

/** Push the standard sequence for one add_reminder call that finds a duplicate. */
function queueWithDuplicate(
  insertId: number,
  duplicateId: number,
  duplicateDueAt: Date | null = DUE_AT,
) {
  // 1. Trip lookup
  selectQueue.push({ direct: [TRIP_ROW], limited: [] });
  // 2. Duplicate check — existing row found
  selectQueue.push({
    direct: [],
    limited: [{ id: duplicateId, dueAt: duplicateDueAt }],
  });
  // 3. Insert result
  insertQueue.push([makeInsertedRow(insertId)]);
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertQueue.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeAddReminderAction — duplicate detection wiring", () => {
  it("first submission: 201 with no duplicate fields", async () => {
    queueNoDuplicate(201);

    const { status, body } = await executeAddReminderAction(
      { tripId: TRIP_ID, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    expect(status).toBe(201);
    const result = (body as { result: Record<string, unknown> }).result;
    expect(result.duplicateOfReminderId).toBeUndefined();
    expect(result.duplicateWarning).toBeUndefined();
  });

  it("second identical submission: 201 with duplicateOfReminderId and duplicateWarning", async () => {
    // Simulate: first reminder was already inserted (id 201); now the second
    // submission runs and the duplicate check finds it.
    queueWithDuplicate(202, 201, DUE_AT);

    const { status, body } = await executeAddReminderAction(
      { tripId: TRIP_ID, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    expect(status).toBe(201);
    const result = (body as { result: Record<string, unknown> }).result;
    expect(result.duplicateOfReminderId).toBe(201);
    expect(typeof result.duplicateWarning).toBe("string");
    expect((result.duplicateWarning as string).length).toBeGreaterThan(0);
    // Warning must reference the duplicate id so the user can act on it.
    expect(result.duplicateWarning as string).toContain("201");
  });

  it("full two-submission sequence: no warning first, warning second", async () => {
    // ── First submission ──────────────────────────────────────────────────
    queueNoDuplicate(301);

    const first = await executeAddReminderAction(
      { tripId: TRIP_ID, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    expect(first.status).toBe(201);
    const firstResult = (first.body as { result: Record<string, unknown> })
      .result;
    expect(firstResult.duplicateOfReminderId).toBeUndefined();
    expect(firstResult.duplicateWarning).toBeUndefined();

    // ── Second submission (same title + dueDate + trip) ───────────────────
    queueWithDuplicate(302, 301, DUE_AT);

    const second = await executeAddReminderAction(
      { tripId: TRIP_ID, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    expect(second.status).toBe(201);
    const secondResult = (second.body as { result: Record<string, unknown> })
      .result;
    expect(secondResult.duplicateOfReminderId).toBe(301);
    expect(typeof secondResult.duplicateWarning).toBe("string");
    expect(secondResult.duplicateWarning as string).toContain("301");
  });

  it("different title: second submission does NOT get a duplicate warning", async () => {
    queueNoDuplicate(401);
    const first = await executeAddReminderAction(
      { tripId: TRIP_ID, title: "Pack sunscreen", dueDate: DUE_DATE },
      USER_ID,
    );
    expect(first.status).toBe(201);

    // Second reminder has a different title — no match found.
    queueNoDuplicate(402);
    const second = await executeAddReminderAction(
      { tripId: TRIP_ID, title: "Book airport taxi", dueDate: DUE_DATE },
      USER_ID,
    );

    expect(second.status).toBe(201);
    const result = (second.body as { result: Record<string, unknown> }).result;
    expect(result.duplicateOfReminderId).toBeUndefined();
    expect(result.duplicateWarning).toBeUndefined();
  });

  it("different trip: second submission does NOT get a duplicate warning", async () => {
    queueNoDuplicate(501, TRIP_ID);
    await executeAddReminderAction(
      { tripId: TRIP_ID, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    // Different trip — no match expected.
    queueNoDuplicate(502, OTHER_TRIP_ID);
    const second = await executeAddReminderAction(
      { tripId: OTHER_TRIP_ID, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    expect(second.status).toBe(201);
    const result = (second.body as { result: Record<string, unknown> }).result;
    expect(result.duplicateOfReminderId).toBeUndefined();
    expect(result.duplicateWarning).toBeUndefined();
  });

  it("trip not found: returns 404", async () => {
    // Trip lookup returns nothing.
    selectQueue.push({ direct: [], limited: [] });

    const { status, body } = await executeAddReminderAction(
      { tripId: 9999, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    expect(status).toBe(404);
    expect((body as { error: string }).error).toMatch(/trip not found/i);
  });

  it("duplicate check runs BEFORE the insert (lookup can't match its own row)", async () => {
    // Spy on the insert to confirm the duplicate check has already completed.
    let duplicateCheckDone = false;

    // Override: make the duplicate check record when it resolves.
    selectQueue.push({ direct: [TRIP_ROW], limited: [] }); // trip
    selectQueue.push({ direct: [], limited: [] }); // duplicate check (no match)

    // Intercept the insert to verify ordering.
    let insertCalledAfterDuplicateCheck = false;
    dbMock.insert.mockImplementationOnce(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          // At this point the duplicate check must already have run.
          insertCalledAfterDuplicateCheck = duplicateCheckDone;
          return [makeInsertedRow(601)];
        }),
      })),
    }));

    // Mark duplicate check as done after the select .limit() is consumed.
    dbMock.select.mockImplementationOnce(() => {
      // This is the trip lookup.
      const entry = selectQueue.shift()!;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() =>
            Object.assign(Promise.resolve(entry.direct), {
              limit: vi.fn(async () => entry.limited),
            }),
          ),
        })),
      };
    });
    dbMock.select.mockImplementationOnce(() => {
      // This is the duplicate check — mark it done when .limit() resolves.
      const entry = selectQueue.shift()!;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() =>
            Object.assign(Promise.resolve(entry.direct), {
              limit: vi.fn(async () => {
                duplicateCheckDone = true;
                return entry.limited;
              }),
            }),
          ),
        })),
      };
    });

    await executeAddReminderAction(
      { tripId: TRIP_ID, title: TITLE, dueDate: DUE_DATE },
      USER_ID,
    );

    expect(insertCalledAfterDuplicateCheck).toBe(true);
  });
});
