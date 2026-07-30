export interface ElainePreparedAction {
  type: string;
}

/**
 * A confirmation card is already a server-validated user-visible result, but
 * the chat history still needs a concise textual response when the model
 * emits only a tool call. Keep this deterministic so verifier replans cannot
 * repeat the proposed action just to obtain acknowledgement text.
 */
export function preparedActionAcknowledgement(
  actions: readonly ElainePreparedAction[],
): string | null {
  if (actions.length === 0) return null;
  if (actions.some(({ type }) => type === "queue_research_task")) {
    return "I prepared the background research task. Review and confirm it to start the searches.";
  }
  if (actions.length === 1) {
    return "I prepared the requested action. Review and confirm it to continue.";
  }
  return "I prepared the requested actions. Review and confirm them to continue.";
}

export function completedActionAcknowledgement(
  actions: readonly ElainePreparedAction[],
): string | null {
  if (actions.length === 0) return null;
  if (actions.length === 1 && actions[0]?.type === "remember_household_fact") {
    return "I saved the requested memory.";
  }
  if (actions.length === 1) return "I completed the requested action.";
  return "I completed the requested actions.";
}
