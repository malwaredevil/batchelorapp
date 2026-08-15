import { describe, expect, it } from "vitest";
import {
  ElainePlanInputSchema,
  sanitizeRuntimeText,
  toRuntimePlan,
  type ElainePlanInput,
} from "./contracts";

describe("sanitizeRuntimeText", () => {
  // ── Complete reasoning blocks ─────────────────────────────────────────────

  it("strips a complete <think>…</think> pair", () => {
    const input =
      "<think>This is internal reasoning that must not leak.</think>Answer.";
    expect(sanitizeRuntimeText(input)).toBe(
      "[private reasoning omitted]Answer.",
    );
  });

  it("strips a complete <thinking>…</thinking> pair", () => {
    const input = "<thinking>internal</thinking>Done.";
    expect(sanitizeRuntimeText(input)).toBe("[private reasoning omitted]Done.");
  });

  it("strips a complete <reasoning>…</reasoning> pair", () => {
    const input = "<reasoning>step 1, step 2</reasoning>Result.";
    expect(sanitizeRuntimeText(input)).toBe(
      "[private reasoning omitted]Result.",
    );
  });

  it("strips multiple complete reasoning blocks in one string", () => {
    const input = "<think>plan A</think>Middle.<think>plan B</think>End.";
    expect(sanitizeRuntimeText(input)).toBe(
      "[private reasoning omitted]Middle.[private reasoning omitted]End.",
    );
  });

  it("strips reasoning tags case-insensitively", () => {
    const input = "<THINK>Internal</THINK>Answer.";
    expect(sanitizeRuntimeText(input)).toBe(
      "[private reasoning omitted]Answer.",
    );
  });

  it("strips reasoning that spans multiple lines", () => {
    const input = "<think>\nline one\nline two\n</think>Result.";
    expect(sanitizeRuntimeText(input)).toBe(
      "[private reasoning omitted]Result.",
    );
  });

  // ── Bare opening tag (JSON parse error messages) ──────────────────────────
  //
  // When extractJson calls JSON.parse on a model response that starts with a
  // <think> tag, the JS engine embeds a truncated snippet of the input in the
  // error message, e.g.:
  //   "Unexpected token '<', \"<think>SE\"... is not valid JSON"
  //
  // HIDDEN_REASONING_RE only matches complete open+close tag pairs, so the
  // bare opening-tag fragment that appears in that error string is intentionally
  // NOT stripped by sanitizeRuntimeText.
  //
  // Team decision (locked in by this test): the fragment `<think>` in an error
  // message reveals that the model used hidden reasoning, but does not reveal
  // the content of that reasoning.  That disclosure is acceptable — it is
  // equivalent to saying "JSON was rejected because the response started with a
  // reasoning block" — and suppressing it would require a broader regex that
  // could over-strip legitimate user content containing angle-bracket tokens.
  // If the policy changes, update HIDDEN_REASONING_RE and this test together.

  it("does NOT strip a bare <think> opening tag with no matching close tag", () => {
    // This is the exact form that appears in a JSON.parse error message such as:
    //   Unexpected token '<', "<think>SE"... is not valid JSON
    const errorMessage =
      "Unexpected token '<', \"<think>SE\"... is not valid JSON";
    const result = sanitizeRuntimeText(errorMessage);
    // The fragment `<think>` survives because there is no closing </think>.
    expect(result).toContain("<think>");
    // But the result is still length-bounded.
    expect(result.length).toBeLessThanOrEqual(240);
  });

  it("does NOT strip a bare </think> closing tag with no matching open tag", () => {
    const input = "some text </think> and more";
    expect(sanitizeRuntimeText(input)).toContain("</think>");
  });

  it("strips the complete pair even when content contains angle-bracket tokens", () => {
    // Verify that a complete pair whose body includes angle-bracket-like text
    // is still stripped in full — the greedy [\s\S]*? only stops at the first
    // matching close tag, so this is not ambiguous.
    const input = "<think>foo <bar> baz</think>Answer.";
    expect(sanitizeRuntimeText(input)).toBe(
      "[private reasoning omitted]Answer.",
    );
  });

  // ── Other redaction rules ─────────────────────────────────────────────────

  it("redacts Bearer tokens", () => {
    // BEARER_RE runs first and replaces the token value; then SECRET_ASSIGNMENT_RE
    // matches the "Authorization:" prefix that remains, so the final string contains
    // "[redacted]" in place of both the key/value and the token literal — the token
    // itself is never present in the output.
    const input = "Authorization: Bearer abc123.def456.ghi789";
    const result = sanitizeRuntimeText(input);
    expect(result).not.toContain("abc123");
    expect(result).toContain("[redacted]");
  });

  it("redacts secret assignments", () => {
    const input = "api_key=supersecretvalue and something else";
    const result = sanitizeRuntimeText(input);
    expect(result).toContain("api_key=[redacted]");
    expect(result).not.toContain("supersecretvalue");
  });

  it("redacts a Postgres connection string", () => {
    const input = "connect using postgresql://user:pass@host:5432/db";
    const result = sanitizeRuntimeText(input);
    expect(result).toContain("[database connection redacted]");
    expect(result).not.toContain("user:pass");
  });

  // ── Length truncation ─────────────────────────────────────────────────────

  it("truncates output to maxLength (default 240)", () => {
    const input = "a".repeat(500);
    expect(sanitizeRuntimeText(input).length).toBe(240);
  });

  it("respects a custom maxLength", () => {
    const input = "a".repeat(100);
    expect(sanitizeRuntimeText(input, 50).length).toBe(50);
  });

  it("normalises whitespace", () => {
    expect(sanitizeRuntimeText("hello   world\n\tthere")).toBe(
      "hello world there",
    );
  });

  it("handles null and undefined gracefully", () => {
    expect(sanitizeRuntimeText(null)).toBe("");
    expect(sanitizeRuntimeText(undefined)).toBe("");
  });

  // ── Entire-value reasoning block (goal / label edge case) ─────────────────
  //
  // If a model returns a goal or step label that is *entirely* inside a
  // reasoning block with no surrounding text, sanitizeRuntimeText must produce
  // "[private reasoning omitted]" — not an empty string and not the raw content.
  //
  // Downstream: toRuntimePlan feeds the result straight into ElainePlan.goal.
  // The Zod schema for ElainePlanInput requires goal.min(1), so a blank result
  // would be caught at parse time and the planner would reject the whole plan,
  // falling back to an unplanned turn. "[private reasoning omitted]" satisfies
  // min(1) and gives the trace a visible, non-secret placeholder, which is the
  // intended behaviour.

  it("returns '[private reasoning omitted]' when the entire input is a <think> block", () => {
    const input =
      "<think>This is ALL of the model output — no visible text.</think>";
    expect(sanitizeRuntimeText(input)).toBe("[private reasoning omitted]");
  });

  it("returns '[private reasoning omitted]' when the entire input is a <thinking> block", () => {
    const input = "<thinking>internal monologue only</thinking>";
    expect(sanitizeRuntimeText(input)).toBe("[private reasoning omitted]");
  });

  it("returns '[private reasoning omitted]' when the entire input is a <reasoning> block", () => {
    const input = "<reasoning>step-by-step private reasoning</reasoning>";
    expect(sanitizeRuntimeText(input)).toBe("[private reasoning omitted]");
  });

  it("does not return an empty string when the entire input is a reasoning block", () => {
    const input = "<think>hidden</think>";
    const result = sanitizeRuntimeText(input);
    // Must not be blank — the trace must have a visible placeholder.
    expect(result).not.toBe("");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── ElainePlanInputSchema: schema-level vs. runtime-sanitisation boundary ────────
//
// Contract (locked in by these tests):
//
//   1. ElainePlanInputSchema.parse operates on the RAW pre-sanitized input.
//      A goal that is entirely a reasoning block (e.g. "<think>…</think>")
//      is a non-empty string, so it satisfies goal.min(1) and the schema
//      ACCEPTS it.  The schema is not the sanitization layer.
//
//   2. toRuntimePlan is the sanitization layer.  It calls sanitizeRuntimeText
//      which replaces a pure reasoning block with "[private reasoning omitted]".
//      That sentinel is non-empty, so it survives into ElainePlan.goal and
//      gives the trace a visible, non-secret placeholder.
//
//   3. A truly blank goal (empty string or whitespace-only) is rejected at
//      parse time by goal.min(1), making the planner fall back to an
//      unplanned turn.  This is the only rejection path at the schema level.
//
// If the intended contract ever changes so that ElainePlanInputSchema itself
// strips or rejects reasoning blocks, update these tests together with the
// schema.

describe("ElainePlanInputSchema — goal validation boundary", () => {
  const MINIMAL_VALID_STEP = {
    id: "s1",
    label: "Look up the answer",
    kind: "lookup" as const,
    toolName: null,
    dependsOn: [],
    expectedEvidence: "The answer is found.",
    required: true,
  };

  const baseInput = {
    version: 1 as const,
    assumptions: [],
    completionCriteria: ["User receives an answer."],
    steps: [MINIMAL_VALID_STEP],
  };

  // ── Contract point 1: schema sees the raw string ───────────────────────────

  it("parses successfully when the goal is entirely a <think> block (raw string is non-empty)", () => {
    // The schema validates the RAW input before sanitization.
    // "<think>…</think>" is a non-empty string → min(1) is satisfied → parse succeeds.
    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      goal: "<think>Private internal goal — should never appear in a trace.</think>",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // The raw reasoning content is preserved in the parsed value;
      // sanitization happens later in toRuntimePlan, not at parse time.
      expect(result.data.goal).toContain("<think>");
    }
  });

  it("parses successfully when the goal is a <thinking> block", () => {
    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      goal: "<thinking>internal monologue</thinking>",
    });
    expect(result.success).toBe(true);
  });

  it("parses successfully when the goal is a <reasoning> block", () => {
    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      goal: "<reasoning>step-by-step private reasoning</reasoning>",
    });
    expect(result.success).toBe(true);
  });

  // ── Contract point 2: toRuntimePlan is the sanitization layer ─────────────

  it("toRuntimePlan converts a pure-reasoning goal to the sentinel, not an empty string", () => {
    const raw = ElainePlanInputSchema.parse({
      ...baseInput,
      goal: "<think>Private goal that must not leak into the trace.</think>",
    });

    const plan = toRuntimePlan(raw);

    // The sentinel is non-empty — the trace always has a visible placeholder.
    expect(plan.goal).toBe("[private reasoning omitted]");
    expect(plan.goal.length).toBeGreaterThan(0);
    // Raw reasoning content must never appear in the trace.
    expect(plan.goal).not.toContain("Private goal");
    expect(plan.goal).not.toContain("<think>");
  });

  // ── Contract point 3: blank goals are rejected at schema parse time ────────

  it("rejects an empty goal with a Zod min(1) error", () => {
    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      goal: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues;
      const goalIssue = issues.find((i) => i.path.includes("goal"));
      expect(goalIssue).toBeDefined();
      // min(1) violation — not a type error
      expect(goalIssue?.code).toBe("too_small");
    }
  });

  it("rejects a whitespace-only goal (trimmed to empty) with a Zod min(1) error", () => {
    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      goal: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues;
      const goalIssue = issues.find((i) => i.path.includes("goal"));
      expect(goalIssue).toBeDefined();
      expect(goalIssue?.code).toBe("too_small");
    }
  });

  // ── End-to-end: schema parse → toRuntimePlan pipeline ─────────────────────

  it("full pipeline: schema accepts a pure-reasoning goal, toRuntimePlan produces the safe sentinel", () => {
    // This is the exact path the planner takes when the model returns a goal
    // that is entirely wrapped in a reasoning block.
    const rawGoal =
      "<think>This is ALL of the model output for the goal field — no visible text.</think>";

    // Step 1: schema validates the raw input (non-empty → passes)
    const parsed = ElainePlanInputSchema.parse({
      ...baseInput,
      goal: rawGoal,
    });
    expect(parsed.goal).toBe(rawGoal); // raw value preserved by the schema

    // Step 2: toRuntimePlan sanitizes it into the safe sentinel
    const plan = toRuntimePlan(parsed);
    expect(plan.goal).toBe("[private reasoning omitted]");

    // The sentinel satisfies min(1) — if the schema were to re-validate the
    // runtime plan's goal, it would still pass.
    expect(plan.goal.trim().length).toBeGreaterThan(0);
  });
});

// ── toRuntimePlan: goal / step label sanitisation ─────────────────────────────

const MINIMAL_STEP: ElainePlanInput["steps"][number] = {
  id: "s1",
  label: "Look up the answer",
  kind: "lookup",
  toolName: null,
  dependsOn: [],
  expectedEvidence: "The answer is found.",
  required: true,
};

describe("toRuntimePlan", () => {
  it("sanitizes a goal that is entirely wrapped in a <think> block", () => {
    const input: ElainePlanInput = {
      version: 1,
      goal: "<think>Private goal the model was computing.</think>",
      assumptions: [],
      completionCriteria: ["User receives an answer."],
      steps: [MINIMAL_STEP],
    };

    const plan = toRuntimePlan(input);

    // The goal must not contain raw reasoning content.
    expect(plan.goal).not.toContain("Private goal");
    // The goal must not be empty — "[private reasoning omitted]" is the sentinel.
    expect(plan.goal).toBe("[private reasoning omitted]");
  });

  it("sanitizes a step label that is entirely wrapped in a <think> block", () => {
    const input: ElainePlanInput = {
      version: 1,
      goal: "Answer the user's question.",
      assumptions: [],
      completionCriteria: ["User receives an answer."],
      steps: [
        {
          ...MINIMAL_STEP,
          label:
            "<think>Private step rationale only, no visible label.</think>",
        },
      ],
    };

    const plan = toRuntimePlan(input);

    expect(plan.steps[0].label).not.toContain("Private step rationale");
    expect(plan.steps[0].label).toBe("[private reasoning omitted]");
  });

  it("sanitizes expectedEvidence that is entirely wrapped in a <think> block", () => {
    const input: ElainePlanInput = {
      version: 1,
      goal: "Answer the user's question.",
      assumptions: [],
      completionCriteria: ["User receives an answer."],
      steps: [
        {
          ...MINIMAL_STEP,
          expectedEvidence: "<think>Hidden evidence description.</think>",
        },
      ],
    };

    const plan = toRuntimePlan(input);

    expect(plan.steps[0].expectedEvidence).not.toContain("Hidden evidence");
    expect(plan.steps[0].expectedEvidence).toBe("[private reasoning omitted]");
  });

  it("preserves visible text in a goal that mixes reasoning with user-safe content", () => {
    const input: ElainePlanInput = {
      version: 1,
      goal: "<think>internal</think>Book the trip for next week.",
      assumptions: [],
      completionCriteria: ["Trip is booked."],
      steps: [MINIMAL_STEP],
    };

    const plan = toRuntimePlan(input);

    // The user-safe portion must survive.
    expect(plan.goal).toContain("Book the trip for next week.");
    // The raw reasoning must not.
    expect(plan.goal).not.toContain("internal");
  });

  it("preserves non-reasoning goal text unchanged (smoke test)", () => {
    const input: ElainePlanInput = {
      version: 1,
      goal: "Find the nearest pottery studio.",
      assumptions: [],
      completionCriteria: ["Studio address returned."],
      steps: [MINIMAL_STEP],
    };

    const plan = toRuntimePlan(input);

    expect(plan.goal).toBe("Find the nearest pottery studio.");
  });
});

// ── ElainePlanInputSchema: max(240) boundary vs. reasoning-strip interaction ──
//
// The schema enforces max(240) on the RAW pre-sanitized goal string.
// sanitizeRuntimeText strips reasoning tags and then slices to maxLength.
// These tests pin the contract at the boundary:
//
//   • A raw goal of exactly 241 chars (including the reasoning tags) is
//     rejected by the schema — the caller / planner never reaches toRuntimePlan.
//
//   • A raw goal of ≤240 chars whose visible portion (after stripping reasoning)
//     is much shorter is accepted by the schema, and toRuntimePlan returns
//     only the stripped visible text — no double-truncation, no off-by-one.

describe("ElainePlanInputSchema — max(240) boundary with embedded reasoning tags", () => {
  const MINIMAL_VALID_STEP = {
    id: "s1",
    label: "Look up the answer",
    kind: "lookup" as const,
    toolName: null,
    dependsOn: [],
    expectedEvidence: "The answer is found.",
    required: true,
  };

  const baseInput = {
    version: 1 as const,
    assumptions: [],
    completionCriteria: ["User receives an answer."],
    steps: [MINIMAL_VALID_STEP],
  };

  it("rejects a raw goal of exactly 241 chars that embeds a <think> block", () => {
    // Construct: "<think>" (7) + reasoning (207 × "x") + "</think>" (8) + visible (19) = 241 chars
    const visibleText = "Short visible text."; // 19 chars
    const reasoningContent = "x".repeat(207); // 207 chars
    const rawGoal = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawGoal.length).toBe(241); // guard: must be exactly 241

    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      goal: rawGoal,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const goalIssue = result.error.issues.find((i) =>
        i.path.includes("goal"),
      );
      expect(goalIssue).toBeDefined();
      // max(240) violation
      expect(goalIssue?.code).toBe("too_big");
    }
  });

  it("accepts a raw goal of exactly 240 chars that embeds a <think> block (at the limit, not over)", () => {
    // Construct: "<think>" (7) + reasoning (206 × "x") + "</think>" (8) + visible (19) = 240 chars
    const visibleText = "Short visible text."; // 19 chars
    const reasoningContent = "x".repeat(206); // 206 chars
    const rawGoal = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawGoal.length).toBe(240); // guard: exactly at the limit

    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      goal: rawGoal,
    });

    // Exactly 240 chars → must be accepted by the schema.
    expect(result.success).toBe(true);
    if (result.success) {
      // toRuntimePlan must strip the block and return only the visible text.
      const plan = toRuntimePlan(result.data);
      expect(plan.goal).toBe("[private reasoning omitted]" + visibleText);
      expect(plan.goal).not.toContain("<think>");
    }
  });

  it("accepts a raw goal of ≤240 chars and toRuntimePlan returns only the stripped visible text (no double-truncation)", () => {
    // Construct a raw string that is within the 240-char schema limit but
    // whose visible portion after stripping is much shorter.
    //
    // "<think>" (7) + reasoning (200 × "x") + "</think>" (8) + visible (6) = 221 chars ≤ 240
    const visibleText = "Short."; // 6 chars
    const reasoningContent = "x".repeat(200); // 200 chars
    const rawGoal = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawGoal.length).toBe(221); // guard: within 240-char limit

    // Schema must accept it (raw string is non-empty and ≤240 chars)
    const parsed = ElainePlanInputSchema.parse({
      ...baseInput,
      goal: rawGoal,
    });
    expect(parsed.goal).toBe(rawGoal); // schema preserves the raw value

    // toRuntimePlan must strip the reasoning block and return only the
    // visible portion — not a double-truncated or corrupted string.
    const plan = toRuntimePlan(parsed);

    // The sentinel + visible text is the expected output:
    // sanitizeRuntimeText replaces the <think>…</think> block with
    // "[private reasoning omitted]" and appends the visible suffix.
    const expectedGoal = "[private reasoning omitted]" + visibleText;
    expect(plan.goal).toBe(expectedGoal);

    // The reasoning content must not leak into the trace.
    expect(plan.goal).not.toContain(reasoningContent);
    expect(plan.goal).not.toContain("<think>");

    // No double-truncation: the result is well within 240 chars.
    expect(plan.goal.length).toBeLessThanOrEqual(240);
  });
});

// ── ElainePlanInputSchema: step label max(140) boundary ───────────────────────
//
// The same reasoning-tag-vs-schema-limit interaction that exists for goal also
// applies to step `label` (max 140).  Contract:
//
//   • A raw label of exactly 141 chars (including embedded reasoning tags) is
//     rejected by the schema with a too_big error.  toRuntimePlan is never
//     reached.
//
//   • A raw label of ≤140 chars whose visible portion after stripping is much
//     shorter is accepted by the schema, and toRuntimePlan returns only the
//     stripped visible text — no double-truncation, no off-by-one.

describe("ElainePlanInputSchema — step label max(140) boundary with embedded reasoning tags", () => {
  const baseInput = {
    version: 1 as const,
    goal: "Answer the user's question.",
    assumptions: [],
    completionCriteria: ["User receives an answer."],
  };

  const MINIMAL_STEP_BASE = {
    id: "s1",
    kind: "lookup" as const,
    toolName: null,
    dependsOn: [],
    expectedEvidence: "The answer is found.",
    required: true,
  };

  it("rejects a raw step label of exactly 141 chars that embeds a <think> block", () => {
    // Construct: "<think>" (7) + reasoning (107 × "x") + "</think>" (8) + visible (19) = 141 chars
    const visibleText = "Short visible text."; // 19 chars
    const reasoningContent = "x".repeat(107); // 107 chars
    const rawLabel = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawLabel.length).toBe(141); // guard: must be exactly 141

    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      steps: [{ ...MINIMAL_STEP_BASE, label: rawLabel }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const labelIssue = result.error.issues.find((i) =>
        i.path.includes("label"),
      );
      expect(labelIssue).toBeDefined();
      // max(140) violation
      expect(labelIssue?.code).toBe("too_big");
    }
  });

  it("accepts a raw step label of exactly 140 chars that embeds a <think> block (at the limit, not over)", () => {
    // Construct: "<think>" (7) + reasoning (106 × "x") + "</think>" (8) + visible (19) = 140 chars
    const visibleText = "Short visible text."; // 19 chars
    const reasoningContent = "x".repeat(106); // 106 chars
    const rawLabel = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawLabel.length).toBe(140); // guard: exactly at the limit

    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      steps: [{ ...MINIMAL_STEP_BASE, label: rawLabel }],
    });

    // Exactly 140 chars → must be accepted by the schema.
    expect(result.success).toBe(true);
    if (result.success) {
      // toRuntimePlan must strip the block and return only the visible text.
      const plan = toRuntimePlan(result.data);
      expect(plan.steps[0].label).toBe(
        "[private reasoning omitted]" + visibleText,
      );
      expect(plan.steps[0].label).not.toContain("<think>");
    }
  });

  it("accepts a raw step label of ≤140 chars and toRuntimePlan returns only the stripped visible text (no double-truncation)", () => {
    // "<think>" (7) + reasoning (100 × "x") + "</think>" (8) + visible (6) = 121 chars ≤ 140
    const visibleText = "Short."; // 6 chars
    const reasoningContent = "x".repeat(100); // 100 chars
    const rawLabel = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawLabel.length).toBe(121); // guard: within 140-char limit

    const parsed = ElainePlanInputSchema.parse({
      ...baseInput,
      steps: [{ ...MINIMAL_STEP_BASE, label: rawLabel }],
    });
    expect(parsed.steps[0].label).toBe(rawLabel); // schema preserves the raw value

    const plan = toRuntimePlan(parsed);

    const expectedLabel = "[private reasoning omitted]" + visibleText;
    expect(plan.steps[0].label).toBe(expectedLabel);
    expect(plan.steps[0].label).not.toContain(reasoningContent);
    expect(plan.steps[0].label).not.toContain("<think>");
    expect(plan.steps[0].label.length).toBeLessThanOrEqual(140);
  });
});

// ── ElainePlanInputSchema: step expectedEvidence max(220) boundary ────────────
//
// The same reasoning-tag-vs-schema-limit interaction that exists for goal also
// applies to step `expectedEvidence` (max 220).  Contract:
//
//   • A raw expectedEvidence of exactly 221 chars (including embedded reasoning
//     tags) is rejected by the schema with a too_big error.
//
//   • A raw expectedEvidence of ≤220 chars whose visible portion after stripping
//     is much shorter is accepted by the schema, and toRuntimePlan returns only
//     the stripped visible text — no double-truncation, no off-by-one.

describe("ElainePlanInputSchema — step expectedEvidence max(220) boundary with embedded reasoning tags", () => {
  const baseInput = {
    version: 1 as const,
    goal: "Answer the user's question.",
    assumptions: [],
    completionCriteria: ["User receives an answer."],
  };

  const MINIMAL_STEP_BASE = {
    id: "s1",
    kind: "lookup" as const,
    label: "Look up the answer",
    toolName: null,
    dependsOn: [],
    required: true,
  };

  it("rejects a raw expectedEvidence of exactly 221 chars that embeds a <think> block", () => {
    // Construct: "<think>" (7) + reasoning (187 × "x") + "</think>" (8) + visible (19) = 221 chars
    const visibleText = "Short visible text."; // 19 chars
    const reasoningContent = "x".repeat(187); // 187 chars
    const rawEvidence = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawEvidence.length).toBe(221); // guard: must be exactly 221

    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      steps: [{ ...MINIMAL_STEP_BASE, expectedEvidence: rawEvidence }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const evidenceIssue = result.error.issues.find((i) =>
        i.path.includes("expectedEvidence"),
      );
      expect(evidenceIssue).toBeDefined();
      // max(220) violation
      expect(evidenceIssue?.code).toBe("too_big");
    }
  });

  it("accepts a raw expectedEvidence of exactly 220 chars that embeds a <think> block (at the limit, not over)", () => {
    // Construct: "<think>" (7) + reasoning (186 × "x") + "</think>" (8) + visible (19) = 220 chars
    const visibleText = "Short visible text."; // 19 chars
    const reasoningContent = "x".repeat(186); // 186 chars
    const rawEvidence = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawEvidence.length).toBe(220); // guard: exactly at the limit

    const result = ElainePlanInputSchema.safeParse({
      ...baseInput,
      steps: [{ ...MINIMAL_STEP_BASE, expectedEvidence: rawEvidence }],
    });

    // Exactly 220 chars → must be accepted by the schema.
    expect(result.success).toBe(true);
    if (result.success) {
      // toRuntimePlan must strip the block and return only the visible text.
      const plan = toRuntimePlan(result.data);
      expect(plan.steps[0].expectedEvidence).toBe(
        "[private reasoning omitted]" + visibleText,
      );
      expect(plan.steps[0].expectedEvidence).not.toContain("<think>");
    }
  });

  it("accepts a raw expectedEvidence of ≤220 chars and toRuntimePlan returns only the stripped visible text (no double-truncation)", () => {
    // "<think>" (7) + reasoning (180 × "x") + "</think>" (8) + visible (6) = 201 chars ≤ 220
    const visibleText = "Short."; // 6 chars
    const reasoningContent = "x".repeat(180); // 180 chars
    const rawEvidence = "<think>" + reasoningContent + "</think>" + visibleText;

    expect(rawEvidence.length).toBe(201); // guard: within 220-char limit

    const parsed = ElainePlanInputSchema.parse({
      ...baseInput,
      steps: [{ ...MINIMAL_STEP_BASE, expectedEvidence: rawEvidence }],
    });
    expect(parsed.steps[0].expectedEvidence).toBe(rawEvidence); // schema preserves the raw value

    const plan = toRuntimePlan(parsed);

    const expectedEvidence = "[private reasoning omitted]" + visibleText;
    expect(plan.steps[0].expectedEvidence).toBe(expectedEvidence);
    expect(plan.steps[0].expectedEvidence).not.toContain(reasoningContent);
    expect(plan.steps[0].expectedEvidence).not.toContain("<think>");
    expect(plan.steps[0].expectedEvidence.length).toBeLessThanOrEqual(220);
  });
});
