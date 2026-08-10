/**
 * Schema-consistency test for scheduler-guard ↔ schema-statements.ts
 *
 * scheduler-guard.test.ts mocks db.execute entirely, which means those
 * unit tests stay green even if scheduler_runs columns are renamed or
 * removed from the DDL. This file closes that gap without requiring a
 * live database: it parses the scheduler_runs CREATE TABLE and
 * ALTER TABLE … ADD COLUMN statements in schema-statements.ts and
 * asserts that every column referenced by the guard SQL is present.
 *
 * If a column is renamed in either place CI fails with a message that
 * names the missing column.
 */

import { describe, it, expect } from "vitest";
import { STATEMENTS } from "../../../../lib/db/src/schema-statements";

// ── Column names referenced by scheduler-guard.ts ───────────────────────────
//
// Keep this list in sync with the SQL inside claimScheduledTaskRun(),
// recordScheduledTaskSuccess(), and startSchedulerHeartbeat():
//
//   claimScheduledTaskRun INSERT:       name, last_run_at, expected_interval_ms, last_claim_granted
//   claimScheduledTaskRun ON CONFLICT:  expected_interval_ms, last_claim_granted, last_run_at,
//                                        scheduler_runs.last_run_at, scheduler_runs.last_success_at
//   claimScheduledTaskRun RETURNING:    name, last_claim_granted (AS claimed), last_run_at, last_success_at
//   recordScheduledTaskSuccess UPDATE:  last_success_at  WHERE name
//   startSchedulerHeartbeat SELECT:     name, last_run_at, last_success_at, expected_interval_ms
//
// Note: "claimed" in RETURNING is an alias for last_claim_granted — the real column name is last_claim_granted.
const GUARD_REQUIRED_COLUMNS = [
  "name",
  "last_run_at",
  "last_success_at",
  "expected_interval_ms",
  "last_claim_granted",
] as const;

// ── DDL parser ───────────────────────────────────────────────────────────────

/**
 * Extract every column name declared for `scheduler_runs` across all
 * statements in STATEMENTS (CREATE TABLE + ALTER TABLE … ADD COLUMN).
 *
 * Returns a Set of lowercased column names.
 */
function extractSchedulerRunsColumns(statements: string[]): Set<string> {
  const cols = new Set<string>();

  for (const stmt of statements) {
    const normalized = stmt.replace(/\s+/g, " ").trim();

    // ── CREATE TABLE IF NOT EXISTS scheduler_runs ( … ) ──────────────────
    const createMatch = normalized.match(
      /CREATE TABLE IF NOT EXISTS scheduler_runs\s*\((.+)\)/i,
    );
    if (createMatch) {
      const body = createMatch[1];
      // Split on commas that aren't inside parentheses (handles CHECK constraints etc.)
      const parts = splitTopLevelCommas(body);
      for (const part of parts) {
        const trimmed = part.trim();
        // Skip table-level constraints (PRIMARY KEY (...), UNIQUE (...), CHECK, CONSTRAINT …)
        if (
          /^(PRIMARY\s+KEY|UNIQUE|CHECK|CONSTRAINT)\s/i.test(trimmed) ||
          trimmed === ""
        ) {
          continue;
        }
        // First token is the column name
        const colName = trimmed.split(/\s+/)[0];
        if (colName) cols.add(colName.toLowerCase());
      }
      continue;
    }

    // ── ALTER TABLE scheduler_runs ADD COLUMN [IF NOT EXISTS] <colname> … ──
    const alterMatch = normalized.match(
      /ALTER TABLE scheduler_runs ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)/i,
    );
    if (alterMatch) {
      cols.add(alterMatch[1].toLowerCase());
    }
  }

  return cols;
}

/**
 * Split a string on top-level commas (those not inside parentheses).
 * Used to tokenise a CREATE TABLE column list that may contain constraint
 * expressions with nested parentheses.
 */
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("scheduler_runs DDL ↔ scheduler-guard column consistency", () => {
  it("scheduler_runs DDL contains at least one CREATE TABLE statement", () => {
    const createStmts = STATEMENTS.filter((s) =>
      /CREATE TABLE IF NOT EXISTS scheduler_runs/i.test(s),
    );
    if (createStmts.length < 1) {
      throw new Error(
        "Expected at least one CREATE TABLE IF NOT EXISTS scheduler_runs statement in schema-statements.ts",
      );
    }
    expect(createStmts.length).toBeGreaterThanOrEqual(1);
  });

  it("every column referenced by scheduler-guard.ts SQL exists in the scheduler_runs DDL", () => {
    const ddlColumns = extractSchedulerRunsColumns(STATEMENTS);

    // Fail with a specific message for each missing column so the developer
    // knows exactly which rename or omission broke the guard.
    const missing = GUARD_REQUIRED_COLUMNS.filter(
      (col) => !ddlColumns.has(col),
    );

    if (missing.length > 0) {
      throw new Error(
        `scheduler_runs DDL is missing column(s) referenced by scheduler-guard.ts: ` +
          missing.join(", ") +
          `\n\nColumns found in DDL: ${[...ddlColumns].sort().join(", ")}\n` +
          `\nTo fix: add the missing column(s) to scheduler_runs in lib/db/src/schema-statements.ts, ` +
          `or update GUARD_REQUIRED_COLUMNS in this test if the guard SQL was intentionally changed.`,
      );
    }

    expect(missing).toHaveLength(0);
  });

  it("every column in GUARD_REQUIRED_COLUMNS is individually present in the DDL", () => {
    const ddlColumns = extractSchedulerRunsColumns(STATEMENTS);

    for (const col of GUARD_REQUIRED_COLUMNS) {
      expect(
        ddlColumns,
        `Column "${col}" is missing from scheduler_runs DDL`,
      ).toContain(col);
    }
  });

  it("DDL parser extracts the expected set of scheduler_runs columns", () => {
    // Snapshot the full column set so that adding a new column forces an
    // explicit review of whether scheduler-guard.ts also needs updating.
    // If you add a new column to scheduler_runs, add it here too (and
    // consider whether scheduler-guard.ts should reference it).
    const ddlColumns = extractSchedulerRunsColumns(STATEMENTS);
    const expected = new Set([
      "name",
      "last_run_at",
      "last_success_at",
      "expected_interval_ms",
      "last_claim_granted",
    ]);

    const unexpectedInDDL = [...ddlColumns].filter((c) => !expected.has(c));
    const missingFromDDL = [...expected].filter((c) => !ddlColumns.has(c));

    if (unexpectedInDDL.length > 0 || missingFromDDL.length > 0) {
      const parts: string[] = [];
      if (unexpectedInDDL.length > 0) {
        parts.push(
          `New column(s) in DDL not yet tracked in this snapshot: ${unexpectedInDDL.join(", ")}. ` +
            `If scheduler-guard.ts references them, add them to GUARD_REQUIRED_COLUMNS.`,
        );
      }
      if (missingFromDDL.length > 0) {
        parts.push(
          `Column(s) missing from DDL that were previously present: ${missingFromDDL.join(", ")}.`,
        );
      }
      throw new Error(parts.join("\n"));
    }

    expect(ddlColumns).toEqual(expected);
  });
});
