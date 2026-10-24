import { formatScheduledContactTime } from "../../lib/scheduled-time-display";
import { callPreflightUserMessage } from "../call-preflight";

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

/**
 * Ground an auto-run reply in saved executor evidence, even if the model
 * already streamed "I'll schedule…". Never repeat an action to get an answer.
 */
export function executedCommunicationAcknowledgement(
  actions: readonly { type: string; status: number; result?: unknown }[],
  userTimezone: string,
): string | null {
  const notes: string[] = [];
  for (const action of actions) {
    if (action.status < 200 || action.status >= 300) {
      if (action.type === "call_me" || action.type === "call_contact") {
        const message = callPreflightUserMessage(action.result);
        if (message) notes.push(message);
      }
      continue;
    }
    const noun =
      action.type === "call_me" || action.type === "call_contact"
        ? "call"
        : action.type === "message_contact"
          ? "message"
          : null;
    if (!noun || !action.result || typeof action.result !== "object") continue;
    const outer = action.result as Record<string, unknown>;
    if (!outer.result || typeof outer.result !== "object") continue;
    const result = outer.result as Record<string, unknown>;
    const ids = result.scheduledActionIds ?? [result.scheduledActionId];
    if (
      result.scheduled === true &&
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every(
        (id) => typeof id === "number" && Number.isInteger(id) && id > 0,
      ) &&
      typeof result.scheduledFor === "string" &&
      Number.isFinite(Date.parse(result.scheduledFor))
    ) {
      const timezone =
        typeof result.timezone === "string" ? result.timezone : userTimezone;
      try {
        notes.push(
          `Confirmed: your ${noun} is scheduled for ${formatScheduledContactTime(result.scheduledFor, timezone)}.`,
        );
      } catch {
        notes.push(
          `Confirmed: your ${noun} is scheduled for ${new Date(result.scheduledFor).toISOString()} (UTC).`,
        );
      }
    } else if (result.scheduled === true) {
      notes.push(
        "I couldn't confirm the saved schedule details from the server's response. I haven't repeated the request.",
      );
    } else if (
      result.scheduled !== true &&
      result.receiptStatus === "accepted"
    ) {
      notes.push(
        `The provider accepted your ${noun} request. ${noun === "message" ? "Delivery" : "An answered call"} is not yet confirmed.`,
      );
    }
  }
  return notes.length ? [...new Set(notes)].join("\n") : null;
}
