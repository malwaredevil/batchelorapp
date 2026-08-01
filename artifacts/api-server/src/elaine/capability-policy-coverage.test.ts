import { describe, expect, it } from "vitest";
import {
  ACTION_TOOLS,
  buildElainePlannerToolCatalog,
  SOFT_TOOLS,
  SOFT_TOOLS_EXTRA,
} from "./planner-tool-catalog";
import {
  buildElaineCapabilityRegistry,
  ELAINE_TOOL_POLICIES,
} from "./capability-registry";

/**
 * Startup-parity guard: every tool sent to the planner model must have a
 * registered capability policy.  Previously this was only caught at runtime
 * (server startup throws via buildElaineCapabilityRegistry), which meant the
 * error surfaced as a Sentry alert in production.  This test reproduces that
 * check in CI so a missing policy fails the build before the code ships.
 */
describe("Elaine planner tool catalog — capability policy coverage", () => {
  it("every tool in the full planner catalog has a registered capability policy", () => {
    // buildElaineCapabilityRegistry throws when any tool lacks a policy entry.
    // Calling it here with the real production tool arrays reproduces the check
    // that previously only ran at server startup.
    expect(() =>
      buildElaineCapabilityRegistry([
        ...ACTION_TOOLS,
        ...SOFT_TOOLS,
        ...SOFT_TOOLS_EXTRA,
      ]),
    ).not.toThrow();
  });

  it("buildElainePlannerToolCatalog succeeds end-to-end (policy + family coverage)", () => {
    // This exercises the full catalog build including assertElaineToolFamilyCoverage.
    expect(() => buildElainePlannerToolCatalog()).not.toThrow();
  });

  it("every ELAINE_TOOL_POLICIES entry has a matching tool in the catalog", () => {
    // Guard against stale policy rows that refer to tools that no longer exist
    // in the catalog — these are dead weight but can mask real missing-policy bugs.
    const catalogNames = new Set(
      [...ACTION_TOOLS, ...SOFT_TOOLS, ...SOFT_TOOLS_EXTRA]
        .filter(
          (t): t is Extract<typeof t, { type: "function" }> =>
            t.type === "function",
        )
        .map((t) => t.function.name),
    );
    const staleEntries = Object.keys(ELAINE_TOOL_POLICIES).filter(
      (name) => !catalogNames.has(name),
    );
    expect(staleEntries).toEqual([]);
  });

  it("catalog contains no duplicate tool names", () => {
    const allNames = [...ACTION_TOOLS, ...SOFT_TOOLS, ...SOFT_TOOLS_EXTRA]
      .filter((t) => t.type === "function")
      .map((t) => (t as Extract<typeof t, { type: "function" }>).function.name);
    expect(allNames.length).toBe(new Set(allNames).size);
  });
});
