import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, elaineCodeSuggestions } from "@workspace/db";

/**
 * Regression guard for a real bug caught in code review: `elaine_code_suggestions`
 * only has a PARTIAL unique index —
 *   CREATE UNIQUE INDEX ... ON elaine_code_suggestions (pattern_key)
 *     WHERE status = 'pending'
 * (see schema-statements.ts) — not a plain unique constraint on pattern_key.
 *
 * Postgres cannot infer a partial unique index from `ON CONFLICT (pattern_key)`
 * alone; the INSERT must repeat the exact index predicate as the conflict
 * target's WHERE clause, or Postgres rejects the statement with
 * "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification" on every attempted insert (never silently degrades — the
 * whole diagnosis-suggestion feature would be dead on arrival).
 *
 * This test does NOT touch a live database — `.toSQL()` only compiles the
 * query locally — but it exercises the real (unmocked) drizzle table/dialect,
 * so it fails if the onConflictDoNothing() call in elaine-code-diagnosis.ts
 * ever loses its `where` clause or the predicate text drifts out of sync with
 * schema-statements.ts.
 */
describe("elaine_code_suggestions insert — ON CONFLICT matches the partial unique index", () => {
  it("generates a conflict clause with the same predicate as the partial unique index", () => {
    const query = db
      .insert(elaineCodeSuggestions)
      .values({
        patternKey: "self_heal:claimed_check_without_tool_call",
        occurrenceCount: 3,
        observedPattern: "test",
        hypothesis: "test",
        status: "pending",
      })
      .onConflictDoNothing({
        target: elaineCodeSuggestions.patternKey,
        where: sql`status = 'pending'`,
      });

    const { sql: generatedSql } = query.toSQL();
    const normalized = generatedSql.toLowerCase().replace(/\s+/g, " ");

    expect(normalized).toContain("on conflict");
    expect(normalized).toContain("pattern_key");
    // The predicate must be present verbatim so Postgres can match it against
    // the partial index's own WHERE clause during arbiter inference.
    expect(normalized).toContain("where status = 'pending'");
    expect(normalized).toContain("do nothing");
  });

  it("would NOT match the partial index if the where predicate were omitted (documents the bug this guards against)", () => {
    const badQuery = db
      .insert(elaineCodeSuggestions)
      .values({
        patternKey: "self_heal:claimed_check_without_tool_call",
        occurrenceCount: 3,
        observedPattern: "test",
        hypothesis: "test",
        status: "pending",
      })
      .onConflictDoNothing({
        target: elaineCodeSuggestions.patternKey,
      });

    const { sql: generatedSql } = badQuery.toSQL();
    const normalized = generatedSql.toLowerCase().replace(/\s+/g, " ");

    // Confirms our understanding of the bug: a bare target with no matching
    // `where` produces a plain, unconditional ON CONFLICT (pattern_key)
    // clause — which Postgres rejects against a partial-only unique index.
    expect(normalized).not.toContain("where status = 'pending'");
  });
});
