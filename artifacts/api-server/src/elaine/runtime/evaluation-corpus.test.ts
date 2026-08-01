import { describe, expect, it } from "vitest";
import {
  classifyElaineRequest,
  requestNeedsStructuredPlan,
} from "./classifier";
import { ELAINE_EVALUATION_CORPUS } from "./evaluation-corpus";
import { buildElaineEvaluationReport } from "./evaluation-report";
import {
  assertElaineToolFamilyCoverage,
  ELAINE_TOOL_FAMILY_SENTINELS,
} from "./tool-families";
import { evaluateForecastDateCoverage } from "./weather-coverage";

describe("Elaine deterministic evaluation corpus", () => {
  it("is versioned, non-sensitive, and asserts positive and forbidden behavior", () => {
    expect(ELAINE_EVALUATION_CORPUS.version).toBe(3);
    expect(ELAINE_EVALUATION_CORPUS.scenarios).toHaveLength(18);
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
      corpusVersion: 3,
      scenarioCount: 18,
      passed: 18,
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
