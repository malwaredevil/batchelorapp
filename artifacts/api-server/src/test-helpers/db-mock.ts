/**
 * Shared database mock factory for Express route tests.
 *
 * WHY THE BOOTSTRAP QUEUE ENTRY IS REQUIRED
 * ------------------------------------------
 * Any route handler that eventually calls getAllRows() from lib/app-config.ts
 * will trigger bootstrapDefaults() on the very first call — because
 * vi.resetModules() in beforeEach always resets the module-level _bootstrapped
 * flag to false, making every test start with a cold module state.
 *
 * bootstrapDefaults() fires a db.select().from(appConfig).where(notInArray(...))
 * call (the orphan-row prune/warn check) BEFORE the main getAllRows()
 * cache-fill select runs. If this orphan-check call is not pre-seeded in the
 * selectQueue, it silently consumes whatever entry was intended for the next
 * real query — shifting all subsequent reads out of alignment and producing
 * wrong results or hard-to-reproduce test failures.
 *
 * Use queueBootstrapOrphanCheck(selectQueue) to push the required empty-array
 * entry into the queue once, immediately before any entry that a getAllRows()
 * call will consume. Call it once per test that triggers a cold-cache
 * getAllRows() invocation (i.e. any test that calls vi.resetModules() in
 * beforeEach and then invokes any code path touching getConfig / getConfigRow
 * / getAllConfig).
 *
 * USAGE PATTERN
 * -------------
 *   import { createDbMockWithBootstrap, queueBootstrapOrphanCheck } from
 *     "../test-helpers/db-mock";
 *
 *   const { dbMock, selectQueue, updateCalls } = createDbMockWithBootstrap();
 *
 *   vi.mock("@workspace/db", async (importOriginal) => {
 *     const actual = await importOriginal<typeof import("@workspace/db")>();
 *     return { ...actual, db: dbMock };
 *   });
 *
 *   beforeEach(() => {
 *     selectQueue.length = 0;
 *     updateCalls.length = 0;
 *     vi.clearAllMocks();
 *     vi.resetModules();
 *   });
 *
 *   // In each test that triggers a cold getAllRows():
 *   selectQueue.push([ownerRow]);           // 1. owner check (route-level)
 *   queueBootstrapOrphanCheck(selectQueue); // 2. bootstrapDefaults orphan-check
 *   selectQueue.push([configRow]);          // 3. getAllRows cache-fill
 */

import { vi } from "vitest";

/**
 * Create a Drizzle-style select builder that consumes entries from selectQueue.
 *
 * Three termination styles are supported:
 *  - .where()   — bare WHERE-terminated selects (e.g. bootstrapDefaults orphan-check)
 *  - .orderBy() — ordered full-table reads (e.g. the getAllRows cache-fill select)
 *  - .then()    — direct `await db.select().from(x)` with no further chaining
 *                 (e.g. bootstrapDefaults Step 3: `const currentRows = await db.select().from(appConfig)`)
 *
 * Without a .then() terminator, `await db.select().from(x)` resolves to the
 * builder object (which is not an array), causing `currentRows.map()` to throw
 * a TypeError inside bootstrapDefaults(), landing in the catch block and
 * setting _bootstrapStatus to 'error' — which prevents Step 4's db.update()
 * calls from ever running.
 *
 * The .then() terminator intentionally returns [] without consuming a queue
 * slot.  bootstrapDefaults() Step 3 sees an empty currentRows (meaning no
 * stale labels to sync, which is correct for most tests), and then proceeds
 * to Step 4, which calls db.update() once per APP_CONFIG_DEFAULTS entry and
 * sets _bootstrapStatus = 'success'.  Tests that assert on the step-coverage
 * spies (dbMock.delete / insert / update) and on getBootstrapStatus() can
 * pass without each test needing to push a separate queue entry for Step 3.
 *
 * Only one of the three terminators is called per builder instance in practice.
 */
export function makeSelectBuilder(selectQueue: unknown[][]) {
  const builder = {
    from() {
      return builder;
    },
    where() {
      return Promise.resolve(selectQueue.shift() ?? []);
    },
    orderBy() {
      return Promise.resolve(selectQueue.shift() ?? []);
    },
    // Returns [] without consuming a queue slot.  This lets Step 3 of
    // bootstrapDefaults() complete cleanly (empty currentRows → no stale
    // label updates, which is the correct default for unit tests) while
    // leaving the cache-fill queue entry in place for the subsequent
    // .orderBy() call that actually populates the in-memory cache.
    //
    // The generic signature mirrors PromiseLike<unknown[]> so TypeScript
    // recognises the builder as a thenable and `await builder` resolves
    // to unknown[] without a compile error at call sites.
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
        | null
        | undefined,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
        | undefined,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve([] as unknown[]).then(
        onfulfilled,
        onrejected,
      ) as Promise<TResult1 | TResult2>;
    },
  };
  return builder;
}

export interface UpdateCall {
  value: string;
  customisedAt?: Date | null;
}

/**
 * Create a Drizzle-style update builder that tracks only route-level writes.
 *
 * Only set() calls that include a `value` field are recorded in `updateCalls`.
 * Bootstrap label/description syncs (which set only `label`/`description`,
 * never `value`) are intentionally filtered out, so tests that assert
 * `updateCalls.toHaveLength(0)` after a validation rejection stay green even
 * when bootstrapDefaults() runs its Step 3 label-sync update internally.
 *
 * The returning() result echoes back the value and customisedAt that were
 * written, so response-body assertions in PUT-handler tests are meaningful.
 */
export function makeTrackedUpdateBuilder(updateCalls: UpdateCall[]) {
  let setValue = "";
  let setCustomisedAt: Date | null | undefined = undefined;
  const builder = {
    set(set: {
      value?: string;
      updatedAt?: Date;
      label?: string;
      description?: string | null;
      customisedAt?: Date | null;
    }) {
      if (set.value !== undefined) {
        setValue = set.value;
        setCustomisedAt = set.customisedAt;
        updateCalls.push({ value: set.value, customisedAt: set.customisedAt });
      }
      return builder;
    },
    where() {
      return builder;
    },
    returning() {
      return Promise.resolve([
        {
          id: 1,
          module: "openrouter",
          key: "request_timeout_ms",
          value: setValue,
          type: "integer",
          label: "Test",
          description: null,
          updatedAt: new Date(),
          customisedAt: setCustomisedAt ?? null,
        },
      ]);
    },
  };
  return builder;
}

export function makeDeleteBuilder() {
  const builder = {
    where() {
      return Promise.resolve();
    },
  };
  return builder;
}

/**
 * Create a Drizzle-style select builder that consumes one queue slot eagerly
 * at builder-creation time, then resolves that slot from any terminal method.
 *
 * This variant is for route-level tests (e.g. agentphone, elaine-email) and
 * bootstrap-focused tests (app-config-bootstrap) where:
 *  - The route code chains `.where(...).limit(1)` — `.where()` must be
 *    non-terminal (returns builder) so `.limit()` can be called on it.
 *  - Step 3 of bootstrapDefaults (`await db.select().from(appConfig)`) should
 *    consume a real queue slot so tests that exercise label-drift detection can
 *    push specific data for Step 3 to see.
 *
 * Contrast with makeSelectBuilder() (lazy variant), which defers slot
 * consumption to each terminal method and has `.then()` return [] for free.
 * The lazy variant is used by config.test.ts where no route-level selects
 * occur and Step 3 is always expected to see an empty result.
 *
 * Terminal methods (.limit, .orderBy, .then) all resolve the same pre-shifted
 * promise, so only one queue slot is consumed per builder instance regardless
 * of which terminator the code reaches.
 */
export function makeEagerSelectBuilder(selectQueue: unknown[][]) {
  const resultPromise = Promise.resolve(selectQueue.shift() ?? []);
  const builder = {
    from() {
      return builder;
    },
    where() {
      return builder;
    },
    limit() {
      return resultPromise;
    },
    orderBy() {
      return resultPromise;
    },
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
        | null
        | undefined,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
        | undefined,
    ): Promise<TResult1 | TResult2> {
      return resultPromise.then(onfulfilled, onrejected) as Promise<
        TResult1 | TResult2
      >;
    },
  };
  return builder;
}

export function makeInsertBuilder() {
  const builder = {
    values() {
      return builder;
    },
    onConflictDoNothing() {
      return Promise.resolve([]);
    },
    onConflictDoUpdate(_config: unknown) {
      return Promise.resolve([]);
    },
  };
  return builder;
}

/**
 * Create a Drizzle-style update builder that resolves without tracking,
 * for tests that mock the business logic layer and only need structural
 * builder coverage. Supports .set().where() and .set().returning() styles.
 */
export function makeSimpleUpdateBuilder() {
  const builder = {
    set(_set: unknown) {
      return builder;
    },
    where() {
      return Promise.resolve(undefined);
    },
    returning() {
      return Promise.resolve([] as unknown[]);
    },
  };
  return builder;
}

export interface GenericInsertCall {
  table: unknown;
  values: unknown;
}

export interface GenericUpdateCall {
  table: unknown;
  set: unknown;
}

export interface GenericDeleteCall {
  table: unknown;
}

/** A mutable reference to the current returning() payload for mutation builders. */
export interface TrackedMutationRef {
  value: unknown[];
}

/**
 * Create a set of Drizzle-style mutation builders that record every
 * insert/update/delete call into shared tracking arrays.
 *
 * Designed for route tests (e.g. travels/gmail, travels/documents) that need
 * to assert which tables were written and with what payloads.
 *
 * Usage:
 *   const { insertCalls, updateCalls, deleteCalls, lastReturning,
 *           makeInsertBuilder, makeUpdateBuilder, makeDeleteBuilder }
 *     = createTrackedMutationBuilders();
 *
 *   const dbMock = {
 *     select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
 *     insert: vi.fn((table) => makeInsertBuilder(table)),
 *     update: vi.fn((table) => makeUpdateBuilder(table)),
 *     delete: vi.fn((table) => makeDeleteBuilder(table)),
 *   };
 *
 *   beforeEach(() => {
 *     selectQueue.length = 0;
 *     insertCalls.length = 0;
 *     updateCalls.length = 0;
 *     deleteCalls.length = 0;
 *     lastReturning.value = [];
 *   });
 *
 *   // In a test that expects a specific return value from insert/update:
 *   lastReturning.value = [{ id: 5, ... }];
 *
 * Note: onConflictDoUpdate() pushes to updateCalls with table: "upsert"
 * so tests can distinguish a true UPDATE from an upsert conflict path.
 */
export function createTrackedMutationBuilders(): {
  insertCalls: GenericInsertCall[];
  updateCalls: GenericUpdateCall[];
  deleteCalls: GenericDeleteCall[];
  lastReturning: TrackedMutationRef;
  makeInsertBuilder: (table: unknown) => object;
  makeUpdateBuilder: (table: unknown) => object;
  makeDeleteBuilder: (table: unknown) => object;
} {
  const insertCalls: GenericInsertCall[] = [];
  const updateCalls: GenericUpdateCall[] = [];
  const deleteCalls: GenericDeleteCall[] = [];
  const lastReturning: TrackedMutationRef = { value: [] };

  function makeInsertBuilder(table: unknown) {
    const builder = {
      values(values: unknown) {
        insertCalls.push({ table, values });
        return builder;
      },
      onConflictDoNothing() {
        return builder;
      },
      onConflictDoUpdate(config: { set: unknown }) {
        updateCalls.push({ table: "upsert", set: config.set });
        return builder;
      },
      returning() {
        return Promise.resolve(lastReturning.value);
      },
    };
    return builder;
  }

  function makeUpdateBuilder(table: unknown) {
    const builder = {
      set(set: unknown) {
        updateCalls.push({ table, set });
        return builder;
      },
      where() {
        return builder;
      },
      returning() {
        return Promise.resolve(lastReturning.value);
      },
    };
    return builder;
  }

  function makeDeleteBuilder(table: unknown) {
    const builder = {
      where() {
        deleteCalls.push({ table });
        return Promise.resolve(undefined);
      },
    };
    return builder;
  }

  return {
    insertCalls,
    updateCalls,
    deleteCalls,
    lastReturning,
    makeInsertBuilder,
    makeUpdateBuilder,
    makeDeleteBuilder,
  };
}

/**
 * Push the bootstrapDefaults() orphan-check select entry into the queue.
 *
 * This must be called once for every getAllRows() invocation your test
 * triggers with a freshly-reset module state (i.e. after vi.resetModules()
 * in beforeEach). The entry is an empty array — meaning "no orphaned rows
 * to prune" — which is the correct result for any test that isn't
 * specifically exercising orphan-pruning behavior.
 *
 * Failure to call this causes the orphan-check to silently consume the next
 * intended queue entry, shifting all remaining reads out of alignment.
 */
export function queueBootstrapOrphanCheck(selectQueue: unknown[][]): void {
  selectQueue.push([]);
}

/**
 * Create a standard db mock with a shared select queue and update call tracker.
 *
 * Returns:
 *  - dbMock      — pass to vi.mock("@workspace/db") via `{ ...actual, db: dbMock }`
 *  - selectQueue — push row arrays here before each test to drive db.select() calls
 *  - updateCalls — records every db.update().set({ value, ... }) call; bootstrap
 *                  label/description-only syncs are excluded (see makeTrackedUpdateBuilder)
 *
 * Reset state in beforeEach:
 *   selectQueue.length = 0;
 *   updateCalls.length = 0;
 *   vi.clearAllMocks();
 *   vi.resetModules();
 *
 * Prime the queue before each test that reaches getAllRows() on a cold module
 * via queueBootstrapOrphanCheck(selectQueue), or use a higher-level helper
 * (like queueOwnerAndRow in config.test.ts) that embeds the call automatically.
 */
export function createDbMockWithBootstrap(): {
  dbMock: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
  selectQueue: unknown[][];
  updateCalls: UpdateCall[];
} {
  const selectQueue: unknown[][] = [];
  const updateCalls: UpdateCall[] = [];

  const dbMock = {
    select: vi.fn(() => makeSelectBuilder(selectQueue)),
    update: vi.fn(() => makeTrackedUpdateBuilder(updateCalls)),
    delete: vi.fn(() => makeDeleteBuilder()),
    insert: vi.fn(() => makeInsertBuilder()),
  };

  return { dbMock, selectQueue, updateCalls };
}
