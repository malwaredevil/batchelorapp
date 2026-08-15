/**
 * Regression guard: verifies that the classifier-doubt wiring in the HTTP
 * request handler (elaine/index.ts) correctly calls `recordElaineLesson` and
 * `diagnoseRecurringFailureInBackground` when a scheduling-doubt or
 * reminder-doubt message is detected.
 *
 * Task #915 added the wiring; Task #919 added pure-function tests for the
 * detector functions themselves (isSchedulingDoubtMessage,
 * isReminderDoubtMessage, buildClassifierDoubtLessonInput, etc.). This file
 * closes the remaining gap: a future refactor of the handler could silently
 * drop the recordElaineLesson / diagnoseRecurringFailureInBackground calls
 * without failing any existing test. These tests make that regression
 * impossible.
 *
 * Implementation note: the HTTP handler is tightly coupled to Express,
 * database, and AI-client machinery that makes supertest-level integration
 * testing extremely expensive (requires mocking ~40 modules). The established
 * pattern in this codebase for guarding handler-level wiring is source-code
 * structural analysis — see the "system prompt reminder-doubt backstop" block
 * at the bottom of classifier.test.ts for the existing precedent. These tests
 * do the same thing but with brace-matching so each assertion is scoped to the
 * correct if-block rather than just searching the full file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads the full source of elaine/index.ts once (synchronous, cached by the
 * test runner's module isolation). Tests reference this shared constant.
 */
const HANDLER_SRC = readFileSync(join(__dirname, "../index.ts"), "utf8");

/**
 * Given a preamble string that appears exactly once as a block opener in
 * HANDLER_SRC, returns the text of the entire block body (including the
 * braces). Uses depth-counting so nested braces don't confuse the extractor.
 * Throws a descriptive error if the pattern is missing — that failure message
 * itself is the regression signal.
 */
function extractIfBlock(ifPreamble: string): string {
  const preambleIdx = HANDLER_SRC.indexOf(ifPreamble);
  if (preambleIdx === -1) {
    throw new Error(
      `Pattern not found in elaine/index.ts: "${ifPreamble}"\n` +
        "The classifier-doubt wiring may have been removed or renamed — update this test to match the new form.",
    );
  }

  // Advance past the preamble to the opening brace of the block.
  let cursor = preambleIdx + ifPreamble.length;
  while (cursor < HANDLER_SRC.length && HANDLER_SRC[cursor] !== "{") {
    cursor++;
  }
  if (cursor >= HANDLER_SRC.length) {
    throw new Error(
      `Opening brace not found after: "${ifPreamble}" — the if-block may be malformed`,
    );
  }

  // Walk forward counting brace depth until the matching close.
  let depth = 0;
  const blockStart = cursor;
  for (; cursor < HANDLER_SRC.length; cursor++) {
    if (HANDLER_SRC[cursor] === "{") depth++;
    else if (HANDLER_SRC[cursor] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return HANDLER_SRC.slice(blockStart, cursor + 1);
}

// ---------------------------------------------------------------------------
// Shared block texts — computed once so individual tests are cheap.
// If extractIfBlock throws, every test in the suite that depends on the block
// will fail with a clear message, which is the intended regression signal.
// ---------------------------------------------------------------------------

const SCHEDULING_BLOCK = (() => {
  try {
    return extractIfBlock("if (isSchedulingDoubtMessage(message))");
  } catch {
    // Return a sentinel so tests fail with their own expect() rather than a
    // beforeAll exception that swallows individual test names.
    return "BLOCK_NOT_FOUND:scheduling";
  }
})();

const REMINDER_BLOCK = (() => {
  try {
    return extractIfBlock("if (isReminderDoubtMessage(message))");
  } catch {
    return "BLOCK_NOT_FOUND:reminder";
  }
})();

const MODEL_LOOP_BLOCK = (() => {
  try {
    return extractIfBlock("for (let round = 0; round < MAX_ROUNDS; round++)");
  } catch {
    return "BLOCK_NOT_FOUND:model_loop";
  }
})();

const TOOLCALLACC_ROUTING_BLOCK = (() => {
  try {
    return extractIfBlock(
      "for (const [index, { id, name, args }] of toolCallAcc.entries())",
    );
  } catch {
    return "BLOCK_NOT_FOUND:toolcallacc_routing";
  }
})();

const HARD_TOOL_RESULTS_LOOP_BLOCK = (() => {
  try {
    return extractIfBlock("for (const result of hardToolResults)");
  } catch {
    return "BLOCK_NOT_FOUND:hard_tool_results_loop";
  }
})();

// ---------------------------------------------------------------------------
// Tests — classifier-doubt handler wiring
// ---------------------------------------------------------------------------

describe("classifier-doubt handler wiring — scheduling-doubt branch", () => {
  it("if (isSchedulingDoubtMessage(message)) block exists in the handler", () => {
    expect(HANDLER_SRC).toContain("if (isSchedulingDoubtMessage(message))");
  });

  it("pushes LIST_SCHEDULED_CONTACTS_TOOL_NAME to the forced-tool queue", () => {
    expect(SCHEDULING_BLOCK).toContain("LIST_SCHEDULED_CONTACTS_TOOL_NAME");
  });

  it('calls buildClassifierDoubtLessonInput("scheduling") to construct the lesson', () => {
    expect(SCHEDULING_BLOCK).toContain(
      'buildClassifierDoubtLessonInput("scheduling")',
    );
  });

  it("calls recordElaineLesson with source: self_heal", () => {
    expect(SCHEDULING_BLOCK).toContain("recordElaineLesson");
    // source must be "self_heal" so the lesson feeds the recurrence counter
    // that gates code-diagnosis (classifier-doubt uses self_heal, not
    // explicit_user or explicit_assistant, because it is server-detected)
    expect(SCHEDULING_BLOCK).toContain('"self_heal"');
  });

  it("calls diagnoseRecurringFailureInBackground inside the recordElaineLesson .then()", () => {
    expect(SCHEDULING_BLOCK).toContain("diagnoseRecurringFailureInBackground");
    // Structural check: diagnose is called AFTER recordElaineLesson — i.e.
    // inside the .then() callback — so the lessonId and occurrenceCount from
    // the persisted row are forwarded to the diagnosis call.
    const recordIdx = SCHEDULING_BLOCK.indexOf("recordElaineLesson");
    const diagnoseIdx = SCHEDULING_BLOCK.indexOf(
      "diagnoseRecurringFailureInBackground",
    );
    expect(diagnoseIdx).toBeGreaterThan(recordIdx);
  });

  it('uses classifierDoubtPatternKey("scheduling") as the pattern key', () => {
    expect(SCHEDULING_BLOCK).toContain(
      'classifierDoubtPatternKey("scheduling")',
    );
  });

  it("the tool push comes before the lesson/diagnosis calls (tool is forced first)", () => {
    const pushIdx = SCHEDULING_BLOCK.indexOf(
      "LIST_SCHEDULED_CONTACTS_TOOL_NAME",
    );
    const recordIdx = SCHEDULING_BLOCK.indexOf("recordElaineLesson");
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(recordIdx).toBeGreaterThan(pushIdx);
  });
});

describe("classifier-doubt handler wiring — reminder-doubt branch", () => {
  it("if (isReminderDoubtMessage(message)) block exists in the handler", () => {
    expect(HANDLER_SRC).toContain("if (isReminderDoubtMessage(message))");
  });

  it("pushes LIST_REMINDERS_TOOL_NAME to the forced-tool queue", () => {
    expect(REMINDER_BLOCK).toContain("LIST_REMINDERS_TOOL_NAME");
  });

  it('calls buildClassifierDoubtLessonInput("reminder") to construct the lesson', () => {
    expect(REMINDER_BLOCK).toContain(
      'buildClassifierDoubtLessonInput("reminder")',
    );
  });

  it("calls recordElaineLesson with source: self_heal", () => {
    expect(REMINDER_BLOCK).toContain("recordElaineLesson");
    expect(REMINDER_BLOCK).toContain('"self_heal"');
  });

  it("calls diagnoseRecurringFailureInBackground inside the recordElaineLesson .then()", () => {
    expect(REMINDER_BLOCK).toContain("diagnoseRecurringFailureInBackground");
    const recordIdx = REMINDER_BLOCK.indexOf("recordElaineLesson");
    const diagnoseIdx = REMINDER_BLOCK.indexOf(
      "diagnoseRecurringFailureInBackground",
    );
    expect(diagnoseIdx).toBeGreaterThan(recordIdx);
  });

  it('uses classifierDoubtPatternKey("reminder") as the pattern key', () => {
    expect(REMINDER_BLOCK).toContain('classifierDoubtPatternKey("reminder")');
  });

  it("the tool push comes before the lesson/diagnosis calls (tool is forced first)", () => {
    const pushIdx = REMINDER_BLOCK.indexOf("LIST_REMINDERS_TOOL_NAME");
    const recordIdx = REMINDER_BLOCK.indexOf("recordElaineLesson");
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(recordIdx).toBeGreaterThan(pushIdx);
  });
});

describe("classifier-doubt handler wiring — ordering invariants", () => {
  it("the scheduling-doubt if-block appears before the reminder-doubt if-block", () => {
    // Both detectors are evaluated independently so a message matching both
    // fires both tools in sequence. This test guards the documented order
    // (scheduling then reminder) so that queue ordering stays predictable.
    const schedulingIdx = HANDLER_SRC.indexOf(
      "if (isSchedulingDoubtMessage(message))",
    );
    const reminderIdx = HANDLER_SRC.indexOf(
      "if (isReminderDoubtMessage(message))",
    );
    expect(schedulingIdx).toBeGreaterThan(-1);
    expect(reminderIdx).toBeGreaterThan(-1);
    expect(schedulingIdx).toBeLessThan(reminderIdx);
  });

  it("the forced-tool queue is initialized before the first doubt detector runs", () => {
    // nextForcedToolQueue must be declared before both if-blocks so both
    // branches can push to it safely.
    const queueInitIdx = HANDLER_SRC.indexOf(
      "const nextForcedToolQueue: string[]",
    );
    const schedulingIdx = HANDLER_SRC.indexOf(
      "if (isSchedulingDoubtMessage(message))",
    );
    expect(queueInitIdx).toBeGreaterThan(-1);
    expect(queueInitIdx).toBeLessThan(schedulingIdx);
  });

  it("the reminder-doubt if-block is a standalone if, NOT an else-if", () => {
    // The handler comment documents: "When the phrasing is ambiguous (both
    // detectors fire), both tools are forced in sequence."  This requires
    // two independent if-blocks, not an if/else-if chain. A future
    // refactor that turns the second block into an else-if would silently
    // break the dual-push behaviour — this test makes that impossible.
    //
    // Strategy: extract the ~80 characters immediately preceding the
    // reminder-doubt if-preamble and assert that "else" does not appear
    // there (it would have to appear as "} else if" for an else-if form).
    const reminderPreamble = "if (isReminderDoubtMessage(message))";
    const reminderIdx = HANDLER_SRC.indexOf(reminderPreamble);
    expect(reminderIdx).toBeGreaterThan(-1);

    const window = HANDLER_SRC.slice(
      Math.max(0, reminderIdx - 80),
      reminderIdx,
    );
    expect(window).not.toMatch(/\belse\b/);
  });

  it("both doubt-detector tools end up in the queue for a dual-match message (structural: both push calls present and reachable)", () => {
    // The scheduling block pushes LIST_SCHEDULED_CONTACTS_TOOL_NAME and the
    // reminder block pushes LIST_REMINDERS_TOOL_NAME.  Both push calls must
    // be present and in separate, independently-reachable if-blocks so that a
    // message matching both regexes causes both tools to be queued.
    expect(SCHEDULING_BLOCK).toContain("LIST_SCHEDULED_CONTACTS_TOOL_NAME");
    expect(REMINDER_BLOCK).toContain("LIST_REMINDERS_TOOL_NAME");

    // Neither block should contain the other block's tool name — the push
    // calls are distinct and not merged into one block.
    expect(SCHEDULING_BLOCK).not.toContain("LIST_REMINDERS_TOOL_NAME");
    expect(REMINDER_BLOCK).not.toContain("LIST_SCHEDULED_CONTACTS_TOOL_NAME");
  });
});

// ---------------------------------------------------------------------------
// Queue drain → model-call injection
// ---------------------------------------------------------------------------
//
// The push tests above only confirm that names land on the queue. These tests
// confirm the *other* half of the contract: the queue is drained inside the
// model-round loop and the popped name is forwarded to the model as a forced
// tool_choice. Removing or disconnecting either the .shift() or the
// tool_choice assignment would instantly fail at least one test below.

describe("forced-tool queue drain — .shift() called inside model-round loop", () => {
  it("the model-round for-loop block exists in the handler", () => {
    expect(HANDLER_SRC).toContain(
      "for (let round = 0; round < MAX_ROUNDS; round++)",
    );
  });

  it("nextForcedToolQueue.shift() is called inside the model-round loop", () => {
    expect(MODEL_LOOP_BLOCK).toContain("nextForcedToolQueue.shift()");
  });

  it("the result of .shift() is assigned to forcedToolName", () => {
    // Both identifiers must appear in the loop; the assignment binds them.
    expect(MODEL_LOOP_BLOCK).toContain("forcedToolName");
    expect(MODEL_LOOP_BLOCK).toContain("nextForcedToolQueue.shift()");
    // forcedToolName is the LHS, so it appears before the .shift() call on
    // the same assignment line.
    const assignIdx = MODEL_LOOP_BLOCK.indexOf("forcedToolName");
    const shiftIdx = MODEL_LOOP_BLOCK.indexOf("nextForcedToolQueue.shift()");
    expect(assignIdx).toBeLessThan(shiftIdx);
  });

  it("the .shift() drain happens before either tool_choice reference in the loop", () => {
    const shiftIdx = MODEL_LOOP_BLOCK.indexOf("nextForcedToolQueue.shift()");
    // OpenRouter uses snake_case `tool_choice`; OpenAI Responses uses
    // camelCase `toolChoice`. Both must appear after the drain.
    const snakeCaseIdx = MODEL_LOOP_BLOCK.indexOf("tool_choice");
    const camelCaseIdx = MODEL_LOOP_BLOCK.indexOf("toolChoice");
    expect(shiftIdx).toBeGreaterThan(-1);
    // At least one of the two forms must be present after the drain.
    const firstInjection = Math.min(
      snakeCaseIdx === -1 ? Infinity : snakeCaseIdx,
      camelCaseIdx === -1 ? Infinity : camelCaseIdx,
    );
    expect(firstInjection).toBeGreaterThan(shiftIdx);
  });
});

describe("forced-tool queue drain — forcedToolName injected into model call", () => {
  it("forcedToolName is referenced alongside tool_choice in the OpenRouter call path", () => {
    // The OpenRouter (chat.completions) path uses snake_case tool_choice.
    expect(MODEL_LOOP_BLOCK).toContain("tool_choice");
    // forcedToolName must appear after the first tool_choice reference,
    // meaning the conditional ternary uses it as the forced function name.
    const toolChoiceIdx = MODEL_LOOP_BLOCK.indexOf("tool_choice");
    const forcedAfterIdx = MODEL_LOOP_BLOCK.indexOf(
      "forcedToolName",
      toolChoiceIdx,
    );
    expect(forcedAfterIdx).toBeGreaterThan(toolChoiceIdx);
  });

  it("forcedToolName is referenced alongside toolChoice in the OpenAI Responses call path", () => {
    // The OpenAI Responses path uses camelCase toolChoice.
    expect(MODEL_LOOP_BLOCK).toContain("toolChoice");
    const toolChoiceIdx = MODEL_LOOP_BLOCK.indexOf("toolChoice");
    const forcedAfterIdx = MODEL_LOOP_BLOCK.indexOf(
      "forcedToolName",
      toolChoiceIdx,
    );
    expect(forcedAfterIdx).toBeGreaterThan(toolChoiceIdx);
  });

  it('the forced tool_choice sets type: "function" so the model is constrained to that tool', () => {
    // The OpenRouter path must construct { type: "function", function: { name: forcedToolName } }
    // rather than just passing the string directly — OpenAI requires this shape.
    expect(MODEL_LOOP_BLOCK).toContain('type: "function"');
  });

  it("the forced tool_choice passes the popped name as the function name", () => {
    // The function.name field must be set to forcedToolName (not a literal string)
    // so the actual queue value flows through, not a hard-coded constant.
    expect(MODEL_LOOP_BLOCK).toContain("name: forcedToolName");
  });

  it("forcedToolName null-check guards both model call paths before tool_choice is applied", () => {
    // The handler must not blindly pass forcedToolName when it is null
    // (queue was empty). A ternary / conditional on forcedToolName must
    // appear in the loop body before or at the tool_choice sites.
    const firstForcedIdx = MODEL_LOOP_BLOCK.indexOf("forcedToolName");
    const firstToolChoiceIdx = Math.min(
      ...[
        MODEL_LOOP_BLOCK.indexOf("tool_choice"),
        MODEL_LOOP_BLOCK.indexOf("toolChoice"),
      ].filter((i) => i !== -1),
    );
    // forcedToolName must appear at or before the first tool_choice
    expect(firstForcedIdx).toBeGreaterThan(-1);
    expect(firstForcedIdx).toBeLessThanOrEqual(firstToolChoiceIdx);
  });
});

// ---------------------------------------------------------------------------
// Forced-tool execution — toolCallAcc → executor dispatch → result fed back
// ---------------------------------------------------------------------------
//
// The injection tests above confirm the forced tool name flows into tool_choice.
// These tests confirm the *downstream* half: the tool call the model returns
// (accumulated in toolCallAcc) is routed to the executor dispatch array
// (hardToolCalls), executed via mapWithConcurrency, and the result is pushed
// back into the messages array before the next round begins.
// Any refactor that drops or disconnects any of these three steps will fail
// at least one test below.

describe("forced-tool execution — toolCallAcc routed to hardToolCalls", () => {
  it("the toolCallAcc.entries() routing loop exists in the handler", () => {
    expect(HANDLER_SRC).toContain(
      "for (const [index, { id, name, args }] of toolCallAcc.entries())",
    );
  });

  it("MODEL_VISIBLE_HARD_TOOL_NAMES.has(name) gates the routing inside the loop", () => {
    // Only calls whose name is in the hard-tool set reach the executor path;
    // soft-tool/action calls take a different branch.
    expect(TOOLCALLACC_ROUTING_BLOCK).toContain(
      "MODEL_VISIBLE_HARD_TOOL_NAMES.has(name)",
    );
  });

  it("hardToolCalls.push() is called inside the MODEL_VISIBLE_HARD_TOOL_NAMES guard", () => {
    // The routing guard must actually push the call into the dispatch array
    // — not just check the condition and continue.
    expect(TOOLCALLACC_ROUTING_BLOCK).toContain("hardToolCalls.push(");
    // The push must appear after the has(name) guard so it is only reached
    // for hard tools (not before the guard where it would capture all calls).
    const guardIdx = TOOLCALLACC_ROUTING_BLOCK.indexOf(
      "MODEL_VISIBLE_HARD_TOOL_NAMES.has(name)",
    );
    const pushIdx = TOOLCALLACC_ROUTING_BLOCK.indexOf("hardToolCalls.push(");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(guardIdx);
  });

  it("the pushed call object carries the id, name, and args fields", () => {
    // All three are required: id ties the result back to the model's function
    // call, name selects the executor branch, args supplies the parsed payload.
    const pushIdx = TOOLCALLACC_ROUTING_BLOCK.indexOf("hardToolCalls.push(");
    const afterPush = TOOLCALLACC_ROUTING_BLOCK.slice(pushIdx);
    expect(afterPush).toContain("id,");
    expect(afterPush).toContain("name,");
    expect(afterPush).toContain("args,");
  });
});

describe("forced-tool execution — executor dispatched via mapWithConcurrency", () => {
  it("mapWithConcurrency is called with hardToolCalls inside the model-round loop", () => {
    // mapWithConcurrency is the concurrency-bounded executor loop. Its first
    // argument must be hardToolCalls so every accumulated hard-tool call runs.
    expect(MODEL_LOOP_BLOCK).toContain("mapWithConcurrency(");
    expect(MODEL_LOOP_BLOCK).toContain("hardToolCalls,");
    const mcIdx = MODEL_LOOP_BLOCK.indexOf("mapWithConcurrency(");
    const hcIdx = MODEL_LOOP_BLOCK.indexOf("hardToolCalls,", mcIdx);
    expect(hcIdx).toBeGreaterThan(mcIdx);
  });

  it("the mapWithConcurrency result is awaited and stored in hardToolResults", () => {
    // The result must be awaited (async calls) and bound to hardToolResults so
    // the result-feed loop can iterate it.
    const awaitIdx = MODEL_LOOP_BLOCK.indexOf("await mapWithConcurrency(");
    expect(awaitIdx).toBeGreaterThan(-1);
    // hardToolResults must appear before the mapWithConcurrency call (as the
    // LHS assignment target).
    const resultsIdx = MODEL_LOOP_BLOCK.indexOf("hardToolResults");
    expect(resultsIdx).toBeLessThan(awaitIdx);
  });

  it("mapWithConcurrency dispatch comes after hardToolCalls is populated in the loop", () => {
    // hardToolCalls must be populated by the toolCallAcc routing loop first;
    // mapWithConcurrency must come after that loop.
    const routingLoopIdx = MODEL_LOOP_BLOCK.indexOf(
      "for (const [index, { id, name, args }] of toolCallAcc.entries())",
    );
    const dispatchIdx = MODEL_LOOP_BLOCK.indexOf("await mapWithConcurrency(");
    expect(routingLoopIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(routingLoopIdx);
  });
});

describe("forced-tool execution — result fed back into messages before next round", () => {
  it("the for (const result of hardToolResults) loop exists in the handler", () => {
    expect(HANDLER_SRC).toContain("for (const result of hardToolResults)");
  });

  it("messages.push() is called inside the hardToolResults loop", () => {
    // Each executor result must be appended to the messages array so the
    // model sees the tool output in the next round's context window.
    expect(HARD_TOOL_RESULTS_LOOP_BLOCK).toContain("messages.push(");
  });

  it('the pushed message uses role: "tool"', () => {
    // OpenAI's chat-completion API requires role "tool" for tool results;
    // any other role silently breaks result correlation.
    expect(HARD_TOOL_RESULTS_LOOP_BLOCK).toContain('role: "tool"');
  });

  it("the pushed message carries tool_call_id linked to the original call", () => {
    // tool_call_id must match the id from the model's function call so the
    // provider can correlate result ↔ call.
    expect(HARD_TOOL_RESULTS_LOOP_BLOCK).toContain("tool_call_id:");
    expect(HARD_TOOL_RESULTS_LOOP_BLOCK).toContain("result.call.id");
  });

  it("the pushed message content is result.resultText (the executor output)", () => {
    // content must be the actual executor result string, not an empty
    // placeholder or a hard-coded constant.
    expect(HARD_TOOL_RESULTS_LOOP_BLOCK).toContain(
      "content: result.resultText",
    );
  });

  it("the result-feed loop comes after the executor dispatch in the model-round loop", () => {
    // Results can only be fed back after they exist — mapWithConcurrency must
    // precede the for-loop that iterates hardToolResults.
    const dispatchIdx = MODEL_LOOP_BLOCK.indexOf("await mapWithConcurrency(");
    const feedIdx = MODEL_LOOP_BLOCK.indexOf(
      "for (const result of hardToolResults)",
    );
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect(feedIdx).toBeGreaterThan(dispatchIdx);
  });

  it("the result-feed loop comes before the end of the model-round for-loop", () => {
    // The push must happen within the same round iteration so the next
    // round sees the tool output.
    const feedIdx = MODEL_LOOP_BLOCK.indexOf(
      "for (const result of hardToolResults)",
    );
    expect(feedIdx).toBeGreaterThan(-1);
    expect(feedIdx).toBeLessThan(MODEL_LOOP_BLOCK.length - 1);
  });
});

// ---------------------------------------------------------------------------
// OpenAI Responses path — nextOpenAIInput populated from hardToolResults
// ---------------------------------------------------------------------------
//
// The chat-completion (OpenRouter) path feeds tool results back via
// messages.push({ role: "tool", ... }). The OpenAI Responses API path feeds
// them back via `nextOpenAIInput` as `function_call_output` entries instead.
// If that array assignment is silently dropped or its RHS changed to an
// unrelated expression, the Responses-API model never sees the forced tool's
// output — but no existing test catches it. These tests close that gap by
// extracting the specific `nextOpenAIInput = [...]` array literal and
// asserting its structural shape within that bounded text only.

/**
 * Finds the array literal `[...]` that starts at or after `fromIndex` in
 * HANDLER_SRC, identified by locating `preamble` (at/after `fromIndex`) and
 * then bracket-matching from the first `[` that follows. Returns the bounded
 * slice so assertions operate only on that specific array literal, not on
 * unrelated occurrences of the same substrings elsewhere in the file.
 */
function extractArrayAssignment(preamble: string, fromIndex = 0): string {
  const preambleIdx = HANDLER_SRC.indexOf(preamble, fromIndex);
  if (preambleIdx === -1) {
    throw new Error(
      `Pattern not found in elaine/index.ts (from offset ${fromIndex}): "${preamble}"\n` +
        "The nextOpenAIInput assignment may have been removed or renamed — " +
        "update this test to match the new form.",
    );
  }

  // Advance past the preamble to the opening bracket.
  let cursor = preambleIdx + preamble.length;
  while (cursor < HANDLER_SRC.length && HANDLER_SRC[cursor] !== "[") {
    cursor++;
  }
  if (cursor >= HANDLER_SRC.length) {
    throw new Error(
      `Opening bracket not found after: "${preamble}" — the array literal may be malformed`,
    );
  }

  // Walk forward counting bracket depth until the matching close.
  let depth = 0;
  const blockStart = cursor;
  for (; cursor < HANDLER_SRC.length; cursor++) {
    if (HANDLER_SRC[cursor] === "[") depth++;
    else if (HANDLER_SRC[cursor] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  return HANDLER_SRC.slice(blockStart, cursor + 1);
}

// Target the nextOpenAIInput assignment that follows the hardToolResults loop.
// There are multiple `nextOpenAIInput = [` occurrences in the file; we need
// the one that is inside the for-loop that iterates hardToolResults. Find the
// position of the for-loop first, then search for the assignment from there.
const NEXT_OPENAI_INPUT_ASSIGNMENT = (() => {
  try {
    const hardToolLoopIdx = HANDLER_SRC.indexOf(
      "for (const result of hardToolResults)",
    );
    if (hardToolLoopIdx === -1) {
      throw new Error(
        "for (const result of hardToolResults) not found — cannot anchor nextOpenAIInput search",
      );
    }
    return extractArrayAssignment("nextOpenAIInput = ", hardToolLoopIdx);
  } catch {
    return "BLOCK_NOT_FOUND:next_openai_input";
  }
})();

describe("OpenAI Responses path — nextOpenAIInput populated from hardToolResults", () => {
  it("nextOpenAIInput = [...] assignment exists in the handler source", () => {
    // The assignment must be present so the Responses API path receives tool
    // output before the next round begins.
    expect(HANDLER_SRC).toContain("nextOpenAIInput = [");
  });

  it("hardToolResults.map is the RHS source of the nextOpenAIInput array literal", () => {
    // Assertions in this describe block operate on NEXT_OPENAI_INPUT_ASSIGNMENT —
    // the bounded text of the array literal itself — so a dead hardToolResults.map
    // expression elsewhere in the file cannot satisfy these checks.
    // The Responses path must derive entries from hardToolResults.map(...) so
    // every executed hard-tool result is included.
    expect(NEXT_OPENAI_INPUT_ASSIGNMENT).toContain("hardToolResults.map(");
  });

  it('each mapped entry carries type: "function_call_output" inside the assignment literal', () => {
    // The OpenAI Responses API requires this discriminator for tool results.
    // Any other type string is silently ignored and the model loses the result.
    expect(NEXT_OPENAI_INPUT_ASSIGNMENT).toContain('"function_call_output"');
  });

  it("each mapped entry carries call_id: result.call.id inside the assignment literal", () => {
    // call_id must match the id from the model's function_call item so the
    // Responses API can correlate result ↔ call.
    expect(NEXT_OPENAI_INPUT_ASSIGNMENT).toContain("call_id: result.call.id");
  });

  it("each mapped entry carries output: result.resultText inside the assignment literal", () => {
    // output must be the actual executor result string, not an empty
    // placeholder or a hard-coded constant.
    expect(NEXT_OPENAI_INPUT_ASSIGNMENT).toContain("output: result.resultText");
  });

  it("the nextOpenAIInput assignment comes after the hardToolResults loop in the model-round loop", () => {
    // Results can only be fed back after they exist — the for-loop that
    // iterates hardToolResults must precede the nextOpenAIInput assignment.
    const feedIdx = MODEL_LOOP_BLOCK.indexOf(
      "for (const result of hardToolResults)",
    );
    const assignIdx = MODEL_LOOP_BLOCK.indexOf("nextOpenAIInput = [", feedIdx);
    expect(feedIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeGreaterThan(feedIdx);
  });

  it("the nextOpenAIInput assignment is inside the model-round for-loop", () => {
    // The assignment must happen within the same round iteration so the next
    // round of the Responses API path sees the tool output.
    const assignIdx = MODEL_LOOP_BLOCK.indexOf("nextOpenAIInput = [");
    expect(assignIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeLessThan(MODEL_LOOP_BLOCK.length - 1);
  });
});
