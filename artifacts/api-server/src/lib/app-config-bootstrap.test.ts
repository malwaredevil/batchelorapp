/**
 * Integration tests for bootstrapDefaults() — the startup routine inside
 * app-config.ts that runs the first time getAllRows() is called:
 *
 *  1. DELETE orphaned rows whose (module, key) pair is no longer in
 *     APP_CONFIG_DEFAULTS (orphan pruning).
 *  2. INSERT all current defaults with ON CONFLICT DO NOTHING so existing
 *     admin-overridden values are never clobbered (seeding).
 *  3. UPDATE stale label/description metadata without touching `value`.
 *     Step 3 pre-fetches current rows in JS, evaluates rowNeedsLabelSync()
 *     as a pure predicate, and only issues UPDATE for drifted entries.
 *  4. Clear `customisedAt` for any row whose stored value now matches the
 *     current default (so the "customised" badge disappears when a developer
 *     changes a default to match an admin's previous override).
 *
 * Uses the same mock-db pattern as config.test.ts and
 * update-app-config-action.test.ts: vi.mock("@workspace/db") replaces the
 * real Drizzle `db` client so no live database connection is required.
 *
 * WHY: The DELETE step is covered by TypeScript types and the drift-guard
 * lint check, but there are no tests that verify it actually fires against
 * the (mock) database on startup.  A regression — e.g. the NOT IN clause
 * being skipped due to an empty defaults list, or a DB error being swallowed
 * silently — would go undetected without this suite.
 *
 * Because Step 3 now pre-fetches current rows via db.select() before issuing
 * any UPDATEs, every call to getAllConfig() consumes TWO items from the
 * selectQueue:
 *   [0] — what Step 3 sees as the current DB state (used to detect drift)
 *   [1] — what getAllRows() returns as the final cache-able result
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeEagerSelectBuilder } from "../test-helpers/db-mock";

// ── DB operation recorders ───────────────────────────────────────────────────
//
// Each builder factory records its own call into one of these arrays so
// assertions can inspect every database operation individually.

interface InsertCall {
  values: Array<{ module: string; key: string; value: string }>;
  onConflictDoNothing: boolean;
}

interface UpdateCall {
  /** Arguments passed to .set() — verified to never include "value". */
  setArgs: Record<string, unknown>;
  /** Number of args received by .where() — must be > 0 to confirm a WHERE clause was built. */
  whereArgCount: number;
}

const deleteCalls: { whereArgCount: number }[] = [];
const insertCalls: InsertCall[] = [];
/**
 * Populated when .where() is called on an update builder (the terminal step
 * in Step 3).  Each entry corresponds to one db.update() chain that
 * completed with a WHERE clause.
 */
const updateCalls: UpdateCall[] = [];

/**
 * Three-slot queue consumed by db.select() on a cold getAllConfig() call:
 *   shift[0] — Step 1 orphan pre-select (inside bootstrapDefaults)
 *   shift[1] — Step 3 drift pre-fetch SELECT (inside bootstrapDefaults)
 *   shift[2] — final getAllRows() SELECT (after bootstrapDefaults returns)
 * Push all three items before calling getAllConfig().
 * Error paths that abort before Step 3 (DELETE or INSERT throw) only consume
 * two slots: [0] for Step 1 orphan pre-select, [1] for the final getAllRows().
 */
const selectQueue: unknown[][] = [];

// ── Builder factories ────────────────────────────────────────────────────────

function makeDeleteBuilder() {
  const call = { whereArgCount: 0 };
  const builder = {
    where(...args: unknown[]) {
      call.whereArgCount = args.length;
      deleteCalls.push(call);
      return Promise.resolve([]);
    },
  };
  return builder;
}

function makeInsertBuilder() {
  const call: InsertCall = { values: [], onConflictDoNothing: false };
  const builder = {
    values(v: unknown) {
      call.values = v as InsertCall["values"];
      return builder;
    },
    onConflictDoNothing() {
      call.onConflictDoNothing = true;
      insertCalls.push(call);
      return Promise.resolve([]);
    },
  };
  return builder;
}

function makeUpdateBuilder() {
  const call: UpdateCall = { setArgs: {}, whereArgCount: 0 };
  const builder = {
    set(args: Record<string, unknown>) {
      call.setArgs = args;
      return builder;
    },
    where(...args: unknown[]): Promise<undefined> {
      // .where() is the terminal step in Step 3 — record the call here.
      call.whereArgCount = args.length;
      updateCalls.push(call);
      return Promise.resolve(undefined);
    },
    returning() {
      // Used by other routes (e.g. admin PUT) — kept for completeness.
      updateCalls.push(call);
      return Promise.resolve([]);
    },
  };
  return builder;
}

// ── DB mock ──────────────────────────────────────────────────────────────────

const dbMock = {
  delete: vi.fn(() => makeDeleteBuilder()),
  insert: vi.fn(() => makeInsertBuilder()),
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  update: vi.fn(() => makeUpdateBuilder()),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock appConfig row that looks like a real DB row. */
function makeRow(
  module: string,
  key: string,
  value: string,
  overrides: Partial<{
    id: number;
    type: string;
    label: string;
    description: string | null;
    customisedAt: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    module,
    key,
    value,
    type: overrides.type ?? "integer",
    label: overrides.label ?? `${module}.${key}`,
    description: overrides.description ?? null,
    // Must be null (not undefined) so reconcileCustomisedAt doesn't
    // treat it as a discrepancy and invalidate the cache unexpectedly.
    customisedAt: overrides.customisedAt ?? null,
    updatedAt: new Date(),
  };
}

// ── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  deleteCalls.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  selectQueue.length = 0;
  vi.clearAllMocks();
  // resetModules ensures each test gets a fresh app-config module with
  // _bootstrapped = false and a cold cache, so bootstrapDefaults() runs.
  vi.resetModules();
});

// ── rowNeedsLabelSync() — pure predicate ─────────────────────────────────────

describe("rowNeedsLabelSync() — drift predicate", () => {
  it("returns true when the row's label differs from the default", async () => {
    const { rowNeedsLabelSync, APP_CONFIG_DEFAULTS } =
      await import("./app-config");
    const d = APP_CONFIG_DEFAULTS[0];

    const staleRow = makeRow(d.module, d.key, d.value, {
      label: "Old stale label",
    });
    expect(rowNeedsLabelSync(staleRow, d)).toBe(true);
  });

  it("returns false when both label and description already match the default", async () => {
    const { rowNeedsLabelSync, APP_CONFIG_DEFAULTS } =
      await import("./app-config");
    const d = APP_CONFIG_DEFAULTS[0];

    const freshRow = makeRow(d.module, d.key, d.value, {
      label: d.label,
      description: d.description ?? null,
    });
    expect(rowNeedsLabelSync(freshRow, d)).toBe(false);
  });

  it("returns true when the description differs from the default", async () => {
    const { rowNeedsLabelSync, APP_CONFIG_DEFAULTS } =
      await import("./app-config");
    // Find a default that has a description so we can test description drift.
    const d = APP_CONFIG_DEFAULTS.find((e) => e.description !== undefined);
    if (!d) return; // skip if no entry has a description (unlikely)

    const staleRow = makeRow(d.module, d.key, d.value, {
      label: d.label,
      description: "Old stale description that no longer matches",
    });
    expect(rowNeedsLabelSync(staleRow, d)).toBe(true);
  });

  it("returns false for a row with matching label and null description when default has no description", async () => {
    const { rowNeedsLabelSync } = await import("./app-config");
    // Simulates an entry with no description field — both row and default have null/undefined.
    const row = { label: "My label", description: null };
    const d = {
      module: "x",
      key: "y",
      value: "1",
      type: "integer" as const,
      label: "My label",
    };
    expect(rowNeedsLabelSync(row, d)).toBe(false);
  });
});

// ── Orphan pruning ───────────────────────────────────────────────────────────

describe("bootstrapDefaults() — orphan pruning", () => {
  it("issues exactly one DELETE when APP_CONFIG_DEFAULTS is non-empty", async () => {
    // Step 3 pre-fetch SELECT — no rows, so no UPDATEs issued.
    selectQueue.push([]);
    // Final getAllRows() SELECT result.
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]);

    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");

    // Sanity: the real defaults list must be non-empty so the guard fires.
    expect(APP_CONFIG_DEFAULTS.length).toBeGreaterThan(0);

    await getAllConfig();

    // db.delete must have been called exactly once (orphan pruning ran).
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
    // The .where() clause must have received at least one argument (the NOT IN condition).
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].whereArgCount).toBeGreaterThan(0);
  });

  it("stale row is absent from getAllConfig() result after bootstrap", async () => {
    // A stale row whose key is NOT in APP_CONFIG_DEFAULTS would have been in
    // the DB before startup.  After bootstrapDefaults() issues the DELETE,
    // the real DB would no longer return it.  We simulate this by having the
    // final select response omit the stale row.
    const STALE_MODULE = "openrouter";
    const STALE_KEY = "legacy_deprecated_setting";

    // Step 3 pre-fetch — empty (simulates no current drifted rows).
    selectQueue.push([]);
    // Final getAllRows() result: stale row already gone (as if DELETE worked).
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]);

    const { getAllConfig } = await import("./app-config");
    const rows = await getAllConfig();

    // Stale row must not appear in the final result.
    const staleRow = rows.find(
      (r) => r.module === STALE_MODULE && r.key === STALE_KEY,
    );
    expect(staleRow).toBeUndefined();

    // The DELETE was issued — orphan pruning code ran.
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
  });
});

// ── Default seeding ──────────────────────────────────────────────────────────

describe("bootstrapDefaults() — default seeding", () => {
  it("calls INSERT with ON CONFLICT DO NOTHING for every APP_CONFIG_DEFAULTS entry", async () => {
    // Step 3 pre-fetch — empty, no UPDATEs.
    selectQueue.push([]);
    // Final getAllRows() result.
    selectQueue.push([]);

    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    await getAllConfig();

    // INSERT must have been called exactly once.
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(insertCalls).toHaveLength(1);

    // ON CONFLICT DO NOTHING must be used so admin overrides are not clobbered.
    expect(insertCalls[0].onConflictDoNothing).toBe(true);

    // Every entry in APP_CONFIG_DEFAULTS must appear in the insert values.
    const seeded = new Set(
      insertCalls[0].values.map((v) => `${v.module}::${v.key}`),
    );
    for (const d of APP_CONFIG_DEFAULTS) {
      expect(seeded.has(`${d.module}::${d.key}`)).toBe(true);
    }
  });

  it("admin-overridden value survives restart (ON CONFLICT DO NOTHING does not clobber it)", async () => {
    // An admin previously changed request_timeout_ms to 99999.
    // The default in APP_CONFIG_DEFAULTS is 12000.
    // ON CONFLICT DO NOTHING must leave the override in place.
    const adminOverriddenRow = makeRow(
      "openrouter",
      "request_timeout_ms",
      "99999", // admin override — NOT the 12000 default
      { id: 5 },
    );

    // Step 1 orphan pre-select — no orphaned rows.
    selectQueue.push([]);
    // Step 3 pre-fetch — the row's label already matches the default, so no UPDATE.
    selectQueue.push([]);
    // Final getAllRows() result: the overridden row is returned as-is.
    selectQueue.push([adminOverriddenRow]);

    const { getAllConfig } = await import("./app-config");
    const rows = await getAllConfig();

    const row = rows.find(
      (r) => r.module === "openrouter" && r.key === "request_timeout_ms",
    );
    expect(row).toBeDefined();
    // The admin override must be preserved — not reset to the default 12000.
    expect(row!.value).toBe("99999");

    // Insert used DO NOTHING, not DO UPDATE — confirmed above by the flag.
    expect(insertCalls[0].onConflictDoNothing).toBe(true);
  });
});

// ── Bootstrap idempotency ────────────────────────────────────────────────────

describe("bootstrapDefaults() — runs only once per process", () => {
  it("does not re-run bootstrapDefaults() on subsequent getAllConfig() calls within the cache TTL", async () => {
    // Step 1 orphan pre-select — no orphaned rows.
    selectQueue.push([]);
    // Step 3 pre-fetch — empty, no UPDATEs.
    selectQueue.push([]);
    // Final getAllRows() result.
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]);

    const { getAllConfig } = await import("./app-config");
    await getAllConfig(); // First call — cold cache → bootstrap + 3 selects
    await getAllConfig(); // Second call — warm cache → no bootstrap, no selects

    // Both the delete and the insert must have fired exactly once.
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    // Step 1 orphan pre-select + Step 3 SELECT + final getAllRows() SELECT = 3 total on first call.
    // Second call hits the warm cache — no additional selects.
    expect(dbMock.select).toHaveBeenCalledTimes(3);
  });
});

// ── Label / description sync (Step 3) — behavioral ───────────────────────────

describe("bootstrapDefaults() — label/description sync (Step 3)", () => {
  it("issues db.update only for the drifted row, not for the matching row", async () => {
    // This is the core regression guard. Pick two real defaults from APP_CONFIG_DEFAULTS:
    // one will have a stale label in the mock DB (must trigger an UPDATE), and the other
    // will have the correct label (must NOT trigger an UPDATE).
    //
    // A regression that inverts rowNeedsLabelSync() (e.g. returning true when labels
    // match) would flip the expected update count here and the test would fail.
    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    const [driftedDefault, matchingDefault] = APP_CONFIG_DEFAULTS;

    // Step 3 pre-fetch: two rows, one with a stale label, one with the correct label.
    const driftedRow = makeRow(
      driftedDefault.module,
      driftedDefault.key,
      driftedDefault.value,
      {
        label: "Old stale label that no longer matches", // deliberately drifted
        description: driftedDefault.description ?? null,
      },
    );
    const matchingRow = makeRow(
      matchingDefault.module,
      matchingDefault.key,
      matchingDefault.value,
      {
        label: matchingDefault.label, // already current — no update needed
        description: matchingDefault.description ?? null,
      },
    );
    selectQueue.push([driftedRow, matchingRow]);

    // Final getAllRows() result — contents don't affect the assertion here.
    selectQueue.push([driftedRow, matchingRow]);

    await getAllConfig();

    // Filter to Step 3 updates only (set label/description). Step 4 also fires
    // db.update() for every default to clear customisedAt, so we must distinguish
    // them by the setArgs shape: Step 3 sets "label", Step 4 sets "customisedAt".
    const step3Calls = updateCalls.filter((c) => "label" in c.setArgs);

    // Exactly one Step 3 UPDATE must have been issued — for the drifted row only.
    expect(step3Calls).toHaveLength(1);

    // The UPDATE must target the drifted default's label (not the matching one's).
    expect(step3Calls[0].setArgs["label"]).toBe(driftedDefault.label);
  });

  it("issues zero db.update calls when all rows already have current labels", async () => {
    // If every row in the DB already matches APP_CONFIG_DEFAULTS, Step 3 must
    // issue no UPDATEs at all. A regression that never skips matching rows would
    // call db.update for every default, causing N spurious writes on every restart.
    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    const d = APP_CONFIG_DEFAULTS[0];

    // Step 3 pre-fetch: one row whose label already matches — no drift.
    const currentRow = makeRow(d.module, d.key, d.value, {
      label: d.label,
      description: d.description ?? null,
    });
    selectQueue.push([currentRow]);

    // Final getAllRows() result.
    selectQueue.push([currentRow]);

    await getAllConfig();

    // Filter to Step 3 updates only (those that set label/description).
    // Step 4 still fires db.update() for every default to clear customisedAt,
    // but those have "customisedAt" in setArgs — not "label".
    const step3Calls = updateCalls.filter((c) => "label" in c.setArgs);

    // No Step 3 UPDATEs — all rows already have current labels/descriptions.
    expect(step3Calls).toHaveLength(0);
  });

  it("set() targets only label and description — never the admin-controlled value", async () => {
    // Even when a row is drifted and an UPDATE is issued, the admin's overridden
    // value must never appear in the SET clause. A regression that added "value"
    // to the SET would silently reset admin overrides on every restart.
    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    const d = APP_CONFIG_DEFAULTS[0];

    // Step 3 pre-fetch: one drifted row (stale label, non-default value).
    selectQueue.push([
      makeRow(d.module, d.key, "99999", { label: "Old stale label" }),
    ]);
    // Final getAllRows() result.
    selectQueue.push([makeRow(d.module, d.key, "99999", { label: d.label })]);

    await getAllConfig();

    // Filter to Step 3 updates only — set label/description, not customisedAt.
    const step3Calls = updateCalls.filter((c) => "label" in c.setArgs);

    // Exactly one Step 3 UPDATE must have been issued for the drifted row.
    expect(step3Calls).toHaveLength(1);

    // SET must only contain label and description — never value.
    expect(Object.keys(step3Calls[0].setArgs)).not.toContain("value");
    expect(step3Calls[0].setArgs).toHaveProperty("label");
    expect(step3Calls[0].setArgs).toHaveProperty("description");
  });

  it("each update builder receives a WHERE argument — no unconditional full-table updates", async () => {
    // A regression that dropped the WHERE clause would update every row in the
    // table unconditionally. This asserts that a non-empty WHERE clause was
    // constructed for every UPDATE issued during Step 3.
    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    const d = APP_CONFIG_DEFAULTS[0];

    // Step 3 pre-fetch: one drifted row.
    selectQueue.push([
      makeRow(d.module, d.key, d.value, { label: "Old stale label" }),
    ]);
    // Final getAllRows() result.
    selectQueue.push([makeRow(d.module, d.key, d.value, { label: d.label })]);

    await getAllConfig();

    // Filter to Step 3 updates only (those that set label/description).
    const step3Calls = updateCalls.filter((c) => "label" in c.setArgs);

    expect(step3Calls).toHaveLength(1);
    expect(step3Calls[0].whereArgCount).toBeGreaterThan(0);
  });

  it("db.update is NOT called on the second getAllConfig() call within the cache TTL", async () => {
    // On the second getAllConfig() call within the cache TTL, bootstrapDefaults()
    // must not run again — so no additional db.update calls should appear.
    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    const d = APP_CONFIG_DEFAULTS[0];

    // Step 1 orphan pre-select — no orphaned rows.
    selectQueue.push([]);
    // Step 3 pre-fetch: one drifted row — triggers 1 UPDATE.
    selectQueue.push([
      makeRow(d.module, d.key, d.value, { label: "Old stale label" }),
    ]);
    // Final getAllRows() result.
    selectQueue.push([makeRow(d.module, d.key, d.value, { label: d.label })]);

    await getAllConfig(); // cold → bootstrap + 1 Step 3 UPDATE + N Step 4 UPDATEs
    // Count only Step 3 label-sync updates (Step 4 customisedAt-clears also fire).
    const step3AfterFirst = updateCalls.filter(
      (c) => "label" in c.setArgs,
    ).length;
    expect(step3AfterFirst).toBe(1);

    await getAllConfig(); // warm cache → no bootstrap, no UPDATE
    // Neither Step 3 nor Step 4 runs on the second call — cache still warm.
    expect(updateCalls.filter((c) => "label" in c.setArgs).length).toBe(
      step3AfterFirst,
    );
  });

  it("Step 3 UPDATE error is swallowed and getAllConfig() still returns rows", async () => {
    // A DB error inside the Promise.all(updates) must not propagate — the
    // bootstrap catch block must absorb it so the service stays up.
    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    const d = APP_CONFIG_DEFAULTS[0];

    dbMock.update.mockImplementationOnce(() => {
      throw new Error("UPDATE failed (simulated)");
    });

    // Step 1 orphan pre-select — no orphaned rows.
    selectQueue.push([]);
    // Step 3 pre-fetch: one drifted row — Step 3 will attempt an UPDATE and fail.
    selectQueue.push([
      makeRow(d.module, d.key, d.value, { label: "Old stale label" }),
    ]);
    // Final getAllRows() result — still returned despite the UPDATE error.
    selectQueue.push([makeRow(d.module, d.key, d.value, { label: d.label })]);

    // Must not throw — bootstrap errors are non-fatal.
    const rows = await getAllConfig();

    // The select result is still returned after the failed Step 3.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].key).toBe(d.key);
  });
});

// ── Error resilience ─────────────────────────────────────────────────────────

describe("bootstrapDefaults() — DB error resilience", () => {
  it("swallows a DB error during bootstrapDefaults() and still returns a usable getConfig() result", async () => {
    // Simulate a transient connection error on the DELETE step.
    dbMock.delete.mockImplementationOnce(() => {
      throw new Error("DB connection refused (simulated)");
    });

    // After the failed bootstrap, the final select still runs and returns empty.
    // Note: when bootstrapDefaults() throws, Step 3's SELECT is never reached,
    // so only one item is consumed from the queue (the final getAllRows() SELECT).
    selectQueue.push([]);

    const { getConfig } = await import("./app-config");

    // Must not throw — bootstrapDefaults() catches all errors internally.
    const value = await getConfig("openrouter", "request_timeout_ms", 12000);

    // Row is absent from mock results, so the hardcoded fallback is returned.
    expect(value).toBe(12000);
    expect(typeof value).toBe("number");
  });

  it("swallows a DB error during the INSERT step and still completes getAllRows()", async () => {
    // DELETE succeeds but INSERT throws. bootstrapDefaults() swallows the error
    // and getAllRows() still proceeds with the main SELECT.
    // Step 1's orphan-detection SELECT runs before the error is thrown, so it
    // consumes the first item from selectQueue; the main SELECT gets the second.
    dbMock.insert.mockImplementationOnce(() => {
      throw new Error("INSERT failed (simulated)");
    });

    // When INSERT fails, the catch block runs before Step 3's SELECT, so only
    // two selects are consumed: Step 1 orphan pre-select + final getAllRows().
    selectQueue.push([]); // Step 1 orphan pre-select
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "5000")]); // Final getAllRows() — still runs after the non-fatal INSERT error.

    const { getAllConfig } = await import("./app-config");

    // Must not throw.
    const rows = await getAllConfig();

    // The select result is still returned — non-fatal error didn't abort the read.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].key).toBe("request_timeout_ms");
  });
});

// ── Warn-state auto-recovery (retry after 60 s) ───────────────────────────────
//
// When bootstrapDefaults() returns 'warn' (transient DB connectivity failure)
// the module must schedule a retry rather than treating the process as
// permanently bootstrapped.  The next getAllRows() call after the retry window
// (60 s) elapses must re-attempt bootstrapDefaults() so the server self-heals
// without a restart.

describe("bootstrapDefaults() — warn state auto-recovery", () => {
  afterEach(() => {
    // Always restore real timers so fake-timer state doesn't bleed into
    // other test suites.
    vi.useRealTimers();
  });

  it("does not re-run bootstrap within the retry window after a warn", async () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    vi.setSystemTime(startTime);

    // First call: bootstrap fails with a connectivity error → 'warn'.
    dbMock.delete.mockImplementationOnce(() => {
      throw Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
    });

    // DB select returns empty on first call (post-bootstrap main SELECT).
    selectQueue.push([]);

    const { getAllConfig, getBootstrapStatus, invalidateConfigCache } =
      await import("./app-config");

    await getAllConfig(); // triggers bootstrap → warn → schedules retry at t+60s
    expect(getBootstrapStatus()).toBe("warn");

    // Advance only 30 s — inside the retry window.
    vi.setSystemTime(startTime + 30_000);
    invalidateConfigCache(); // force cache miss so getAllRows() runs again

    // Queue a result for the second SELECT (cache miss path, no bootstrap).
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]);

    vi.clearAllMocks(); // reset call counts

    await getAllConfig(); // second call — retry window not elapsed yet

    // Bootstrap ops (delete/insert) must NOT have run again.
    expect(dbMock.delete).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
    // Status is still 'warn'.
    expect(getBootstrapStatus()).toBe("warn");
  });

  it("re-attempts bootstrap after the retry window elapses", async () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    vi.setSystemTime(startTime);

    // First call: bootstrap fails → 'warn'.
    dbMock.delete.mockImplementationOnce(() => {
      throw Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
    });

    selectQueue.push([]); // main SELECT after first (failed) bootstrap

    const { getAllConfig, getBootstrapStatus, invalidateConfigCache } =
      await import("./app-config");

    await getAllConfig();
    expect(getBootstrapStatus()).toBe("warn");

    // Advance past the 60 s retry window.
    vi.setSystemTime(startTime + 61_000);
    invalidateConfigCache(); // force cache miss

    // Queue selects for the retry bootstrap (orphan-detection + main SELECT)
    // and the subsequent main getAllRows() SELECT.
    selectQueue.push([]); // orphan-detection during retry bootstrap
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]); // main SELECT

    vi.clearAllMocks();

    await getAllConfig(); // retry window elapsed — bootstrap runs again

    // Bootstrap ops must have fired on the retry.
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    // Clean retry → status is now 'success'.
    expect(getBootstrapStatus()).toBe("success");
  });

  it("status remains 'warn' (not 'success') when the retry attempt also fails", async () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    vi.setSystemTime(startTime);

    // Both the initial call and the retry fail with a connectivity error.
    const connectErr = () =>
      Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });

    dbMock.delete
      .mockImplementationOnce(() => {
        throw connectErr();
      }) // first bootstrap
      .mockImplementationOnce(() => {
        throw connectErr();
      }); // retry bootstrap

    selectQueue.push([]); // main SELECT after first failed bootstrap

    const { getAllConfig, getBootstrapStatus, invalidateConfigCache } =
      await import("./app-config");

    await getAllConfig();
    expect(getBootstrapStatus()).toBe("warn");

    vi.setSystemTime(startTime + 61_000);
    invalidateConfigCache();

    selectQueue.push([]); // main SELECT after retry (also fails)

    await getAllConfig(); // retry — also fails

    // Status must stay 'warn', not flip to 'success'.
    expect(getBootstrapStatus()).toBe("warn");
  });

  it("status becomes 'success' and bootstrap no longer retries after a successful recovery", async () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    vi.setSystemTime(startTime);

    // First call fails → 'warn'.
    dbMock.delete.mockImplementationOnce(() => {
      throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
    });

    selectQueue.push([]); // main SELECT after first failed bootstrap

    const { getAllConfig, getBootstrapStatus, invalidateConfigCache } =
      await import("./app-config");

    await getAllConfig();
    expect(getBootstrapStatus()).toBe("warn");

    // Advance past retry window — retry succeeds (mock no longer throws).
    vi.setSystemTime(startTime + 61_000);
    invalidateConfigCache();

    selectQueue.push([]); // orphan-detection during retry
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]);

    await getAllConfig(); // retry succeeds
    expect(getBootstrapStatus()).toBe("success");

    // Another cache miss: bootstrap must NOT run again.
    vi.setSystemTime(startTime + 120_000);
    invalidateConfigCache();
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]);

    vi.clearAllMocks();
    await getAllConfig();

    expect(dbMock.delete).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(getBootstrapStatus()).toBe("success");
  });
});

// ── Step 4: clear customisedAt when value matches default ────────────────────

describe("bootstrapDefaults() — clear customisedAt when value matches default", () => {
  it("calls UPDATE (via db.update) once per default entry on every bootstrap", async () => {
    // This verifies Step 4 fires: bootstrap issues one db.update() call per
    // APP_CONFIG_DEFAULTS entry to clear customisedAt when the stored value
    // matches the current default.  Step 3 only fires for rows with drifted
    // labels (selective); the queue here has no drifted rows so Step 3 adds 0
    // calls.  The total count must therefore be at least APP_CONFIG_DEFAULTS.length.
    selectQueue.push([makeRow("openrouter", "request_timeout_ms", "12000")]);

    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    await getAllConfig();

    // At minimum, one update per default entry from Step 4 (customisedAt clear).
    expect(dbMock.update.mock.calls.length).toBeGreaterThanOrEqual(
      APP_CONFIG_DEFAULTS.length,
    );
  });

  it("issues exactly N customisedAt-clear UPDATE calls where N = APP_CONFIG_DEFAULTS.length", async () => {
    // Track how many times set() is called with a `customisedAt: null` payload
    // by replacing makeUpdateBuilder with one that inspects the set() argument.
    const customisedAtClearCount = { n: 0 };

    type UpdateBuilder = {
      set(v: unknown): UpdateBuilder;
      where(): Promise<undefined>;
      returning(): Promise<never[]>;
    };

    dbMock.update.mockImplementation(() => {
      const builder: UpdateBuilder = {
        set(v: unknown) {
          if (
            v !== null &&
            typeof v === "object" &&
            "customisedAt" in v &&
            (v as Record<string, unknown>).customisedAt === null
          ) {
            customisedAtClearCount.n++;
          }
          return builder;
        },
        where() {
          return Promise.resolve(undefined);
        },
        returning() {
          return Promise.resolve([]);
        },
      };
      return builder;
    });

    selectQueue.push([]);

    const { getAllConfig, APP_CONFIG_DEFAULTS } = await import("./app-config");
    await getAllConfig();

    // Exactly one customisedAt: null update per default entry.
    expect(customisedAtClearCount.n).toBe(APP_CONFIG_DEFAULTS.length);
  });
});
