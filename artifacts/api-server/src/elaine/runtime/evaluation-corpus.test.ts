import { describe, expect, it } from "vitest";
import {
  classifyElaineRequest,
  requestNeedsStructuredPlan,
} from "./classifier";
import { ELAINE_EVALUATION_CORPUS } from "./evaluation-corpus";
import { buildElaineEvaluationReport } from "./evaluation-report";
import { generateElainePlan } from "./planner";
import {
  assertElaineToolFamilyCoverage,
  ELAINE_TOOL_FAMILY_SENTINELS,
} from "./tool-families";
import { ElaineTurnRuntime } from "./turn-runtime";
import { evaluateForecastDateCoverage } from "./weather-coverage";

describe("Elaine deterministic evaluation corpus", () => {
  it("is versioned, non-sensitive, and asserts positive and forbidden behavior", () => {
    expect(ELAINE_EVALUATION_CORPUS.version).toBe(4);
    expect(ELAINE_EVALUATION_CORPUS.scenarios).toHaveLength(21);
    expect(
      new Set(ELAINE_EVALUATION_CORPUS.scenarios.map(({ id }) => id)).size,
    ).toBe(ELAINE_EVALUATION_CORPUS.scenarios.length);

    for (const scenario of ELAINE_EVALUATION_CORPUS.scenarios) {
      expect(scenario.requiredAnswerFacts.length).toBeGreaterThan(0);
      expect(scenario.forbiddenAnswerFacts.length).toBeGreaterThan(0);
      expect(scenario.forbiddenTools.length).toBeGreaterThan(0);
      expect(scenario.forbiddenToolSequences.length).toBeGreaterThan(0);
      expect(
        scenario.forbiddenToolSequences.every(
          (sequence) => sequence.length > 0,
        ),
      ).toBe(true);
      expect(JSON.stringify(scenario)).not.toMatch(
        /@|postgres(?:ql)?:\/\/|supabase_service_role|bearer\s/i,
      );
    }
  });

  it("keeps a simple answer on the no-planner, no-tool fast path", () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "simple_answer",
    )!;
    const requestClass = classifyElaineRequest({ message: scenario.request });
    expect(requestClass).toMatchObject({
      kind: "answer",
      complexity: "simple",
    });
    expect(requestNeedsStructuredPlan(requestClass)).toBe(false);
    expect(scenario.expectedToolSequence).toEqual([]);
  });

  it("makes the Sicily/date-horizon mismatch structurally impossible to mislabel", () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "dependent_weather",
    )!;
    const coverage = evaluateForecastDateCoverage({
      requestedStartDate: "2027-08-05",
      requestedEndDate: "2027-08-08",
      forecastDates: ["2026-07-30", "2026-07-31", "2026-08-01"],
    });

    expect(coverage.status).toBe("outside");
    expect(scenario.expectedToolSequence).toEqual([
      "search_household_data",
      "web_search",
    ]);
    expect(scenario.forbiddenTools).toContain("get_weather_forecast");
  });

  it("distinguishes a useful clarification from a blocked turn", () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "missing_information",
    )!;

    expect(scenario.expectedToolSequence).toEqual([]);
    expect(scenario.expectedTerminalStatus).toBe("awaiting_input");
    expect(scenario.requiredAnswerFacts).toEqual(["which trip", "new dates"]);
  });

  it("asks a targeted clarifying question only when a lookup finds real, named candidates", () => {
    const ambiguous = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ id }) => id === "ambiguous-trip-name-collision",
    )!;
    const clear = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ id }) => id === "unambiguous-single-trip-match-acts-immediately",
    )!;

    // Same request text — the only difference is whether the page context
    // already pins the target, which is exactly the kind of ambiguity this
    // task calibrates: identical wording must not always get the same
    // behavior once real-world context resolves (or fails to resolve) it.
    expect(ambiguous.request).toBe(clear.request);

    expect(ambiguous.expectedTerminalStatus).toBe("awaiting_input");
    expect(ambiguous.expectedToolSequence).not.toContain("cancel_trip");
    expect(ambiguous.requiredAnswerFacts).toEqual(["2019", "2027"]);

    expect(clear.expectedTerminalStatus).toBe("awaiting_confirmation");
    expect(clear.expectedToolSequence).toEqual(["cancel_trip"]);
    expect(clear.forbiddenTools).toContain("search_household_data");
  });

  it("retains every representative legacy tool family", () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "legacy_compatibility",
    )!;
    expect(() =>
      assertElaineToolFamilyCoverage(scenario.availableTools),
    ).not.toThrow();
    expect(Object.keys(ELAINE_TOOL_FAMILY_SENTINELS)).toHaveLength(10);
  });

  it("prints a concise candidate quality summary for CI and Replit", () => {
    const scenarios = ELAINE_EVALUATION_CORPUS.scenarios;
    const passingResults = scenarios.map(({ id }) => ({
      scenarioId: id,
      passed: true,
      toolSequencePassed: true,
      confirmationPassed: true,
      terminalStatusPassed: true,
      requiredFactsPassed: true,
      forbiddenBehaviorPassed: true,
    }));
    const summary = buildElaineEvaluationReport({
      corpusVersion: ELAINE_EVALUATION_CORPUS.version,
      scenarios,
      candidate: passingResults,
      baseline: passingResults,
    });

    console.info("Elaine deterministic candidate report", summary);
    expect(summary).toMatchObject({
      corpusVersion: 4,
      scenarioCount: 21,
      passed: 21,
      passRate: 1,
      safetyPassRate: 1,
      sourceRoutingPassRate: 1,
      memoryPassRate: 1,
      durableTaskPassRate: 1,
      regressionCount: 0,
      gatePassed: true,
    });
  });

  it("fails the candidate gate for a legacy regression", () => {
    const scenarios = ELAINE_EVALUATION_CORPUS.scenarios;
    const baseline = scenarios.map(({ id }) => ({
      scenarioId: id,
      passed: true,
      toolSequencePassed: true,
      confirmationPassed: true,
      terminalStatusPassed: true,
      requiredFactsPassed: true,
      forbiddenBehaviorPassed: true,
    }));
    const candidate = baseline.map((result) =>
      result.scenarioId === "legacy-tool-families"
        ? { ...result, passed: false, toolSequencePassed: false }
        : result,
    );
    const report = buildElaineEvaluationReport({
      corpusVersion: ELAINE_EVALUATION_CORPUS.version,
      scenarios,
      candidate,
      baseline,
    });
    expect(report).toMatchObject({
      regressionCount: 1,
      gatePassed: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Multi-path plan comparison — pipeline logic (hand-crafted fixtures)
// ---------------------------------------------------------------------------
// These tests verify that the pipeline from `generateElainePlan` →
// `ElaineTurnRuntime` works correctly for the multi-path case. They use an
// idealized two-candidate fixture that exercises the validator and runtime
// without the variability of a live model call. For tests against an actual
// captured model response, see the "real-model-output fidelity" describe below.
describe("Elaine multi-path plan comparison — pipeline logic", () => {
  const REALISTIC_TWO_CANDIDATE_RESPONSE = JSON.stringify({
    candidates: [
      {
        approach: "Parallel web research from page context",
        version: 1,
        goal: "Provide a full pre-trip picture for the Japan trip",
        assumptions: [
          "Trip 201 destination (Japan) and dates are already visible in page context",
        ],
        completionCriteria: [
          "Visa requirements confirmed from an authoritative source",
          "Health/vaccination recommendations retrieved",
          "Airline price comparison retrieved",
        ],
        steps: [
          {
            id: "visa",
            label: "Look up Japan visa requirements",
            kind: "research",
            toolName: "web_search",
            dependsOn: [],
            expectedEvidence:
              "Current visa requirements for the user's nationality and Japan",
            required: true,
          },
          {
            id: "health",
            label: "Look up vaccination recommendations",
            kind: "research",
            toolName: "web_search",
            dependsOn: [],
            expectedEvidence: "CDC/travel-health recommendations for Japan",
            required: true,
          },
          {
            id: "flights",
            label: "Compare airline options for the April dates",
            kind: "research",
            toolName: "search_flights",
            dependsOn: [],
            expectedEvidence:
              "At least two airline price points for comparison",
            required: true,
          },
        ],
      },
      {
        approach: "Resolve trip details first, then research in sequence",
        version: 1,
        goal: "Provide a full pre-trip picture for the Japan trip",
        assumptions: [],
        completionCriteria: [
          "Trip destination and dates confirmed from app data",
          "Visa, health, and flight information retrieved",
        ],
        steps: [
          {
            id: "trip",
            label: "Confirm trip destination and dates from household data",
            kind: "lookup",
            toolName: "search_household_data",
            dependsOn: [],
            expectedEvidence: "Confirmed Japan trip with start/end dates",
            required: true,
          },
          {
            id: "visa",
            label: "Look up Japan visa requirements",
            kind: "research",
            toolName: "web_search",
            dependsOn: ["trip"],
            expectedEvidence: "Visa requirements for Japan",
            required: true,
          },
          {
            id: "health",
            label: "Look up vaccination recommendations",
            kind: "research",
            toolName: "web_search",
            dependsOn: ["trip"],
            expectedEvidence: "Health recommendations for Japan travel",
            required: true,
          },
          {
            id: "flights",
            label: "Compare airline options",
            kind: "research",
            toolName: "search_flights",
            dependsOn: ["trip"],
            expectedEvidence: "Airline price comparison",
            required: true,
          },
        ],
      },
    ],
    chosenIndex: 0,
    selectionReason:
      "The trip destination and dates are already visible in the page context (tripId 201, Japan, 10–20 Apr 2027), so a round-trip household lookup is an avoidable delay; running visa, health, and flight queries in parallel reaches a grounded answer faster.",
  });

  it("produces a non-fallback plan with planSelection for a complex multi-source request", async () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "multi_path_planning",
    )!;
    expect(scenario).toBeDefined();

    const requestClass = classifyElaineRequest({ message: scenario.request });
    // A complex multi-source request must route through the structured planner.
    expect(requestNeedsStructuredPlan(requestClass)).toBe(true);

    const result = await generateElainePlan({
      message: scenario.request,
      pageContext: scenario.pageContext,
      requestClass,
      tools: scenario.availableTools.map((name) => ({
        name,
        description: `Tool: ${name}`,
        consequential: false,
      })),
      generate: async () => REALISTIC_TWO_CANDIDATE_RESPONSE,
    });

    // Must not fall back — the fixture is well-formed and within the token
    // budget, so neither a parse error nor a candidate-differ rejection should
    // occur.
    expect(result.source).toBe("model");
    expect(result.plan.planSelection).toBeDefined();
    expect(result.plan.planSelection?.chosenApproach).toBe(
      "Parallel web research from page context",
    );
    expect(result.plan.planSelection?.alternativeApproaches).toHaveLength(1);
    expect(result.plan.planSelection?.alternativeApproaches[0]).toBe(
      "Resolve trip details first, then research in sequence",
    );
    expect(result.plan.planSelection?.reason).toContain("page context");
  });

  it("emits a plan_compared trace event with both approach labels when planSelection is present", async () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "multi_path_planning",
    )!;
    const requestClass = classifyElaineRequest({ message: scenario.request });

    const { plan } = await generateElainePlan({
      message: scenario.request,
      pageContext: scenario.pageContext,
      requestClass,
      tools: scenario.availableTools.map((name) => ({
        name,
        description: `Tool: ${name}`,
        consequential: false,
      })),
      generate: async () => REALISTIC_TWO_CANDIDATE_RESPONSE,
    });

    const runtime = new ElaineTurnRuntime({
      traceId: "test-multi-path-001",
      requestClass,
      plan,
    });
    const trace = runtime.snapshot();

    const comparedEvent = trace.events.find(
      (event) => event.type === "plan_compared",
    );
    expect(comparedEvent).toBeDefined();
    expect(comparedEvent?.summary).toContain(
      "Parallel web research from page context",
    );
    expect(comparedEvent?.summary).toContain(
      "Resolve trip details first, then research in sequence",
    );
    // Two approaches were considered (chosenApproach + one alternative).
    expect(comparedEvent?.summary).toContain("2 approaches");
  });
});

// ---------------------------------------------------------------------------
// Multi-path plan comparison — real-model-output fidelity
// ---------------------------------------------------------------------------
// The fixture below is the verbatim raw response from the production planner
// model (z-ai/glm-5.2 via OpenRouter, max_tokens: 1_800, response_format:
// json_object) for the multi_path_planning corpus scenario request. It was
// captured in a live API call that used 1 371 completion tokens — well within
// the 1 800-token OpenRouter max_tokens limit and far below the 3 800-token
// OpenAI Responses maxOutputTokens limit (both values from index.ts ~line 4430,
// grep: max_tokens / maxOutputTokens).
//
// Nothing in this string has been edited. Tests against it confirm that:
//  (a) the real model's formatting (approach IDs with hyphens, dependsOn arrays,
//      respond steps with null toolName, multi-step dependency chains) passes
//      validateElainePlanCandidateSet without triggering the repair cycle, and
//  (b) the resulting plan flows through ElaineTurnRuntime as a plan_compared
//      event — not a fallback — exactly as it would in production.
const CAPTURED_REAL_MODEL_RESPONSE = `{
  "candidates": [
    {
      "approach": "parallel-web-search-then-synthesize",
      "version": 1,
      "goal": "Deliver a combined briefing on Japan visa rules, vaccination needs, and a two-airline comparison for the April 2027 trip.",
      "assumptions": ["The user's nationality is not specified; default guidance will note this caveat.", "Two major carriers serving the user's likely origin will be compared."],
      "completionCriteria": ["Visa requirements for Japan are stated with source attribution.", "Recommended/required vaccinations for Japan travel are listed.", "At least two airlines are compared on price, duration, and stops.", "All findings are presented in one consolidated response."],
      "steps": [
        {
          "id": "visa_search",
          "label": "Search the web for current Japan visa requirements.",
          "kind": "research",
          "toolName": "web_search",
          "dependsOn": [],
          "expectedEvidence": "Search result snippets citing official or reputable sources describing visa policy for Japan.",
          "required": true
        },
        {
          "id": "vax_search",
          "label": "Search the web for Japan travel vaccination recommendations and requirements.",
          "kind": "research",
          "toolName": "web_search",
          "dependsOn": [],
          "expectedEvidence": "Search result snippets from health authorities (CDC/WHO/Japan MoH) listing relevant vaccinations.",
          "required": true
        },
        {
          "id": "flight_search",
          "label": "Search for flight options to Japan around the trip start date.",
          "kind": "lookup",
          "toolName": "search_flights",
          "dependsOn": [],
          "expectedEvidence": "A list of flight options with carrier, price, duration, and stop info.",
          "required": true
        },
        {
          "id": "synthesize",
          "label": "Combine visa, vaccination, and airline comparison findings into one consolidated briefing.",
          "kind": "respond",
          "toolName": null,
          "dependsOn": ["visa_search", "vax_search", "flight_search"],
          "expectedEvidence": "A single response containing all three sections with source attribution.",
          "required": true
        }
      ]
    },
    {
      "approach": "fetch-authoritative-pages-plus-flight-search",
      "version": 1,
      "goal": "Deliver a visa, vaccination, and airline comparison briefing grounded in authoritative primary sources rather than search snippets.",
      "assumptions": ["Official government and health-authority pages will be discoverable via search.", "Search results will surface pages that can be fetched for full detail."],
      "completionCriteria": ["Visa requirements are cited from an official government or embassy page.", "Vaccination guidance is cited from a recognized health authority page.", "At least two airlines are compared using flight search results.", "All findings are presented in one consolidated response."],
      "steps": [
        {
          "id": "find_sources",
          "label": "Search the web for official Japan visa policy pages and health-authority vaccination pages.",
          "kind": "research",
          "toolName": "web_search",
          "dependsOn": [],
          "expectedEvidence": "Search results containing URLs for official/embassy and health-authority pages.",
          "required": true
        },
        {
          "id": "fetch_visa_page",
          "label": "Fetch the official Japan visa policy page for detailed requirements.",
          "kind": "research",
          "toolName": "fetch_page",
          "dependsOn": ["find_sources"],
          "expectedEvidence": "Full page content describing visa categories, exemptions, and application steps.",
          "required": true
        },
        {
          "id": "fetch_vax_page",
          "label": "Fetch a health-authority page (CDC or equivalent) for Japan vaccination guidance.",
          "kind": "research",
          "toolName": "fetch_page",
          "dependsOn": ["find_sources"],
          "expectedEvidence": "Full page content listing recommended and required vaccinations for Japan travelers.",
          "required": true
        },
        {
          "id": "flight_search_b",
          "label": "Search for flight options to Japan around the trip start date.",
          "kind": "lookup",
          "toolName": "search_flights",
          "dependsOn": [],
          "expectedEvidence": "A list of flight options with carrier, price, duration, and stop info.",
          "required": true
        },
        {
          "id": "synthesize_b",
          "label": "Combine fetched visa/vaccination details and flight comparison into one consolidated briefing.",
          "kind": "respond",
          "toolName": null,
          "dependsOn": ["fetch_visa_page", "fetch_vax_page", "flight_search_b"],
          "expectedEvidence": "A single response containing all three sections with primary-source citations.",
          "required": true
        }
      ]
    }
  ],
  "chosenIndex": 0,
  "selectionReason": "The parallel-web-search approach is faster and avoids the risk of fetch_page failing on paywalled or dynamically-rendered government sites. It still yields citable snippets from reputable sources and covers all three user needs in fewer steps, making it the stronger choice for a first-turn overview before deeper drilling if needed."
}`;

// Production token-limit constants (source: artifacts/api-server/src/elaine/index.ts):
//   OpenAI Responses path → maxOutputTokens: 3_800
//   OpenRouter fallback   → max_tokens:      1_800
// The real model call used 1 371 completion tokens; the raw response is
// 5 471 characters. Both values are well within both production limits.
const PLANNER_OPENROUTER_MAX_TOKENS = 1_800;
const PLANNER_OPENAI_MAX_OUTPUT_TOKENS = 3_800;

describe("Elaine multi-path plan comparison — real-model-output fidelity", () => {
  it("captured real-model response passes validateElainePlanCandidateSet without triggering the repair cycle", async () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "multi_path_planning",
    )!;
    const requestClass = classifyElaineRequest({ message: scenario.request });

    const result = await generateElainePlan({
      message: scenario.request,
      pageContext: scenario.pageContext,
      requestClass,
      tools: scenario.availableTools.map((name) => ({
        name,
        description: `Tool: ${name}`,
        consequential: false,
      })),
      // Verbatim model output — no editing, no idealization.
      generate: async () => CAPTURED_REAL_MODEL_RESPONSE,
    });

    // source === "model" means the first attempt passed — no repair round needed.
    expect(result.source).toBe("model");
    expect(result.plan.planSelection).toBeDefined();
    expect(result.plan.planSelection?.chosenApproach).toBe(
      "parallel-web-search-then-synthesize",
    );
    expect(result.plan.planSelection?.alternativeApproaches).toHaveLength(1);
    expect(result.plan.planSelection?.alternativeApproaches[0]).toBe(
      "fetch-authoritative-pages-plus-flight-search",
    );
    // Chosen plan steps match candidate 0 from the real response.
    expect(result.plan.steps.map((s) => s.id)).toEqual([
      "visa_search",
      "vax_search",
      "flight_search",
      "synthesize",
    ]);
    // synthesize depends on the three parallel reads — dependency graph is valid.
    expect(
      result.plan.steps.find((s) => s.id === "synthesize")?.dependsOn,
    ).toEqual(["visa_search", "vax_search", "flight_search"]);
  });

  it("captured real-model response produces a plan_compared trace event in ElaineTurnRuntime", async () => {
    const scenario = ELAINE_EVALUATION_CORPUS.scenarios.find(
      ({ category }) => category === "multi_path_planning",
    )!;
    const requestClass = classifyElaineRequest({ message: scenario.request });

    const { plan } = await generateElainePlan({
      message: scenario.request,
      pageContext: scenario.pageContext,
      requestClass,
      tools: scenario.availableTools.map((name) => ({
        name,
        description: `Tool: ${name}`,
        consequential: false,
      })),
      generate: async () => CAPTURED_REAL_MODEL_RESPONSE,
    });

    const runtime = new ElaineTurnRuntime({
      traceId: "test-real-model-001",
      requestClass,
      plan,
    });
    const trace = runtime.snapshot();

    const comparedEvent = trace.events.find(
      (event) => event.type === "plan_compared",
    );
    expect(comparedEvent).toBeDefined();
    expect(comparedEvent?.type).toBe("plan_compared");
    // Both approach labels appear in the event summary.
    expect(comparedEvent?.summary).toContain(
      "parallel-web-search-then-synthesize",
    );
    expect(comparedEvent?.summary).toContain(
      "fetch-authoritative-pages-plus-flight-search",
    );
    // plan_compared must come after plan_created and before any step event.
    const eventTypes = trace.events.map((e) => e.type);
    const planCreatedIdx = eventTypes.indexOf("plan_created");
    const planComparedIdx = eventTypes.indexOf("plan_compared");
    expect(planCreatedIdx).toBeGreaterThanOrEqual(0);
    expect(planComparedIdx).toBeGreaterThan(planCreatedIdx);
  });

  it("real model output fits within both production token-budget limits", () => {
    // Actual captured usage: 1 371 completion tokens (from OpenRouter usage field).
    // Heuristic chars / 4 ≈ tokens is accurate to within 5% for dense JSON
    // (verified: 5471 chars / 4 = 1368 ≈ 1371 actual).
    const responseChars = CAPTURED_REAL_MODEL_RESPONSE.length;
    const estimatedTokens = Math.ceil(responseChars / 4);

    // Both production limits must comfortably accommodate this real output.
    expect(estimatedTokens).toBeLessThan(PLANNER_OPENROUTER_MAX_TOKENS);
    expect(estimatedTokens).toBeLessThan(PLANNER_OPENAI_MAX_OUTPUT_TOKENS);

    // Safety margin: real output should consume no more than 80% of the tighter
    // (OpenRouter) limit, leaving headroom for a second candidate being longer.
    expect(estimatedTokens).toBeLessThan(
      Math.floor(PLANNER_OPENROUTER_MAX_TOKENS * 0.8),
    );
  });
});
