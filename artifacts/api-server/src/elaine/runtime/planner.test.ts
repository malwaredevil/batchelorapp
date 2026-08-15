import { describe, expect, it, vi } from "vitest";
import {
  createFallbackPlan,
  generateElainePlan,
  validateElainePlan,
  validateElainePlanCandidateSet,
} from "./planner";
import { PRIVATE_REASONING_SENTINEL } from "./contracts";

const requestClass = {
  kind: "research" as const,
  complexity: "multi_step" as const,
  requiresFreshData: true,
  hasAttachment: false,
};

describe("validateElainePlan", () => {
  it("accepts a dependency-ordered plan", () => {
    const result = validateElainePlan(
      {
        version: 1,
        goal: "Check trip weather",
        assumptions: [],
        completionCriteria: ["Dates and weather coverage are explicit"],
        steps: [
          {
            id: "trip",
            label: "Find the trip dates",
            kind: "lookup",
            toolName: "search_household_data",
            dependsOn: [],
            expectedEvidence: "Destination and dates",
            required: true,
          },
          {
            id: "weather",
            label: "Check applicable weather information",
            kind: "research",
            toolName: "get_weather_forecast",
            dependsOn: ["trip"],
            expectedEvidence: "Forecast coverage matches the trip dates",
            required: true,
          },
        ],
      },
      new Set(["search_household_data", "get_weather_forecast"]),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a no-tool clarification and defers dependent work", () => {
    const result = validateElainePlan(
      {
        version: 1,
        goal: "Research destinations after the user names them",
        assumptions: [],
        completionCriteria: ["The requested destinations are researched"],
        steps: [
          {
            id: "clarify",
            label: "Ask which destinations to research",
            kind: "clarify",
            toolName: null,
            dependsOn: [],
            expectedEvidence: "The user provides destinations",
            required: true,
          },
          {
            id: "research",
            label: "Research the destinations",
            kind: "research",
            toolName: "web_search",
            dependsOn: ["clarify"],
            expectedEvidence: "Current destination evidence",
            required: true,
          },
        ],
      },
      new Set(["web_search"]),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.steps[0]).toMatchObject({
        kind: "clarify",
        toolName: null,
        retryLimit: 0,
      });
    }
  });

  it("rejects a clarification step that tries to call a tool", () => {
    expect(
      validateElainePlan(
        {
          version: 1,
          goal: "Clarify an invented request",
          assumptions: [],
          completionCriteria: ["The missing detail is provided"],
          steps: [
            {
              id: "clarify",
              label: "Ask for the missing detail",
              kind: "clarify",
              toolName: "web_search",
              dependsOn: [],
              expectedEvidence: "The user provides the missing detail",
              required: true,
            },
          ],
        },
        new Set(["web_search"]),
      ),
    ).toEqual({
      success: false,
      error: "clarification step clarify cannot call a tool",
    });
  });

  it("falls back when the goal is a pure reasoning block (sentinel check)", () => {
    // A goal consisting entirely of a <think>…</think> block sanitizes to the
    // sentinel string. validateElainePlan must detect this and return failure so
    // the caller falls back to an unplanned turn instead of recording a trace
    // with goal = "[private reasoning omitted]".
    const result = validateElainePlan(
      {
        version: 1,
        goal: "<think>This is internal model reasoning that must never reach the trace.</think>",
        assumptions: [],
        completionCriteria: ["The request is completed"],
        steps: [
          {
            id: "respond",
            label: "Answer the question",
            kind: "respond",
            toolName: null,
            dependsOn: [],
            expectedEvidence: "A grounded answer",
            required: true,
          },
        ],
      },
      new Set(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("hidden reasoning");
    }
  });

  it("does not trigger the sentinel fallback for a normal goal", () => {
    // A goal with real content must NOT be rejected by the sentinel check,
    // even if its text happens to include the word "reasoning".
    const result = validateElainePlan(
      {
        version: 1,
        goal: "Find the user's upcoming trip and summarise the itinerary",
        assumptions: [],
        completionCriteria: ["Trip details are returned"],
        steps: [
          {
            id: "lookup",
            label: "Look up the trip",
            kind: "lookup",
            toolName: "search_household_data",
            dependsOn: [],
            expectedEvidence: "Trip record with dates and destination",
            required: true,
          },
        ],
      },
      new Set(["search_household_data"]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.goal).not.toBe(PRIVATE_REASONING_SENTINEL);
    }
  });

  it("rejects missing dependencies, cycles, and unknown tools", () => {
    const base = {
      version: 1,
      goal: "Check something",
      assumptions: [],
      completionCriteria: ["Evidence exists"],
    };
    expect(
      validateElainePlan(
        {
          ...base,
          steps: [
            {
              id: "one",
              label: "One",
              kind: "lookup",
              toolName: "known",
              dependsOn: ["missing"],
              expectedEvidence: "Evidence",
              required: true,
            },
          ],
        },
        new Set(["known"]),
      ),
    ).toMatchObject({ success: false });
    expect(
      validateElainePlan(
        {
          ...base,
          steps: [
            {
              id: "one",
              label: "One",
              kind: "lookup",
              toolName: "known",
              dependsOn: ["two"],
              expectedEvidence: "First evidence",
              required: true,
            },
            {
              id: "two",
              label: "Two",
              kind: "lookup",
              toolName: "known",
              dependsOn: ["one"],
              expectedEvidence: "Second evidence",
              required: true,
            },
          ],
        },
        new Set(["known"]),
      ),
    ).toMatchObject({
      success: false,
      error: "plan dependency graph contains a cycle",
    });
    expect(
      validateElainePlan(
        {
          ...base,
          steps: [
            {
              id: "one",
              label: "One",
              kind: "lookup",
              toolName: "unknown",
              dependsOn: [],
              expectedEvidence: "Evidence",
              required: true,
            },
          ],
        },
        new Set(["known"]),
      ),
    ).toMatchObject({ success: false });
  });
});

describe("validateElainePlanCandidateSet", () => {
  const candidateA = {
    approach: "Answer directly",
    version: 1 as const,
    goal: "Answer the question",
    assumptions: [],
    completionCriteria: ["Answered"],
    steps: [
      {
        id: "answer",
        label: "Answer",
        kind: "respond" as const,
        toolName: null,
        dependsOn: [],
        expectedEvidence: "A grounded answer",
        required: true,
      },
    ],
  };
  const candidateB = {
    approach: "Look it up first",
    version: 1 as const,
    goal: "Verify then answer",
    assumptions: [],
    completionCriteria: ["Verified and answered"],
    steps: [
      {
        id: "lookup",
        label: "Look up the fact",
        kind: "lookup" as const,
        toolName: "search_household_data",
        dependsOn: [],
        expectedEvidence: "The fact",
        required: true,
      },
    ],
  };

  it("selects the chosen candidate and records the rejected alternative", () => {
    const result = validateElainePlanCandidateSet(
      {
        candidates: [candidateA, candidateB],
        chosenIndex: 1,
        selectionReason: "Verifying first avoids an unsupported claim.",
      },
      new Set(["search_household_data"]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.steps[0]?.toolName).toBe("search_household_data");
      expect(result.plan.planSelection).toEqual({
        chosenApproach: "Look it up first",
        alternativeApproaches: ["Answer directly"],
        reason: "Verifying first avoids an unsupported claim.",
        chosenIndex: 1,
      });
    }
  });

  it("rejects candidates that are not meaningfully different", () => {
    const result = validateElainePlanCandidateSet(
      {
        candidates: [
          { ...candidateA, approach: "Approach A" },
          { ...candidateA, approach: "Approach B" },
        ],
        chosenIndex: 0,
        selectionReason: "No real difference.",
      },
      new Set(),
    );
    expect(result).toMatchObject({ success: false });
  });

  it("rejects an out-of-range chosenIndex", () => {
    const result = validateElainePlanCandidateSet(
      {
        candidates: [candidateA, candidateB],
        chosenIndex: 5,
        selectionReason: "n/a",
      },
      new Set(["search_household_data"]),
    );
    expect(result).toMatchObject({ success: false });
  });

  it("rejects fewer than two candidates", () => {
    const result = validateElainePlanCandidateSet(
      {
        candidates: [candidateA],
        chosenIndex: 0,
        selectionReason: "Only one option.",
      },
      new Set(),
    );
    expect(result).toMatchObject({ success: false });
  });
});

describe("generateElainePlan recent history", () => {
  it("includes recent conversation turns in the planner prompt so a referent isn't re-clarified", async () => {
    let capturedPrompt = "";
    const generate = vi.fn<(prompt: string) => Promise<string | null>>(
      async (prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify({
          candidates: [
            {
              approach: "Answer using the already-established place",
              version: 1,
              goal: "Answer the follow-up question",
              assumptions: [],
              completionCriteria: ["The question is answered"],
              steps: [
                {
                  id: "answer",
                  label: "Answer using the already-established place",
                  kind: "respond",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "A grounded answer",
                  required: true,
                },
              ],
            },
            {
              approach: "Ask again to be safe",
              version: 1,
              goal: "Clarify then answer",
              assumptions: [],
              completionCriteria: ["The question is answered"],
              steps: [
                {
                  id: "clarify",
                  label: "Ask which place they mean",
                  kind: "clarify",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "The user names the place",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 0,
          selectionReason:
            "The place was already established a turn ago, so re-asking would be redundant.",
        });
      },
    );

    const result = await generateElainePlan({
      message: "Does that have coke and Pepsi, or is it just a bar?",
      pageContext: null,
      requestClass,
      tools: [],
      recentHistory: [
        { role: "user", content: "Any snack shops near my hotel?" },
        {
          role: "assistant",
          content: "Marina Blu / Bar La Posada is a short walk away.",
        },
      ],
      generate,
    });

    expect(capturedPrompt).toContain("Marina Blu / Bar La Posada");
    expect(capturedPrompt).toContain("Recent conversation");
    expect(result.plan.steps.some((step) => step.kind === "clarify")).toBe(
      false,
    );
  });

  it("tells the planner this is the first turn when no history is given", async () => {
    let capturedPrompt = "";
    await generateElainePlan({
      message: "What's the weather like?",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return null;
      },
    });
    expect(capturedPrompt).toContain("(none — this is the first turn)");
  });

  it("includes the long-term conversation summary so a fact from far earlier isn't re-clarified", async () => {
    let capturedPrompt = "";
    const generate = vi.fn<(prompt: string) => Promise<string | null>>(
      async (prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify({
          candidates: [
            {
              approach: "Answer using the established dietary restriction",
              version: 1,
              goal: "Answer using the already-established allergy info",
              assumptions: [],
              completionCriteria: ["The question is answered"],
              steps: [
                {
                  id: "answer",
                  label: "Answer using the established dietary restriction",
                  kind: "respond",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "A grounded answer",
                  required: true,
                },
              ],
            },
            {
              approach: "Ask about allergies again",
              version: 1,
              goal: "Clarify allergies then answer",
              assumptions: [],
              completionCriteria: ["The question is answered"],
              steps: [
                {
                  id: "clarify",
                  label: "Ask about dietary restrictions",
                  kind: "clarify",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "The user restates any allergies",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 0,
          selectionReason:
            "The allergy was already established in the conversation summary.",
        });
      },
    );

    const result = await generateElainePlan({
      message: "Can you double check that restaurant is safe for me?",
      pageContext: null,
      requestClass,
      tools: [],
      conversationSummary:
        "User has a shellfish allergy and is planning a trip to Sicily.",
      generate,
    });

    expect(capturedPrompt).toContain("shellfish allergy");
    expect(capturedPrompt).toContain("Earlier conversation");
    expect(result.plan.steps.some((step) => step.kind === "clarify")).toBe(
      false,
    );
  });

  it("tells the planner there's no summarised history yet when none is given", async () => {
    let capturedPrompt = "";
    await generateElainePlan({
      message: "What's the weather like?",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return null;
      },
    });
    expect(capturedPrompt).toContain("(none — no summarised history yet)");
  });
});

describe("generateElainePlan", () => {
  it("repairs one invalid response and returns the validated plan", async () => {
    const generate = vi
      .fn<(_: string) => Promise<string | null>>()
      .mockResolvedValueOnce('{"steps":[]}')
      .mockResolvedValueOnce(
        JSON.stringify({
          candidates: [
            {
              approach: "Look up the trip then check weather",
              version: 1,
              goal: "Check the requested trip weather",
              assumptions: [],
              completionCriteria: ["Date coverage is explicit"],
              steps: [
                {
                  id: "trip",
                  label: "Find the trip dates",
                  kind: "lookup",
                  toolName: "search_household_data",
                  dependsOn: [],
                  expectedEvidence: "Trip destination and dates",
                  required: true,
                },
              ],
            },
            {
              approach: "Guess this week's weather",
              version: 1,
              goal: "Check the weather for an assumed date",
              assumptions: ["Assume the trip is happening this week"],
              completionCriteria: ["A guessed date range is covered"],
              steps: [
                {
                  id: "guess",
                  label: "Answer with a guessed date range",
                  kind: "respond",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "A guessed answer",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 0,
          selectionReason:
            "Looking up the real trip dates avoids answering with a guessed date range.",
        }),
      );
    const result = await generateElainePlan({
      message: "What is the weather for our trip?",
      pageContext: null,
      requestClass,
      tools: [
        {
          name: "search_household_data",
          description: "Search trips",
          consequential: false,
        },
      ],
      generate,
    });
    expect(result.source).toBe("repaired");
    expect(result.plan.steps[0]?.toolName).toBe("search_household_data");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.plan.planSelection).toMatchObject({
      chosenApproach: "Look up the trip then check weather",
      alternativeApproaches: ["Guess this week's weather"],
    });
  });

  it("falls back without retaining raw user text when planning fails", async () => {
    const result = await generateElainePlan({
      message: "My private confirmation number is ABC-123",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async () => null,
    });
    expect(result.source).toBe("fallback");
    expect(JSON.stringify(result.plan)).not.toContain("ABC-123");
    expect(result.plan).toEqual(createFallbackPlan(requestClass));
  });

  it("falls back to an unplanned turn when every candidate has a pure-reasoning goal", async () => {
    // A candidate set where each candidate's goal is a bare <think>…</think>
    // block fails the sentinel check inside validateElainePlan, causing
    // validateElainePlanCandidateSet to return failure, which makes
    // generateElainePlan fall back after both attempts rather than recording
    // a trace with goal = "[private reasoning omitted]".
    const generate = vi
      .fn<(_: string) => Promise<string | null>>()
      .mockResolvedValue(
        JSON.stringify({
          candidates: [
            {
              approach: "Direct approach",
              version: 1,
              goal: "<think>internal reasoning that must not reach the trace</think>",
              assumptions: [],
              completionCriteria: ["The request is completed"],
              steps: [
                {
                  id: "respond",
                  label: "Answer the question",
                  kind: "respond",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "A grounded answer",
                  required: true,
                },
              ],
            },
            {
              approach: "Research first",
              version: 1,
              goal: "<thinking>also hidden reasoning</thinking>",
              assumptions: [],
              completionCriteria: ["The request is completed"],
              steps: [
                {
                  id: "lookup",
                  label: "Look something up",
                  kind: "lookup",
                  toolName: "search_household_data",
                  dependsOn: [],
                  expectedEvidence: "A lookup result",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 0,
          selectionReason: "Direct is faster.",
        }),
      );

    const result = await generateElainePlan({
      message: "Help me with something",
      pageContext: null,
      requestClass,
      tools: [
        {
          name: "search_household_data",
          description: "Search household data",
          consequential: false,
        },
      ],
      generate,
    });

    // Both attempts return the same bad JSON; the fallback fires.
    expect(result.source).toBe("fallback");
    expect(result.plan).toEqual(createFallbackPlan(requestClass));
    // The sentinel must not appear as the goal in the fallback plan.
    expect(result.plan.goal).not.toBe(PRIVATE_REASONING_SENTINEL);
    // Both repair attempts were made before giving up.
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not bleed past-lesson text into the fallback plan when both generate calls return null", async () => {
    const pastLessonsText =
      "mistake — UNIQUE_LESSON_SENTINEL_XR7Q: When asked for ornament book values, answering from memory without checking the HooH catalog produced inaccurate prices. Always look up the real catalog entry.";

    const result = await generateElainePlan({
      message: "What is my ornament worth?",
      pageContext: null,
      requestClass,
      tools: [],
      pastLessons: pastLessonsText,
      generate: async () => null,
    });

    expect(result.source).toBe("fallback");
    // The fallback plan must not carry any lesson text — neither the sentinel
    // phrase nor any other fragment of the pastLessons string.
    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toContain("UNIQUE_LESSON_SENTINEL_XR7Q");
    expect(serialized).not.toContain("HooH catalog");
    expect(serialized).not.toContain("mistake —");
  });

  it("strips hidden-reasoning markers from result.error when both generate attempts fail", async () => {
    // Simulate both generate calls throwing an Error whose message contains a
    // complete <think>…</think> block — exactly the shape that ends up as
    // `lastError` in the generateElainePlan catch branch. This exercises the
    // sanitizeRuntimeText(lastError) call on the fallback path and confirms
    // that private reasoning content is removed before being stored in result.error.
    const privateMarker = "SECRET_REASONING_SENTINEL_7K3P";
    const errorMessage = `<think>${privateMarker}: private deliberation the user must never see</think> model error`;

    const result = await generateElainePlan({
      message: "What is the weather?",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async () => {
        throw new Error(errorMessage);
      },
    });

    expect(result.source).toBe("fallback");
    // The error field must be present (both attempts threw)
    expect(result.error).toBeDefined();
    // The private reasoning content (inside the <think> block) must be stripped.
    expect(result.error).not.toContain(privateMarker);
    expect(result.error).not.toContain("private deliberation");
    expect(result.error).not.toContain("the user must never see");
    // The safe surrounding diagnostic should survive so the error is still useful.
    expect(result.error).toContain("model error");
    // The sanitizer's placeholder should appear in place of the stripped block.
    expect(result.error).toContain("[private reasoning omitted]");
  });

  it("redacts secret-looking values from result.error and keeps it within 240 characters", async () => {
    // Simulate both generate calls throwing an Error whose message contains a
    // secret-style assignment — the kind of raw model output that must never
    // reach the trace. The message is intentionally longer than 240 characters
    // so the length cap assertion is non-vacuous: if sanitizeRuntimeText stopped
    // truncating, the assertion would catch it.
    const secretValue = "sk-abc123verysecret";
    // Build a message with the secret near the front followed by enough padding
    // to push the total well past 240 characters.
    const padding = "x".repeat(280);
    const errorMessage = `api_key=${secretValue} JSON parse failed: unexpected token at position 0 while parsing the model response body ${padding}`;
    // Sanity-check that the raw message is genuinely over 240 chars.
    expect(errorMessage.length).toBeGreaterThan(240);

    const result = await generateElainePlan({
      message: "What is the weather?",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async () => {
        throw new Error(errorMessage);
      },
    });

    expect(result.source).toBe("fallback");
    // The error field must be present (both attempts threw)
    expect(result.error).toBeDefined();
    // The raw secret value must not appear in the stored error
    expect(result.error).not.toContain(secretValue);
    // The sanitizer must replace the credential with [redacted]
    expect(result.error).toContain("[redacted]");
    // The error field must stay within the 240-character limit enforced by sanitizeRuntimeText
    expect(result.error!.length).toBeLessThanOrEqual(240);
  });

  it("removes hidden reasoning from every user-safe plan field", async () => {
    const result = await generateElainePlan({
      message: "Help me plan this",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async () =>
        JSON.stringify({
          candidates: [
            {
              approach: "<think>plan A scratch</think> Direct approach",
              version: 1,
              goal: "<think>private scratch work</think> Help with the request",
              assumptions: [
                "<reasoning>secret premise</reasoning> Safe premise",
              ],
              completionCriteria: ["A safe answer exists"],
              steps: [
                {
                  id: "answer",
                  label: "<thinking>hidden</thinking> Answer",
                  kind: "respond",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence:
                    "<think>do not expose</think> A grounded response",
                  required: true,
                },
              ],
            },
            {
              approach: "Research first",
              version: 1,
              goal: "Research before answering",
              assumptions: [],
              completionCriteria: ["A safe answer exists"],
              steps: [
                {
                  id: "research",
                  label: "Look something up",
                  kind: "lookup",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "A grounded response",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 0,
          selectionReason: "<think>internal debate</think> Direct is faster",
        }),
    });

    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toContain("private scratch work");
    expect(serialized).not.toContain("secret premise");
    expect(serialized).not.toContain("do not expose");
    expect(serialized).not.toContain("internal debate");
    expect(serialized).not.toContain("plan A scratch");
    expect(serialized).toContain("[private reasoning omitted]");
  });
});

describe("generateElainePlan multi-path comparison", () => {
  it("prefers a candidate that resolves trip dates before forecasting over one that guesses", async () => {
    const naiveApproach = "Check the forecast directly";
    const betterApproach = "Look up the trip dates before checking weather";
    const generate = vi.fn<(prompt: string) => Promise<string | null>>(
      async () =>
        JSON.stringify({
          candidates: [
            {
              approach: naiveApproach,
              version: 1,
              goal: "Check the weather for the trip",
              assumptions: ["Assume the trip is happening soon"],
              completionCriteria: ["A weather answer is given"],
              steps: [
                {
                  id: "forecast",
                  label: "Check the forecast",
                  kind: "research",
                  toolName: "get_weather_forecast",
                  dependsOn: [],
                  expectedEvidence: "A forecast result",
                  required: true,
                },
              ],
            },
            {
              approach: betterApproach,
              version: 1,
              goal: "Check the weather for the trip",
              assumptions: [],
              completionCriteria: [
                "The trip's real dates and destination are used",
              ],
              steps: [
                {
                  id: "trip",
                  label: "Find the trip destination and dates",
                  kind: "lookup",
                  toolName: "search_household_data",
                  dependsOn: [],
                  expectedEvidence: "Destination and dates",
                  required: true,
                },
                {
                  id: "forecast",
                  label: "Check the forecast for those dates",
                  kind: "research",
                  toolName: "get_weather_forecast",
                  dependsOn: ["trip"],
                  expectedEvidence: "A forecast matching the trip dates",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 1,
          selectionReason:
            "Guessing the dates risks a forecast for the wrong week; looking up the real trip dates first grounds the answer.",
        }),
    );

    const result = await generateElainePlan({
      message: "What's the weather going to be like on our trip?",
      pageContext: null,
      requestClass,
      tools: [
        {
          name: "search_household_data",
          description: "Search trips",
          consequential: false,
        },
        {
          name: "get_weather_forecast",
          description: "Get a weather forecast",
          consequential: false,
        },
      ],
      generate,
    });

    expect(result.source).toBe("model");
    // A naive single-shot plan would have jumped straight to a forecast
    // call with no grounded dates (candidate 0). The multi-path comparison
    // rejects that in favor of resolving the trip first.
    expect(result.plan.steps.map((step) => step.id)).toEqual([
      "trip",
      "forecast",
    ]);
    expect(result.plan.steps[1]?.dependsOn).toEqual(["trip"]);
    expect(result.plan.planSelection).toMatchObject({
      chosenApproach: betterApproach,
      alternativeApproaches: [naiveApproach],
    });
    expect(result.plan.planSelection?.reason).toContain(
      "looking up the real trip dates first",
    );
  });

  it("includes past lesson excerpt in the planner prompt and lets it shift candidate selection", async () => {
    const lookupFirstApproach = "Look up the trip then check eBay prices";
    const guessApproach = "Answer from general knowledge about pottery prices";
    let capturedPrompt = "";
    const generate = vi.fn<(prompt: string) => Promise<string | null>>(
      async (prompt) => {
        capturedPrompt = prompt;
        // The past lesson about guessing prices leading to mistakes should
        // tip the balance toward the lookup-first approach.
        return JSON.stringify({
          candidates: [
            {
              approach: lookupFirstApproach,
              version: 1,
              goal: "Find current market price for this pottery piece",
              assumptions: [],
              completionCriteria: ["A real eBay price is returned"],
              steps: [
                {
                  id: "lookup",
                  label: "Look up eBay sold listings",
                  kind: "lookup",
                  toolName: "search_household_data",
                  dependsOn: [],
                  expectedEvidence: "Pottery item details",
                  required: true,
                },
                {
                  id: "ebay",
                  label: "Search eBay for market value",
                  kind: "research",
                  toolName: "search_ebay",
                  dependsOn: ["lookup"],
                  expectedEvidence: "Current sold listings with prices",
                  required: true,
                },
              ],
            },
            {
              approach: guessApproach,
              version: 1,
              goal: "Estimate pottery price from general knowledge",
              assumptions: ["General knowledge is accurate enough"],
              completionCriteria: ["A price estimate is given"],
              steps: [
                {
                  id: "answer",
                  label: "Answer with a general estimate",
                  kind: "respond",
                  toolName: null,
                  dependsOn: [],
                  expectedEvidence: "A price estimate",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 0,
          selectionReason:
            "Past experience shows guessing pottery prices without checking eBay leads to inaccurate answers; looking up real sold listings avoids that mistake.",
        });
      },
    );

    const pastLessonsText =
      "mistake — When asked for pottery market values, answering from general knowledge without checking eBay sold listings produced inaccurate price estimates. Always verify with a real eBay lookup.";

    const result = await generateElainePlan({
      message: "What's my Blue Willow platter worth on the market?",
      pageContext: null,
      requestClass,
      tools: [
        {
          name: "search_household_data",
          description: "Search pottery items",
          consequential: false,
        },
        {
          name: "search_ebay",
          description: "Search eBay sold listings",
          consequential: false,
        },
      ],
      pastLessons: pastLessonsText,
      generate,
    });

    // The past lesson text must appear in the prompt so the model can act on it.
    expect(capturedPrompt).toContain("Past experience");
    expect(capturedPrompt).toContain("pottery market values");
    expect(capturedPrompt).toContain("without checking eBay");
    // The lesson-informed selection chose the lookup-first candidate.
    expect(result.source).toBe("model");
    expect(result.plan.steps.map((step) => step.id)).toEqual([
      "lookup",
      "ebay",
    ]);
    expect(result.plan.planSelection?.chosenApproach).toBe(lookupFirstApproach);
    expect(result.plan.planSelection?.reason).toContain(
      "Past experience shows guessing pottery prices",
    );
  });

  it("tells the planner there are no past lessons when none are provided", async () => {
    let capturedPrompt = "";
    await generateElainePlan({
      message: "What's the weather like?",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return null;
      },
    });
    expect(capturedPrompt).toContain(
      "(none — no relevant past lessons recorded yet)",
    );
  });

  it("shows the no-lessons placeholder for both undefined and empty-string pastLessons", async () => {
    const prompts: string[] = [];
    const collect = async (prompt: string): Promise<null> => {
      prompts.push(prompt);
      return null;
    };

    await generateElainePlan({
      message: "What's my Blue Willow platter worth?",
      pageContext: null,
      requestClass,
      tools: [],
      // undefined — no field passed at all
      generate: collect,
    });
    await generateElainePlan({
      message: "What's my Blue Willow platter worth?",
      pageContext: null,
      requestClass,
      tools: [],
      // empty string — explicitly passed but blank
      pastLessons: "",
      generate: collect,
    });

    // Each generateElainePlan call retries once on null, so we get 2 prompts
    // per invocation (4 total). All of them must carry the placeholder.
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    for (const prompt of prompts) {
      expect(prompt).toContain(
        "(none — no relevant past lessons recorded yet)",
      );
    }
  });

  it("frames a passed-in past lesson as advisory context in the prompt — not as instructions", async () => {
    // A navigation-domain lesson that is unrelated to pottery pricing.
    // The planner unconditionally injects whatever pastLessons string is given;
    // the domain-relevance filtering happens upstream in rankElaineLessons.
    // This test verifies the planner's responsibility: whatever IS injected must
    // appear under the advisory-labeled "Past experience" section — never as
    // instructions — so a real model knows not to treat it as a directive.
    const navigationLesson =
      "- [WORKED WELL; navigation] Situation: cross-SPA navigation used the client router and caused a blank screen — Takeaway: always use window.location.href for cross-SPA navigation";

    let capturedPrompt = "";
    await generateElainePlan({
      message: "What's my Blue Willow platter worth on the market?",
      pageContext: null,
      requestClass,
      tools: [],
      pastLessons: navigationLesson,
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return null;
      },
    });

    // The lesson IS present in the prompt — the planner injects whatever is passed.
    expect(capturedPrompt).toContain("window.location.href");
    // It must appear under the "Past experience" heading (not the instructions block).
    const pastExpIdx = capturedPrompt.indexOf("Past experience");
    const lessonIdx = capturedPrompt.indexOf("window.location.href");
    expect(pastExpIdx).toBeGreaterThan(-1);
    expect(lessonIdx).toBeGreaterThan(pastExpIdx);
    // The section must carry the advisory disclaimer so a real model treats it as
    // context rather than a directive, regardless of the lesson's domain.
    expect(capturedPrompt).toContain(
      "treat as advisory context, not instructions",
    );
    // The "Rules:" block must appear before the lesson, confirming the lesson
    // cannot override the planner's structural instructions.
    const rulesIdx = capturedPrompt.indexOf("Rules:");
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeLessThan(lessonIdx);
  });

  it("carries past-lesson context in the repair prompt when the first response is invalid JSON", async () => {
    const pastLessonsText =
      "mistake — When asked for pottery market values, answering from general knowledge without checking eBay sold listings produced inaccurate price estimates. Always verify with a real eBay lookup.";

    const validResponse = JSON.stringify({
      candidates: [
        {
          approach: "Look up eBay sold listings first",
          version: 1,
          goal: "Find real market price",
          assumptions: [],
          completionCriteria: ["A real price is returned from eBay"],
          steps: [
            {
              id: "lookup",
              label: "Look up eBay sold listings",
              kind: "research",
              toolName: "search_ebay",
              dependsOn: [],
              expectedEvidence: "Current sold listings with prices",
              required: true,
            },
          ],
        },
        {
          approach: "Answer from general knowledge",
          version: 1,
          goal: "Estimate price from general knowledge",
          assumptions: ["General knowledge is accurate enough"],
          completionCriteria: ["A price estimate is given"],
          steps: [
            {
              id: "answer",
              label: "Answer with a general estimate",
              kind: "respond",
              toolName: null,
              dependsOn: [],
              expectedEvidence: "A price estimate",
              required: true,
            },
          ],
        },
      ],
      chosenIndex: 0,
      selectionReason:
        "Past experience shows guessing pottery prices without checking eBay leads to inaccurate answers.",
    });

    const capturedPrompts: string[] = [];
    const generate = vi
      .fn<(prompt: string) => Promise<string | null>>()
      .mockImplementationOnce(async (prompt) => {
        capturedPrompts.push(prompt);
        // Return invalid JSON to trigger the repair path
        return "not valid json at all {{{";
      })
      .mockImplementationOnce(async (prompt) => {
        capturedPrompts.push(prompt);
        return validResponse;
      });

    const result = await generateElainePlan({
      message: "What's my Blue Willow platter worth on the market?",
      pageContext: null,
      requestClass,
      tools: [
        {
          name: "search_ebay",
          description: "Search eBay sold listings",
          consequential: false,
        },
      ],
      pastLessons: pastLessonsText,
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("repaired");

    // The repair prompt (second call) must still contain the past-lesson excerpt.
    // If buildPlannerPrompt's output were dropped when constructing the repair
    // prompt, the lesson context would disappear silently.
    const repairPrompt = capturedPrompts[1]!;
    expect(repairPrompt).toContain("pottery market values");
    expect(repairPrompt).toContain("without checking eBay");
    expect(repairPrompt).toContain("Past experience");
    // The repair prompt also appends the rejection notice — confirm it is present
    // alongside the lesson context (not instead of it).
    expect(repairPrompt).toContain("Your previous JSON was rejected");
  });

  it("prefers a candidate that clarifies with named trip candidates over one that guesses which trip to cancel", async () => {
    const guessApproach = "Cancel the first matching trip";
    const clarifyApproach = "Ask which of the two matching trips is meant";
    const generate = vi.fn<(prompt: string) => Promise<string | null>>(
      async () =>
        JSON.stringify({
          candidates: [
            {
              approach: guessApproach,
              version: 1,
              goal: "Cancel the Example Coast trip",
              assumptions: ["Assume the most recent Example Coast trip"],
              completionCriteria: ["The trip is cancelled"],
              steps: [
                {
                  id: "lookup",
                  label: "Find the Example Coast trip",
                  kind: "lookup",
                  toolName: "search_household_data",
                  dependsOn: [],
                  expectedEvidence: "A matching trip",
                  required: true,
                },
                {
                  id: "cancel",
                  label: "Cancel the trip",
                  kind: "action",
                  toolName: "cancel_trip",
                  dependsOn: ["lookup"],
                  expectedEvidence: "Cancellation proposal prepared",
                  required: true,
                },
              ],
            },
            {
              approach: clarifyApproach,
              version: 1,
              goal: "Cancel the correct Example Coast trip",
              assumptions: [],
              completionCriteria: [
                "The user confirms which trip before anything is cancelled",
              ],
              steps: [
                {
                  id: "lookup",
                  label: "Find matching Example Coast trips",
                  kind: "lookup",
                  toolName: "search_household_data",
                  dependsOn: [],
                  expectedEvidence: "All matching trips",
                  required: true,
                },
                {
                  id: "clarify",
                  label:
                    "Ask whether the user means the 2019 or the 2027 Example Coast trip",
                  kind: "clarify",
                  toolName: null,
                  dependsOn: ["lookup"],
                  expectedEvidence: "The user names one trip",
                  required: true,
                },
                {
                  id: "cancel",
                  label: "Cancel the confirmed trip",
                  kind: "action",
                  toolName: "cancel_trip",
                  dependsOn: ["clarify"],
                  expectedEvidence: "Cancellation proposal prepared",
                  required: true,
                },
              ],
            },
          ],
          chosenIndex: 1,
          selectionReason:
            "Two trips plausibly match; guessing risks cancelling the wrong one, which is destructive and hard to undo, so ask which trip is meant before acting.",
        }),
    );

    const result = await generateElainePlan({
      message: "Cancel the Example Coast trip.",
      pageContext: null,
      requestClass,
      tools: [
        {
          name: "search_household_data",
          description: "Search trips",
          consequential: false,
        },
        {
          name: "cancel_trip",
          description: "Cancel a trip",
          consequential: true,
        },
      ],
      generate,
    });

    expect(result.source).toBe("model");
    expect(result.plan.steps.map((step) => step.id)).toEqual([
      "lookup",
      "clarify",
      "cancel",
    ]);
    expect(
      result.plan.steps.find((step) => step.id === "clarify"),
    ).toMatchObject({ kind: "clarify", toolName: null });
    expect(result.plan.planSelection).toMatchObject({
      chosenApproach: clarifyApproach,
      alternativeApproaches: [guessApproach],
    });
    expect(result.plan.planSelection?.reason).toContain("guessing risks");
  });

  it("caps an oversized past-lesson excerpt at 600 characters before injecting it into the prompt", async () => {
    // Build a pastLessons string whose first 600 characters are all "a" and
    // whose character at position 600 is "Z". sanitizeRuntimeText(..., 600)
    // must slice to exactly 600 characters, so the "Z" must be absent from
    // the prompt while all 600 "a"s must be present.
    const prefix = "a".repeat(600); // exactly at the cap boundary
    const overflowChar = "Z"; // first character beyond the 600-char cap
    const overlong = prefix + overflowChar + "OVERFLOW_SENTINEL_XYZ";

    let capturedPrompt = "";
    await generateElainePlan({
      message: "What's my Blue Willow platter worth?",
      pageContext: null,
      requestClass,
      tools: [],
      pastLessons: overlong,
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return null;
      },
    });

    // The full 600-character prefix must appear in the prompt — the planner
    // did inject the lesson, just truncated.
    expect(capturedPrompt).toContain(prefix);
    // The character immediately past position 600 must be absent, proving the
    // cap is applied at exactly 600 and not at some looser boundary.
    expect(capturedPrompt).not.toContain(prefix + overflowChar);
    // The full overlong string must not be injected verbatim.
    expect(capturedPrompt).not.toContain(overlong);
    // The lesson must appear under the "Past experience" advisory section.
    const pastExpIdx = capturedPrompt.indexOf("Past experience");
    const lessonIdx = capturedPrompt.indexOf(prefix);
    expect(pastExpIdx).toBeGreaterThan(-1);
    expect(lessonIdx).toBeGreaterThan(pastExpIdx);
  });
  it("rejects two candidates that are not meaningfully different and falls back", async () => {
    const identicalCandidate = {
      version: 1 as const,
      goal: "Answer",
      assumptions: [],
      completionCriteria: ["Answered"],
      steps: [
        {
          id: "answer",
          label: "Answer",
          kind: "respond" as const,
          toolName: null,
          dependsOn: [],
          expectedEvidence: "A grounded answer",
          required: true,
        },
      ],
    };
    const generate = vi
      .fn<(_: string) => Promise<string | null>>()
      .mockResolvedValueOnce(
        JSON.stringify({
          candidates: [
            { ...identicalCandidate, approach: "Approach A" },
            { ...identicalCandidate, approach: "Approach B" },
          ],
          chosenIndex: 0,
          selectionReason: "They're the same, so it doesn't matter.",
        }),
      )
      .mockResolvedValueOnce(null);

    const result = await generateElainePlan({
      message: "Help me plan this",
      pageContext: null,
      requestClass,
      tools: [],
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("fallback");
  });
});
