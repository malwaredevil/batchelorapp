import { describe, expect, it } from "vitest";
import type { AssistantAction } from "@workspace/api-client-react";
import {
  getActionErrorMessage,
  removeFirstPendingAction,
  removeSubmittedAction,
} from "./action-confirmation";

describe("action confirmation", () => {
  it("does not expose structured executor error details", () => {
    const internalDetail =
      "provider timeout: postgres connection password=secret";
    const error = Object.assign(new Error(internalDetail), {
      data: { error: internalDetail },
    });

    expect(getActionErrorMessage(error)).toBe(
      "The action could not be completed safely.",
    );
    expect(getActionErrorMessage(error)).not.toContain(internalDetail);
  });

  it("does not expose JSON-encoded executor error details", () => {
    const internalDetail = "storage failure: s3 access token=secret";
    const error = new Error(JSON.stringify({ error: internalDetail }));

    expect(getActionErrorMessage(error)).toBe(
      "The action could not be completed safely.",
    );
    expect(getActionErrorMessage(error)).not.toContain(internalDetail);
  });

  it("removes the failed action while preserving pending actions", () => {
    const actions: AssistantAction[] = [
      { type: "correct_memory", payload: {}, label: "First" },
      { type: "forget_memory", payload: {}, label: "Second" },
    ];

    expect(removeFirstPendingAction(actions)).toEqual([actions[1]]);
  });

  it("removes the submitted action by identity when the queue changes in flight", () => {
    const first: AssistantAction = {
      type: "correct_memory",
      payload: { id: 1 },
      label: "First",
    };
    const second: AssistantAction = {
      type: "forget_memory",
      payload: { id: 2 },
      label: "Second",
    };

    // A was submitted, then skipped before its mutation resolved. A must not
    // cause B (the new queue head) to be removed.
    expect(removeSubmittedAction([second], first)).toEqual([second]);
    expect(removeSubmittedAction([first, second], first)).toEqual([second]);
  });
});
