import { describe, expect, it } from "vitest";
import {
  buildElaineSourceRoute,
  hasCurrentRetrievedEvidence,
  provenanceForTool,
} from "./source-policy";

const capabilities = [
  {
    toolName: "query_household_data",
    domain: "travels",
    auth: "session",
    kind: "read",
  },
  {
    toolName: "summarize_inbox",
    domain: "office",
    auth: "session_and_user_oauth",
    kind: "read",
  },
  {
    toolName: "get_weather_forecast",
    domain: "travels",
    auth: "session",
    kind: "read",
  },
  {
    toolName: "web_search",
    domain: "research",
    auth: "session",
    kind: "read",
  },
] as const;

describe("Elaine source policy", () => {
  it("keeps stable explanations on the model fast path", () => {
    const route = buildElaineSourceRoute({
      message: "Why do leaves change color?",
      requestClass: {
        kind: "answer",
        complexity: "simple",
        requiresFreshData: false,
        hasAttachment: false,
      },
      capabilities,
    });

    expect(route).toMatchObject({
      freshness: "stable",
      requiresRetrievedEvidence: false,
      preferredKinds: ["model_synthesis"],
    });
  });

  it("requires live evidence and deliberate fallbacks for volatile facts", () => {
    const route = buildElaineSourceRoute({
      message: "What is the latest weather forecast for tomorrow?",
      requestClass: {
        kind: "research",
        complexity: "simple",
        requiresFreshData: true,
        hasAttachment: false,
      },
      capabilities,
    });

    expect(route.freshness).toBe("current");
    expect(route.requiresRetrievedEvidence).toBe(true);
    expect(route.preferredKinds).toEqual([
      "specialized_api",
      "web",
      "model_synthesis",
    ]);
    expect(route.fallbackKinds).toContain("web");
  });

  it("prefers app data for household questions", () => {
    const route = buildElaineSourceRoute({
      message: "When is our next trip?",
      pageContext: "[travels] Dashboard",
      requestClass: {
        kind: "read",
        complexity: "simple",
        requiresFreshData: false,
        hasAttachment: false,
      },
      capabilities,
    });

    expect(route.preferredKinds.slice(0, 2)).toEqual([
      "current_context",
      "batchelor_app",
    ]);
  });

  it("identifies connected inbox reads as first-party evidence", () => {
    expect(provenanceForTool({ toolName: "summarize_inbox" }).sourceKind).toBe(
      "first_party_provider",
    );
  });

  it("does not count static page context as current retrieved evidence for volatile questions", () => {
    // Regression: current_context (page context injected before tool calls) is
    // static — it must never satisfy requiresRetrievedEvidence even when
    // pageContext is present, so volatile/current questions actually reach a
    // live provider or web search before completing.
    const pageContextObservation = {
      success: true,
      provenance: {
        sourceKind: "current_context" as const,
        sourceName: "current page context",
        observedAt: new Date().toISOString(),
        evidenceKind: "retrieved_fact" as const,
        confidence: "high" as const,
        coverage: { status: "matched" as const },
      },
    };

    expect(hasCurrentRetrievedEvidence([pageContextObservation])).toBe(false);

    // But adding a real live retrieval on top does satisfy it.
    expect(
      hasCurrentRetrievedEvidence([
        pageContextObservation,
        {
          success: true,
          provenance: provenanceForTool({
            toolName: "get_weather_forecast",
            coverageStatus: "matched",
          }),
        },
      ]),
    ).toBe(true);
  });

  it("does not count successful action tool calls as current retrieved evidence", () => {
    // Regression: action tools (write mutations like remember_fact, update_trip)
    // must not satisfy requiresRetrievedEvidence — they mutate state, they do not
    // retrieve current world data.  They get evidenceKind: "inference" which is
    // already excluded from hasCurrentRetrievedEvidence.
    const actionToolObservation = {
      success: true,
      provenance: provenanceForTool({
        toolName: "remember_fact",
        kind: "action" as const,
        coverageStatus: "matched",
      }),
    };

    expect(actionToolObservation.provenance.evidenceKind).toBe("inference");
    expect(hasCurrentRetrievedEvidence([actionToolObservation])).toBe(false);

    // A read tool alongside it still satisfies the gate.
    expect(
      hasCurrentRetrievedEvidence([
        actionToolObservation,
        {
          success: true,
          provenance: provenanceForTool({
            toolName: "web_search",
            kind: "read" as const,
            coverageStatus: "matched",
          }),
        },
      ]),
    ).toBe(true);
  });

  it("does not count inference or out-of-coverage data as current evidence", () => {
    expect(
      hasCurrentRetrievedEvidence([
        {
          success: true,
          provenance: {
            ...provenanceForTool({ toolName: "consult_experts" }),
            evidenceKind: "inference",
          },
        },
        {
          success: true,
          provenance: provenanceForTool({
            toolName: "get_weather_forecast",
            coverageStatus: "outside",
          }),
        },
      ]),
    ).toBe(false);

    expect(
      hasCurrentRetrievedEvidence([
        {
          success: true,
          provenance: provenanceForTool({
            toolName: "web_search",
            coverageStatus: "matched",
            sourceUrl: "https://example.test/current",
          }),
        },
      ]),
    ).toBe(true);
  });

  it("does not count a failed exchange-rate provider observation", () => {
    expect(
      hasCurrentRetrievedEvidence([
        {
          success: false,
          provenance: provenanceForTool({
            toolName: "get_exchange_rate",
            coverageStatus: "unknown",
          }),
        },
      ]),
    ).toBe(false);
  });
});
