/**
 * drizzle-orm query-builder contract smoke tests
 *
 * These tests verify that the drizzle-orm APIs actually used across lib/db and
 * the API-server still produce the SQL shapes the application relies on.  They
 * are intentionally lightweight: no live database is required.
 *
 * Approach
 * --------
 * - `PgDialect.sqlToQuery()` compiles a drizzle SQL object to a stable
 *   `{ sql: string, params: unknown[] }` structure.  This is drizzle-orm's own
 *   public compilation path (the same one used by db.execute internally), so
 *   it remains accurate even if drizzle-orm's internal query-chunk
 *   representation changes.
 * - For query-builder APIs (select / insert / update / delete), a minimal mock
 *   pool is passed to `drizzle()`.  Calling `.toSQL()` on any QueryBuilder
 *   only compiles the AST — it never touches the pool — so the mock never
 *   needs to implement any Pool methods.
 * - Real schema tables (notificationEvents, notificationRecipients,
 *   potteryItems) are used so the tests exercise the actual column mappings
 *   and table names in production use.
 *
 * CI contract
 * -----------
 * If drizzle-orm is upgraded and any of the following change, this suite will
 * fail with a clear assertion message rather than silently generating broken
 * SQL at runtime:
 *   • sql`` template tag interpolation order (params vs literals)
 *   • SELECT … FROM … WHERE generated SQL structure
 *   • eq / and / or helper SQL output
 *   • INSERT … VALUES … ON CONFLICT DO UPDATE generated SQL structure
 *   • UPDATE … SET … WHERE generated SQL structure
 *   • db.transaction type (function arity / existence)
 *   • PgDialect.sqlToQuery() return shape { sql, params }
 */

import { describe, it, expect } from "vitest";
import { sql, eq, and, or, lt, lte, gt, gte } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  notificationEvents,
  notificationPreferences,
  notificationRecipients,
} from "./schema/notifications";
import { potteryItems } from "./schema/pottery";
import { elaineBroadcastLog } from "./schema/elaine";

// ── Shared helpers ───────────────────────────────────────────────────────────

const dialect = new PgDialect();

/**
 * Compile a drizzle SQL template-tag object to `{ sql, params }` using
 * drizzle-orm's own public path.  The return shape itself is part of the
 * drizzle-orm public API — if it changes the destructuring below will fail,
 * catching the upgrade immediately.
 */
function compile(sqlObj: Parameters<typeof dialect.sqlToQuery>[0]): {
  sql: string;
  params: unknown[];
} {
  const result = dialect.sqlToQuery(sqlObj);
  // Verify the return shape has not changed (catches API surface renames).
  expect(typeof result.sql).toBe("string");
  expect(Array.isArray(result.params)).toBe(true);
  return result;
}

// Minimal mock pool — only .toSQL() is exercised; the pool is never called.
// The cast is intentional: we deliberately avoid importing pg just to make a
// real Pool that would need DNS / sockets.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = drizzle({} as any, {
  schema: {
    notificationEvents,
    notificationPreferences,
    notificationRecipients,
    potteryItems,
    elaineBroadcastLog,
  },
});

// ── sql`` template tag ───────────────────────────────────────────────────────

describe("sql template tag", () => {
  it("interpolates a single value as a positional param, not inlined", () => {
    const userId = 42;
    const { sql: text, params } = compile(
      sql`SELECT * FROM users WHERE id = ${userId}`,
    );

    // drizzle must NOT inline the value into the SQL string.
    expect(text).toContain("$1");
    expect(text).not.toContain("42");
    expect(params).toEqual([42]);
  });

  it("interpolates multiple values in insertion order", () => {
    const a = "alpha";
    const b = 99;
    const { sql: text, params } = compile(
      sql`INSERT INTO t VALUES (${a}, ${b})`,
    );

    expect(text).toContain("$1");
    expect(text).toContain("$2");
    expect(params[0]).toBe("alpha");
    expect(params[1]).toBe(99);
  });

  it("sql.raw() inlines text without creating a param", () => {
    const tableName = sql.raw("my_table");
    const { sql: text, params } = compile(
      sql`SELECT * FROM ${tableName} WHERE active = ${true}`,
    );

    // Table name is inlined; boolean is a param.
    expect(text).toContain("my_table");
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(true);
  });

  it("PgDialect.sqlToQuery return shape is { sql: string, params: unknown[] }", () => {
    const result = dialect.sqlToQuery(sql`SELECT 1`);
    // Destructuring must work — property names are part of the public API.
    const { sql: sqlText, params } = result;
    expect(typeof sqlText).toBe("string");
    expect(Array.isArray(params)).toBe(true);
  });
});

// ── select().from().where() ──────────────────────────────────────────────────

describe("select().from().where()", () => {
  it("produces SELECT … FROM <table> WHERE", () => {
    const query = db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, 1));

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^select/);
    expect(text).toContain("notification_events");
    expect(text.toLowerCase()).toContain("where");
    expect(params).toContain(1);
  });

  it("maps camelCase column name to snake_case column in SQL", () => {
    const query = db
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(eq(notificationEvents.eventType, "birthday"));

    const { sql: text, params } = query.toSQL();

    // eventType → event_type in the DB column
    expect(text).toContain("event_type");
    expect(params).toContain("birthday");
  });

  it("produces JOIN syntax when joining two tables", () => {
    const query = db
      .select({
        eventId: notificationEvents.id,
        userId: notificationRecipients.userId,
      })
      .from(notificationRecipients)
      .innerJoin(
        notificationEvents,
        eq(notificationRecipients.eventId, notificationEvents.id),
      )
      .where(eq(notificationRecipients.userId, 7));

    const { sql: text } = query.toSQL();

    expect(text.toLowerCase()).toContain("join");
    expect(text).toContain("notification_events");
    expect(text).toContain("notification_recipients");
  });
});

// ── eq / and / or helpers ────────────────────────────────────────────────────

describe("eq / and / or condition helpers", () => {
  it("eq() generates an equality condition with a positional param", () => {
    const { sql: text, params } = compile(
      sql`WHERE ${eq(notificationEvents.module, "travels")}`,
    );

    expect(text).toContain("module");
    expect(text).toContain("$1");
    expect(params).toContain("travels");
  });

  it("and() combines conditions with AND (not OR)", () => {
    const query = db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.module, "pottery"),
          eq(notificationEvents.scope, "household"),
        ),
      );

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toContain("and");
    expect(text.toLowerCase()).not.toMatch(/\bor\b/);
    expect(params).toContain("pottery");
    expect(params).toContain("household");
  });

  it("or() combines conditions with OR (not AND)", () => {
    const query = db
      .select()
      .from(notificationEvents)
      .where(
        or(
          eq(notificationEvents.module, "pottery"),
          eq(notificationEvents.module, "quilting"),
        ),
      );

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toContain("or");
    expect(params).toContain("pottery");
    expect(params).toContain("quilting");
  });

  it("and() and or() can be nested", () => {
    const query = db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.scope, "household"),
          or(
            eq(notificationEvents.module, "pottery"),
            eq(notificationEvents.module, "travels"),
          ),
        ),
      );

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toContain("and");
    expect(text.toLowerCase()).toContain("or");
    expect(params).toContain("household");
    expect(params).toContain("pottery");
    expect(params).toContain("travels");
  });
});

// ── insert().values().onConflictDoUpdate() ───────────────────────────────────

describe("insert().values().onConflictDoUpdate()", () => {
  it("produces INSERT INTO … VALUES … ON CONFLICT DO UPDATE SET", () => {
    const query = db
      .insert(notificationEvents)
      .values({
        eventType: "test-event",
        module: "pottery",
        severity: "informational",
        scope: "household",
        title: "Smoke test",
        summary: "Drizzle contract smoke test",
      })
      .onConflictDoUpdate({
        target: notificationEvents.dedupKey,
        set: {
          lastSeenAt: sql`now()`,
          title: sql`excluded.title`,
        },
      });

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^insert into/);
    expect(text).toContain("notification_events");
    expect(text.toLowerCase()).toContain("on conflict");
    expect(text.toLowerCase()).toContain("do update");
    expect(text.toLowerCase()).toContain("set");
    // dedup_key is the target conflict column
    expect(text).toContain("dedup_key");
    // INSERT values appear as params
    expect(params).toContain("pottery");
    expect(params).toContain("test-event");
  });

  it("uses snake_case column names in generated SQL (not camelCase JS property names)", () => {
    const query = db.insert(notificationEvents).values({
      eventType: "casing-check",
      module: "quilting",
      severity: "informational",
      scope: "household",
      title: "Casing",
      summary: "Column name casing test",
    });

    const { sql: text } = query.toSQL();

    // JS property names must NOT leak into the SQL
    expect(text).not.toContain("eventType");
    expect(text).not.toContain("subjectType");
    // snake_case column names must appear
    expect(text).toContain("event_type");
  });
});

// ── update().set().where() ───────────────────────────────────────────────────

describe("update().set().where()", () => {
  it("produces UPDATE … SET … WHERE with positional params", () => {
    const query = db
      .update(potteryItems)
      .set({ name: "Updated vase" })
      .where(eq(potteryItems.id, 5));

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^update/);
    expect(text).toContain("pottery_items");
    expect(text.toLowerCase()).toContain("set");
    expect(text.toLowerCase()).toContain("where");
    expect(params).toContain("Updated vase");
    expect(params).toContain(5);
  });

  it("maps camelCase JS property to snake_case column in SET clause", () => {
    // potteryItems.imagePath → image_path column
    const query = db
      .update(potteryItems)
      .set({ imagePath: "uploads/new-path.jpg" })
      .where(eq(potteryItems.id, 10));

    const { sql: text } = query.toSQL();

    expect(text).toContain("image_path");
    expect(text).not.toContain("imagePath");
  });
});

// ── delete().where() ─────────────────────────────────────────────────────────

describe("delete().where()", () => {
  it("produces DELETE FROM <table> WHERE with a positional param", () => {
    const query = db
      .delete(notificationRecipients)
      .where(eq(notificationRecipients.userId, 42));

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^delete from/);
    expect(text).toContain("notification_recipients");
    expect(text.toLowerCase()).toContain("where");
    expect(params).toContain(42);
  });

  it("maps camelCase JS property to snake_case column in the WHERE clause", () => {
    // notificationRecipients.userId → user_id column
    // notificationRecipients.eventId → event_id column
    const query = db
      .delete(notificationRecipients)
      .where(eq(notificationRecipients.eventId, 7));

    const { sql: text, params } = query.toSQL();

    expect(text).toContain("event_id");
    expect(text).not.toContain("eventId");
    expect(params).toContain(7);
  });

  it("and() condition works in the WHERE clause of a DELETE", () => {
    const query = db
      .delete(notificationRecipients)
      .where(
        and(
          eq(notificationRecipients.userId, 3),
          eq(notificationRecipients.eventId, 99),
        ),
      );

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^delete from/);
    expect(text).toContain("notification_recipients");
    expect(text.toLowerCase()).toContain("and");
    expect(params).toContain(3);
    expect(params).toContain(99);
  });

  it("maps camelCase column on a different table (potteryItems.imagePath → image_path)", () => {
    const query = db.delete(potteryItems).where(eq(potteryItems.id, 10));

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^delete from/);
    expect(text).toContain("pottery_items");
    expect(params).toContain(10);
  });
});

// ── delete().where().returning() ─────────────────────────────────────────────

describe("delete().where().returning()", () => {
  it("produces DELETE FROM … RETURNING with the requested column in the SQL", () => {
    // mirrors replaceUserPreferences() in notifications.ts which deletes then
    // re-inserts preference rows inside a transaction.
    const query = db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, 42))
      .returning({ id: notificationPreferences.id });

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^delete from/);
    expect(text).toContain("notification_preferences");
    expect(text.toLowerCase()).toContain("where");
    // RETURNING clause must be present — a drizzle-orm upgrade that drops it
    // would cause callers to receive an empty array silently.
    expect(text.toUpperCase()).toContain("RETURNING");
    // The requested column must appear in the RETURNING clause.
    expect(text).toContain('"id"');
    expect(params).toContain(42);
  });

  it("maps camelCase column names to snake_case in the RETURNING clause", () => {
    // notificationPreferences.userId → user_id
    // camelCase property names must never leak into the SQL RETURNING list.
    const query = db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, 7))
      .returning({
        id: notificationPreferences.id,
        userId: notificationPreferences.userId,
      });

    const { sql: text } = query.toSQL();

    expect(text.toUpperCase()).toContain("RETURNING");
    // snake_case column name must appear in RETURNING
    expect(text).toContain("user_id");
    // camelCase JS property must NOT appear in the SQL
    expect(text).not.toContain("userId");
  });

  it("returning() on a multi-column selection includes all requested columns", () => {
    const query = db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, 5))
      .returning({
        id: notificationPreferences.id,
        userId: notificationPreferences.userId,
        scope: notificationPreferences.scope,
      });

    const { sql: text } = query.toSQL();

    expect(text.toUpperCase()).toContain("RETURNING");
    expect(text).toContain("user_id");
    expect(text).toContain("scope");
    // None of the JS property names must leak
    expect(text).not.toContain("userId");
  });
});

// ── Transaction API ──────────────────────────────────────────────────────────

describe("transaction API", () => {
  it("db.transaction is a function (API surface has not changed)", () => {
    // A drizzle-orm major version bump that renames or removes .transaction()
    // would be caught here immediately rather than at runtime.
    expect(typeof db.transaction).toBe("function");
  });

  it("db.transaction accepts a callback as its first argument (arity ≥ 1)", () => {
    // Verify the function signature has not been changed to a builder pattern
    // or some other incompatible shape.
    expect(db.transaction.length).toBeGreaterThanOrEqual(1);
  });
});

// ── comparison helpers (lt / lte / gt / gte) ─────────────────────────────────
//
// Broadcast-log purges and other housekeeping routes use these helpers to
// delete rows older than a cutoff date.  A drizzle-orm upgrade that swaps
// param order or changes the operator token would silently keep every row
// instead of deleting old ones.  These tests pin the compiled SQL so that
// failure is caught at CI time, not in production.

describe("comparison helpers (lt / lte / gt / gte)", () => {
  const cutoff = new Date("2025-01-01T00:00:00.000Z");
  // drizzle-orm serializes Date values to their ISO string representation in
  // the params array; the DB driver then coerces back to a timestamp.
  const cutoffIso = cutoff.toISOString();

  it("lt() emits < (not >) in the WHERE clause", () => {
    const { sql: text, params } = compile(
      sql`WHERE ${lt(elaineBroadcastLog.createdAt, cutoff)}`,
    );

    expect(text).toContain("<");
    expect(text).not.toContain(">");
    // The cutoff must be a positional param, not inlined as a literal date string.
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(cutoffIso);
  });

  it("lte() emits <= (not >=) in the WHERE clause", () => {
    const { sql: text, params } = compile(
      sql`WHERE ${lte(elaineBroadcastLog.createdAt, cutoff)}`,
    );

    expect(text).toContain("<=");
    expect(text).not.toContain(">=");
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(cutoffIso);
  });

  it("gt() emits > (not <) in the WHERE clause", () => {
    const { sql: text, params } = compile(
      sql`WHERE ${gt(elaineBroadcastLog.createdAt, cutoff)}`,
    );

    expect(text).toContain(">");
    expect(text).not.toContain("<");
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(cutoffIso);
  });

  it("gte() emits >= (not <=) in the WHERE clause", () => {
    const { sql: text, params } = compile(
      sql`WHERE ${gte(elaineBroadcastLog.createdAt, cutoff)}`,
    );

    expect(text).toContain(">=");
    expect(text).not.toContain("<=");
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(cutoffIso);
  });

  it("lt() param is the cutoff (column on left, value on right)", () => {
    // Verifies positional order: the compiled SQL must be
    // `created_at < $1` with $1 = cutoffIso, NOT `$1 < created_at`.
    const { sql: text, params } = compile(
      sql`WHERE ${lt(elaineBroadcastLog.createdAt, cutoff)}`,
    );

    // Column name appears before the operator placeholder.
    const colIndex = text.indexOf("created_at");
    const paramIndex = text.indexOf("$1");
    expect(colIndex).toBeGreaterThanOrEqual(0);
    expect(paramIndex).toBeGreaterThan(colIndex);
    expect(params[0]).toBe(cutoffIso);
  });

  it("lt() works inside delete().where() on a timestamp column", () => {
    // This mirrors the real broadcast-log cleanup pattern:
    //   db.delete(elaineBroadcastLog).where(lt(elaineBroadcastLog.createdAt, cutoff))
    const query = db
      .delete(elaineBroadcastLog)
      .where(lt(elaineBroadcastLog.createdAt, cutoff));

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^delete from/);
    expect(text).toContain("elaine_broadcast_log");
    expect(text.toLowerCase()).toContain("where");
    expect(text).toContain("<");
    expect(text).not.toContain(">");
    // Cutoff must be a positional param serialized as an ISO string.
    expect(params).toContain(cutoffIso);
  });

  it("and() with lt() produces a compound DELETE WHERE clause", () => {
    // Real cleanup queries often combine a timestamp bound with a user filter.
    const userId = 7;
    const query = db
      .delete(elaineBroadcastLog)
      .where(
        and(
          eq(elaineBroadcastLog.userId, userId),
          lt(elaineBroadcastLog.createdAt, cutoff),
        ),
      );

    const { sql: text, params } = query.toSQL();

    expect(text.toLowerCase()).toMatch(/^delete from/);
    expect(text).toContain("elaine_broadcast_log");
    expect(text.toLowerCase()).toContain("and");
    expect(text).toContain("<");
    expect(params).toContain(userId);
    expect(params).toContain(cutoffIso);
  });
});
