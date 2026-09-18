import { describe, expect, it } from "vitest";
import type { AssistantAction } from "@workspace/api-client-react";
import {
  getActionErrorMessage,
  removeFirstPendingAction,
} from "./action-confirmation";

describe("action confirmation", () => {
  it("uses the structured API error before message fallbacks", () => {
    const error = Object.assign(new Error("unsafe provider detail"), {
      data: { error: "The action could not be completed safely." },
    });

    expect(getActionErrorMessage(error)).toBe(
      "The action could not be completed safely.",
    );
  });

  it("removes the failed action while preserving pending actions", () => {
    const actions: AssistantAction[] = [
      { type: "correct_memory", payload: {}, label: "First" },
      { type: "forget_memory", payload: {}, label: "Second" },
    ];

    expect(removeFirstPendingAction(actions)).toEqual([actions[1]]);
  });
});
