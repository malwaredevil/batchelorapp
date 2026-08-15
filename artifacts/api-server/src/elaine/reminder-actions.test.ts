import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mocks so vi.fn() refs are available inside vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUserSelect, mockDuplicateSelect, mockInsertReturning } = vi.hoisted(
  () => ({
    // appUsers lookup (`.where()` awaited directly — no `.limit()`)
    mockUserSelect: vi.fn().mockResolvedValue([{ email: "user@example.com" }]),
    // findDuplicatePersonalReminder lookup (`.where().limit()`). Defaults to
    // "no duplicate" so the no-warning test path works without extra setup.
    mockDuplicateSelect: vi.fn().mockResolvedValue([]),
    mockInsertReturning: vi
      .fn()
      .mockResolvedValue([
        { id: 55, dueAt: new Date("2026-08-20T18:00:00.000Z") },
      ]),
  }),
);

// Distinguish the reminders-table duplicate lookup (uses .limit()) from the
// appUsers lookup (awaited via .then()) by checking the table sentinel, exactly
// as communication-actions.test.ts does.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () =>
            table === "reminders-table"
              ? mockDuplicateSelect()
              : mockUserSelect(),
          then: (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) => mockUserSelect().then(resolve, reject),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => mockInsertReturning(),
      }),
    }),
  },
  appUsers: {},
  reminders: "reminders-table",
}));

// Stub the drizzle-orm operators — the db chain mock never evaluates .where()
// arguments, but they are still eagerly constructed before being passed in.
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));

// Stub only the runtime functions from the relative-time resolver — keep the
// real Zod schema exports (RelativeTimeSpecZod, RELATIVE_TIME_SPEC_JSON_SCHEMA,
// RelativeTimeResolutionError) so module-level schema construction succeeds.
vi.mock("../lib/relative-time-resolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/relative-time-resolver")>();
  return {
    ...actual,
    resolveRelativeTime: vi
      .fn()
      .mockReturnValue(new Date("2026-08-20T18:00:00.000Z")),
    getUserTimezone: vi.fn().mockResolvedValue("America/Chicago"),
  };
});

// formatScheduledTime is imported from communication-actions — stub it so tests
// produce a deterministic, human-readable string.
vi.mock("./communication-actions", () => ({
  formatScheduledTime: vi.fn().mockReturnValue("Wednesday Aug 20 at 6:00 PM"),
}));

vi.mock("../lib/reminders-management", () => ({
  listManageableReminders: vi.fn().mockResolvedValue([]),
  snoozeReminder: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { reminderActionExecutors } from "./reminder-actions";

// ---------------------------------------------------------------------------
// Helper — a minimal RelativeTimeSpec that resolveRelativeTime accepts
// (the mock ignores it but Zod parses it in the real executor).
// ---------------------------------------------------------------------------
const WHEN_FIXED = {
  kind: "absolute",
  iso: "2026-08-20T18:00:00.000Z",
} as never;

// ---------------------------------------------------------------------------
// create_reminder — duplicate detection
// ---------------------------------------------------------------------------
//
// Regression coverage for the resubmission UX: asking Elaine "remind me …"
// a second time after doubting the first confirmation used to create a second
// indistinguishable row with no feedback to the user. The executor now checks
// for a near-identical active reminder before inserting and surfaces a warning
// when one exists — without blocking the creation.

describe("create_reminder executor — duplicate detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserSelect.mockResolvedValue([{ email: "user@example.com" }]);
    mockDuplicateSelect.mockResolvedValue([]);
    mockInsertReturning.mockResolvedValue([
      { id: 55, dueAt: new Date("2026-08-20T18:00:00.000Z") },
    ]);
  });

  it("creates the reminder with no warning when no similar reminder exists", async () => {
    const result = await reminderActionExecutors.create_reminder(
      { title: "Call the vet", when: WHEN_FIXED } as never,
      1,
    );

    expect(result.status).toBe(201);
    const body = (
      result.body as { result: { confirmationMessage: string; id: number } }
    ).result;
    expect(body.confirmationMessage).not.toContain("Heads up");
    expect(body.confirmationMessage).toContain("Call the vet");
    // The row must still be created.
    expect(mockInsertReturning).toHaveBeenCalledTimes(1);
    // No duplicate id surfaced.
    expect(
      (result.body as { result: Record<string, unknown> }).result
        .duplicateOfReminderId,
    ).toBeUndefined();
  });

  it("surfaces the existing reminder when a near-identical one already exists", async () => {
    const existingDueAt = new Date("2026-08-20T17:45:00.000Z");
    mockDuplicateSelect.mockResolvedValue([{ id: 42, dueAt: existingDueAt }]);

    const result = await reminderActionExecutors.create_reminder(
      { title: "Call the vet", when: WHEN_FIXED } as never,
      1,
    );

    expect(result.status).toBe(201);
    const body = (
      result.body as {
        result: {
          confirmationMessage: string;
          duplicateOfReminderId?: number;
        };
      }
    ).result;
    // Warning must name the existing reminder.
    expect(body.confirmationMessage).toContain("Heads up");
    expect(body.confirmationMessage).toContain("#42");
    expect(body.duplicateOfReminderId).toBe(42);
    // The new reminder is still created — user is informed, not blocked.
    expect(mockInsertReturning).toHaveBeenCalledTimes(1);
  });

  it("performs the duplicate lookup BEFORE the insert (sequential, not concurrent)", async () => {
    // Track call order so we can assert lookup precedes insert.
    const callOrder: string[] = [];
    mockDuplicateSelect.mockImplementation(() => {
      callOrder.push("lookup");
      return Promise.resolve([]);
    });
    mockInsertReturning.mockImplementation(() => {
      callOrder.push("insert");
      return Promise.resolve([
        { id: 77, dueAt: new Date("2026-08-20T18:00:00.000Z") },
      ]);
    });

    await reminderActionExecutors.create_reminder(
      { title: "Pick up prescriptions", when: WHEN_FIXED } as never,
      1,
    );

    expect(callOrder).toEqual(["lookup", "insert"]);
  });
});
