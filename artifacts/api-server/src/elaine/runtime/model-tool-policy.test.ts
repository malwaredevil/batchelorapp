import { describe, expect, it } from "vitest";
import {
  MODEL_VISIBLE_HARD_TOOL_NAMES,
  MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS,
} from "./model-tool-policy";
import { ELAINE_TOOL_POLICIES } from "../capability-registry";

describe("model-visible hard-tool policy", () => {
  it("dispatches every web read declared by the capability registry", () => {
    // Independent source of truth, not a second copy of the dispatch list:
    // the old test and the list both omitted an implemented contact lookup.
    const missing = Object.values(ELAINE_TOOL_POLICIES)
      .filter(
        (policy) => policy.kind === "read" && policy.channels.includes("web"),
      )
      .map((policy) => policy.toolName)
      .filter((name) => !MODEL_VISIBLE_HARD_TOOL_NAMES.has(name));
    expect(missing).toEqual([]);
    expect(
      [...MODEL_VISIBLE_HARD_TOOL_NAMES].every(
        (name) =>
          MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS[name] &&
          ELAINE_TOOL_POLICIES[name],
      ),
    ).toBe(true);
  });

  it("does not treat actions, navigation, or mode changes as hard reads", () => {
    for (const name of [
      "update_trip",
      "suggest_navigation",
      "set_action_confirmation_mode",
    ]) {
      expect(MODEL_VISIBLE_HARD_TOOL_NAMES.has(name)).toBe(false);
    }
  });
});
