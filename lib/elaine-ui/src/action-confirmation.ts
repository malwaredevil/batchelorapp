import type { AssistantAction } from "@workspace/api-client-react";

const ACTION_CONFIRMATION_ERROR_MESSAGE =
  "The action could not be completed safely.";

/**
 * Confirmation responses are not guaranteed to contain a user-safe error.
 * Keep provider, storage, and database details out of the toast regardless of
 * whether the executor returned them as structured data or encoded JSON.
 */
export function getActionErrorMessage(error: unknown): string {
  void error;
  return ACTION_CONFIRMATION_ERROR_MESSAGE;
}

export function removeFirstPendingAction(
  actions: AssistantAction[],
): AssistantAction[] {
  return actions.slice(1);
}

/**
 * Remove the action that was actually submitted, rather than whichever action
 * happens to be first when the executor resolves. If the submitted action was
 * skipped while in flight, leave the current queue untouched.
 */
export function removeSubmittedAction(
  actions: AssistantAction[],
  submittedAction: AssistantAction,
): AssistantAction[] {
  const index = actions.indexOf(submittedAction);
  return index === -1
    ? actions
    : [...actions.slice(0, index), ...actions.slice(index + 1)];
}
