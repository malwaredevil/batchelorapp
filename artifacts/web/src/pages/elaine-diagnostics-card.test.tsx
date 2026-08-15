/**
 * Tests for ElaineDiagnosticsCard — the Trace Quality card shown in the
 * Global Config tab of the owner panel.
 *
 * Three scenarios are covered:
 *  1. Successful fetch → card renders the trace-quality metrics.
 *  2. null nonDefaultPlanChosenRate → renders the dash message, not "0%".
 *  3. Failed fetch (non-OK HTTP response) → error banner appears, no blank card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ElaineDiagnosticsCard } from "./elaine-diagnostics-card";
import type { ElaineDiagnosticsResponse } from "./elaine-diagnostics-card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: ElaineDiagnosticsResponse): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeErrorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
  } as unknown as Response;
}

function baseTraceQuality(
  overrides: Partial<ElaineDiagnosticsResponse["traceQuality"]> = {},
): ElaineDiagnosticsResponse["traceQuality"] {
  return {
    evaluatedTurns: 42,
    healthyTurns: 38,
    needsReviewTurns: 3,
    failedTurns: 1,
    turnsWithReplans: 5,
    turnsWithMultiPathPlanning: 10,
    turnsWithKnownPlanChoice: 10,
    turnsWithNonDefaultPlanChosen: 3,
    nonDefaultPlanChosenRate: 0.3,
    ...overrides,
  };
}

function makeDiagnosticsResponse(
  overrides: Partial<ElaineDiagnosticsResponse["traceQuality"]> = {},
): ElaineDiagnosticsResponse {
  return {
    generatedAt: "2026-08-15T12:00:00.000Z",
    periodDays: 30,
    traceQuality: baseTraceQuality(overrides),
  };
}

// ---------------------------------------------------------------------------
// Setup: stub global fetch before each test, restore after.
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ElaineDiagnosticsCard", () => {
  it("renders trace-quality metrics after a successful fetch", async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse(makeDiagnosticsResponse()));

    render(React.createElement(ElaineDiagnosticsCard));

    // While loading the spinner text should be present initially
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    // After the fetch resolves the metrics appear
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());

    // Header
    expect(screen.getByText("Trace Quality")).toBeInTheDocument();
    expect(
      screen.getByText("(last 30 days)", { exact: false }),
    ).toBeInTheDocument();

    // Healthy / needs review / failed counts
    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    // 30% non-default rate
    expect(screen.getByText("30%")).toBeInTheDocument();

    // Loading text is gone
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();

    // No error banner
    expect(
      screen.queryByText(/Failed to load|500|503/),
    ).not.toBeInTheDocument();
  });

  it("renders the dash message — not '0%' — when nonDefaultPlanChosenRate is null", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeOkResponse(
        makeDiagnosticsResponse({
          // turnsWithMultiPathPlanning > 0 so we enter the multi-path branch,
          // but nonDefaultPlanChosenRate is null (no turns have a known choice).
          turnsWithMultiPathPlanning: 5,
          turnsWithKnownPlanChoice: 0,
          turnsWithNonDefaultPlanChosen: 0,
          nonDefaultPlanChosenRate: null,
        }),
      ),
    );

    render(React.createElement(ElaineDiagnosticsCard));

    await waitFor(() =>
      expect(
        screen.getByText("— (no multi-path turns in window)"),
      ).toBeInTheDocument(),
    );

    // Must NOT render "0%" as if the rate were 0
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows the error banner — not a blank card — when the fetch returns a non-OK response", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeErrorResponse(503, "Service Unavailable"),
    );

    render(React.createElement(ElaineDiagnosticsCard));

    await waitFor(() =>
      expect(screen.getByText("503 Service Unavailable")).toBeInTheDocument(),
    );

    // No metric content rendered
    expect(screen.queryByText("Evaluated turns")).not.toBeInTheDocument();
    // Loading text is gone
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    // The card heading itself still renders (it's outside the conditional blocks)
    expect(screen.getByText("Trace Quality")).toBeInTheDocument();
  });
});
