/**
 * apply-pr-suggestions.test.ts
 *
 * Unit tests for the pure logic in apply-pr-suggestions.ts: suggestion-block
 * parsing, bot/position eligibility, overlap detection, and edit application.
 *
 * Run: tsx ./src/apply-pr-suggestions.test.ts
 */
import assert from "node:assert/strict";
import {
  applyEdits,
  commentToEdit,
  extractSuggestionLines,
  hasResolvablePosition,
  isAfterTimestamp,
  isAlreadyApplied,
  isBotComment,
  isOnCurrentHead,
  parseAfterArg,
  planEdits,
} from "./apply-pr-suggestions.js";
import type { ReviewComment, SuggestionEdit } from "./apply-pr-suggestions.js";

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 1,
    commit_id: "abc1234def5678901234567890123456789012ab",
    created_at: "2026-01-01T00:00:00Z",
    path: "src/foo.ts",
    body: "```suggestion\nconst x = 1;\n```",
    line: 10,
    start_line: null,
    side: "RIGHT",
    user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
    html_url: "https://github.com/x/y/pull/1#discussion_r1",
    ...overrides,
  };
}

function makeEdit(overrides: Partial<SuggestionEdit> = {}): SuggestionEdit {
  return {
    path: "src/foo.ts",
    startLine: 5,
    endLine: 5,
    replacementLines: ["const x = 1;"],
    commentUrl: "https://github.com/x/y/pull/1#discussion_r1",
    commentId: 1,
    author: "copilot-pull-request-reviewer[bot]",
    ...overrides,
  };
}

// ── extractSuggestionLines ──────────────────────────────────────────────

{
  const single = extractSuggestionLines("```suggestion\nconst x = 1;\n```");
  assert.deepEqual(single, ["const x = 1;"], "single-line suggestion");

  const multi = extractSuggestionLines(
    "See below:\n```suggestion\nline one\nline two\n```\nThanks!",
  );
  assert.deepEqual(multi, ["line one", "line two"], "multi-line suggestion");

  const none = extractSuggestionLines("Just a comment, no suggestion here.");
  assert.equal(none, null, "no suggestion block returns null");

  const empty = extractSuggestionLines("```suggestion\n```");
  assert.deepEqual(empty, [], "empty suggestion body deletes the range");

  console.log("✓ extractSuggestionLines parses fenced suggestion blocks");
}

// ── isBotComment / hasResolvablePosition ────────────────────────────────

{
  assert.equal(isBotComment(makeComment()), true, "bot user.type is eligible");
  assert.equal(
    isBotComment(makeComment({ user: { login: "someone", type: "User" } })),
    false,
    "human user.type is never eligible",
  );

  assert.equal(
    hasResolvablePosition(makeComment()),
    true,
    "line set + RIGHT side is resolvable",
  );
  assert.equal(
    hasResolvablePosition(makeComment({ line: null })),
    false,
    "null line (outdated comment) is not resolvable",
  );
  assert.equal(
    hasResolvablePosition(makeComment({ side: "LEFT" })),
    false,
    "LEFT-side comments are not resolvable",
  );

  console.log("✓ isBotComment / hasResolvablePosition gate correctly");
}

// ── isOnCurrentHead ──────────────────────────────────────────────────────

{
  const HEAD = "abc1234def5678901234567890123456789012ab";
  const OTHER = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  assert.equal(
    isOnCurrentHead(makeComment(), HEAD),
    true,
    "comment with matching head SHA is retained",
  );
  assert.equal(
    isOnCurrentHead(makeComment({ commit_id: OTHER }), HEAD),
    false,
    "comment from an earlier commit SHA is rejected",
  );
  assert.equal(
    isOnCurrentHead(makeComment({ commit_id: OTHER }), OTHER),
    true,
    "predicate is symmetric: any SHA matches itself",
  );

  console.log(
    "✓ isOnCurrentHead retains current-head comments and rejects stale ones",
  );
}

// ── isAfterTimestamp ──────────────────────────────────────────────────────

{
  const CUTOFF = "2026-08-21T17:30:00Z";
  const CUTOFF_MS = Date.parse(CUTOFF);

  assert.equal(
    isAfterTimestamp(
      makeComment({ created_at: "2026-08-21T17:00:00Z" }),
      CUTOFF_MS,
    ),
    false,
    "comment before cutoff is rejected",
  );
  assert.equal(
    isAfterTimestamp(makeComment({ created_at: CUTOFF }), CUTOFF_MS),
    true,
    "comment exactly at cutoff is retained (inclusive boundary)",
  );
  assert.equal(
    isAfterTimestamp(
      makeComment({ created_at: "2026-08-21T18:00:00Z" }),
      CUTOFF_MS,
    ),
    true,
    "comment after cutoff is retained",
  );

  console.log(
    "✓ isAfterTimestamp enforces promotion-time boundary — before rejected, equal/after retained",
  );
}

// ── parseAfterArg ─────────────────────────────────────────────────────────

{
  // Absent flag → undefined (no filtering).
  assert.equal(
    parseAfterArg(["--dry-run"]),
    undefined,
    "--after absent returns undefined",
  );

  // Present with a valid value → returns the value.
  assert.equal(
    parseAfterArg(["--after", "2026-08-21T17:30:00Z"]),
    "2026-08-21T17:30:00Z",
    "--after with value returns that value",
  );

  // Present without a following value → throws.
  assert.throws(
    () => parseAfterArg(["--after"]),
    /--after requires an ISO timestamp/,
    "--after as last arg throws a descriptive error",
  );

  // Present followed by another flag → throws (not silently disabled).
  assert.throws(
    () => parseAfterArg(["--after", "--dry-run"]),
    /--after requires an ISO timestamp/,
    "--after followed by another flag throws",
  );

  console.log(
    "✓ parseAfterArg returns undefined when absent, value when present, throws when missing",
  );
}

// ── commentToEdit ────────────────────────────────────────────────────────

{
  const edit = commentToEdit(makeComment());
  assert.ok(edit, "eligible comment converts to an edit");
  assert.equal(
    edit!.startLine,
    10,
    "single-line: startLine falls back to line",
  );
  assert.equal(edit!.endLine, 10);
  assert.deepEqual(edit!.replacementLines, ["const x = 1;"]);

  const multiLine = commentToEdit(
    makeComment({
      start_line: 8,
      line: 10,
      body: "```suggestion\na\nb\nc\n```",
    }),
  );
  assert.equal(multiLine!.startLine, 8);
  assert.equal(multiLine!.endLine, 10);

  assert.equal(
    commentToEdit(makeComment({ user: { login: "human", type: "User" } })),
    null,
    "human comments never produce an edit",
  );
  assert.equal(
    commentToEdit(makeComment({ line: null })),
    null,
    "outdated comments never produce an edit",
  );
  assert.equal(
    commentToEdit(makeComment({ body: "no suggestion here" })),
    null,
    "comments without a suggestion block never produce an edit",
  );

  console.log("✓ commentToEdit combines eligibility + parsing correctly");
}

// ── planEdits: overlap detection ─────────────────────────────────────────

{
  const nonOverlapping = [
    makeEdit({ startLine: 3, endLine: 3 }),
    makeEdit({ startLine: 10, endLine: 12 }),
  ];
  const plan1 = planEdits(nonOverlapping);
  assert.equal(
    plan1.conflicts.length,
    0,
    "non-overlapping edits: no conflicts",
  );
  assert.equal(
    plan1.applicable.get("src/foo.ts")?.length,
    2,
    "non-overlapping edits are both applicable",
  );
  // Applicable list must be sorted descending by startLine (bottom-up apply order).
  assert.equal(plan1.applicable.get("src/foo.ts")?.[0]?.startLine, 10);

  const overlapping = [
    makeEdit({ startLine: 5, endLine: 8, commentId: 1 }),
    makeEdit({ startLine: 7, endLine: 9, commentId: 2 }),
  ];
  const plan2 = planEdits(overlapping);
  assert.equal(
    plan2.conflicts.length,
    2,
    "overlapping edits: both flagged as conflicts",
  );
  assert.equal(
    plan2.applicable.has("src/foo.ts"),
    false,
    "overlapping edits: nothing applicable for that file",
  );

  // Cross-file edits never conflict with each other.
  const crossFile = [
    makeEdit({ path: "src/a.ts", startLine: 5, endLine: 8 }),
    makeEdit({ path: "src/b.ts", startLine: 5, endLine: 8 }),
  ];
  const plan3 = planEdits(crossFile);
  assert.equal(
    plan3.conflicts.length,
    0,
    "same line range in different files is fine",
  );
  assert.equal(plan3.applicable.size, 2, "both files get an applicable edit");

  console.log(
    "✓ planEdits detects overlaps within a file, ignores cross-file ranges",
  );
}

// ── isAlreadyApplied / applyEdits ────────────────────────────────────────

{
  const lines = ["a", "b", "OLD", "d", "e"];
  const edit = makeEdit({
    startLine: 3,
    endLine: 3,
    replacementLines: ["NEW"],
  });
  assert.equal(isAlreadyApplied(lines, edit), false);
  assert.equal(
    isAlreadyApplied(["a", "b", "NEW", "d", "e"], edit),
    true,
    "identical target range is treated as already applied",
  );

  const { newLines, applied, noop } = applyEdits(lines, [edit]);
  assert.deepEqual(newLines, ["a", "b", "NEW", "d", "e"]);
  assert.equal(applied.length, 1);
  assert.equal(noop.length, 0);

  // Bottom-up application: an earlier (lower-numbered) edit must still land
  // on the correct lines even after a later edit changed the line count.
  const original = ["1", "2", "3", "4", "5"];
  const shrinking = makeEdit({
    startLine: 4,
    endLine: 5,
    replacementLines: ["four-five"], // 2 lines -> 1 line
  });
  const earlier = makeEdit({
    startLine: 1,
    endLine: 1,
    replacementLines: ["ONE"],
  });
  const result = applyEdits(original, [shrinking, earlier]); // descending order as planEdits would produce
  assert.deepEqual(result.newLines, ["ONE", "2", "3", "four-five"]);
  assert.equal(result.applied.length, 2);

  // A no-op edit mixed with a real one: only the real one is reported applied.
  const mixedLines = ["a", "b", "c"];
  const already = makeEdit({
    startLine: 1,
    endLine: 1,
    replacementLines: ["a"],
  });
  const real = makeEdit({ startLine: 3, endLine: 3, replacementLines: ["C"] });
  const mixedResult = applyEdits(mixedLines, [real, already]);
  assert.deepEqual(mixedResult.newLines, ["a", "b", "C"]);
  assert.equal(mixedResult.applied.length, 1);
  assert.equal(mixedResult.noop.length, 1);

  console.log("✓ applyEdits applies bottom-up and correctly reports no-ops");
}

console.log("✓ apply-pr-suggestions tests passed");
