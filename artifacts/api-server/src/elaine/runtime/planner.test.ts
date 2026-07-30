import { describe, expect, it, vi } from "vitest";
import {
  createFallbackPlan,
  generateElainePlan,
  validateElainePlan,
} from "./planner";

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

describe("generateElainePlan", () => {
  it("repairs one invalid response and returns the validated plan", async () => {
    const generate = vi
      .fn<(_: string) => Promise<string | null>>()
      .mockResolvedValueOnce('{"steps":[]}')
      .mockResolvedValueOnce(
        JSON.stringify({
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

  it("removes hidden reasoning from every user-safe plan field", async () => {
    const result = await generateElainePlan({
      message: "Help me plan this",
      pageContext: null,
      requestClass,
      tools: [],
      generate: async () =>
        JSON.stringify({
          version: 1,
          goal: "<think>private scratch work</think> Help with the request",
          assumptions: ["<reasoning>secret premise</reasoning> Safe premise"],
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
        }),
    });

    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toContain("private scratch work");
    expect(serialized).not.toContain("secret premise");
    expect(serialized).not.toContain("do not expose");
    expect(serialized).toContain("[private reasoning omitted]");
  });
});
