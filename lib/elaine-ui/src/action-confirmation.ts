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

export function getActionProgressLabel(action: AssistantAction): string {
  if (action.type === "call_contact" || action.type === "call_me") {
    return "Calling…";
  }
  if (
    action.type !== "message_contact" &&
    action.type !== "continue_in_channel" &&
    action.type !== "broadcast_message"
  ) {
    return "Working…";
  }

  const payload = action.payload;
  const channel =
    typeof payload.channel === "string"
      ? payload.channel
      : typeof payload.deliveryChannel === "string"
        ? payload.deliveryChannel
        : typeof payload.targetChannel === "string"
          ? payload.targetChannel
          : undefined;
  if (action.type === "broadcast_message" && !channel) {
    return "Sending to connected channels…";
  }
  switch (channel) {
    case "sms":
      return "Sending SMS…";
    case "email":
      return "Sending email…";
    case "slack":
      return "Sending Slack DM…";
    case "elaine_chat":
      return "Sending Elaine message…";
    default:
      return "Sending message…";
  }
}

export function getActionExecutionBody(action: AssistantAction): {
  type: AssistantAction["type"];
  payload: Record<string, unknown>;
  proposalId?: string;
  conversationId?: number | null;
  acknowledgeRepeat?: string;
} {
  return getActionExecutionBodyForRepeat(action);
}

function getActionExecutionBodyForRepeat(
  action: AssistantAction,
  acknowledgeRepeat?: string,
): {
  type: AssistantAction["type"];
  payload: Record<string, unknown>;
  proposalId?: string;
  conversationId?: number | null;
  acknowledgeRepeat?: string;
} {
  const proposed = action as AssistantAction & {
    proposalId?: string;
    conversationId?: number | null;
  };
  return {
    type: action.type,
    payload: action.payload,
    ...(proposed.proposalId ? { proposalId: proposed.proposalId } : {}),
    ...(proposed.conversationId !== undefined
      ? { conversationId: proposed.conversationId }
      : {}),
    ...(acknowledgeRepeat ? { acknowledgeRepeat } : {}),
  };
}

export function getActionExecutionBodyWithRepeatAcknowledgement(
  action: AssistantAction,
  receiptId: string,
) {
  return getActionExecutionBodyForRepeat(action, receiptId);
}

export interface RepeatConfirmationDetails {
  receiptId: string;
  status: string;
}

const RECEIPT_STATUSES_TO_POLL = new Set([
  "executing",
  "accepted",
  "provider_accepted",
  "provider_accepted_outcome_pending",
  "provider_accepted_pending",
  "unknown",
  "unknown_after_ambiguous_response",
  "pending",
]);

export function shouldPollCommunicationReceipt(status: string): boolean {
  return RECEIPT_STATUSES_TO_POLL.has(status);
}

/** Reads the structured safety conflict without exposing provider details. */
export function getRepeatConfirmationDetails(
  value: unknown,
): RepeatConfirmationDetails | null {
  const queue: unknown[] = [value];
  const visited = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (
      record.requiresRepeatConfirmation === true &&
      typeof record.receiptId === "string" &&
      record.receiptId.length > 0
    ) {
      return {
        receiptId: record.receiptId,
        status: typeof record.status === "string" ? record.status : "unknown",
      };
    }
    queue.push(record.data, record.result, record.body, record.error);
    if (typeof record.error === "string") {
      try {
        queue.push(JSON.parse(record.error) as unknown);
      } catch {
        // Error text is intentionally not interpreted unless it is JSON.
      }
    }
  }
  return null;
}

export function repeatConfirmationPrompt(action: AssistantAction): string {
  return action.type === "call_contact" || action.type === "call_me"
    ? "Confirm another call"
    : "Confirm another message";
}

export function getCommunicationReceiptLabel(
  status: string,
  actionType: string,
  callStatus?: string | null,
  channel?: string | null,
): string {
  if (status === "executing") {
    if (actionType === "call_contact" || actionType === "call_me") {
      return "Calling…";
    }
    switch (channel) {
      case "sms":
        return "Sending SMS…";
      case "email":
        return "Sending email…";
      case "slack":
        return "Sending Slack DM…";
      case "elaine_chat":
        return "Sending Elaine message…";
      default:
        return "Sending message…";
    }
  }
  if (actionType === "call_contact" || actionType === "call_me") {
    if (status === "scheduled") return "Scheduled";
    if (status === "cancelled") return "Cancelled before calling";
    if (callStatus === "ended" || callStatus === "call_ended") {
      return "Call ended; answer unknown";
    }
    if (status === "failed_before_acceptance" || status === "failed")
      return "Call failed";
    if (status === "unknown") return "Call status unknown";
    if (status === "confirmed_completed" || status === "completed") {
      return "Call ended; answer unknown";
    }
    return "Call initiated; outcome pending";
  }

  switch (status) {
    case "executing":
      return "Working…";
    case "provider_accepted":
    case "provider_accepted_outcome_pending":
    case "provider_accepted_pending":
    case "accepted":
    case "pending":
      return "Provider accepted; delivery pending";
    case "confirmed_completed":
    case "completed":
      return "Confirmed completed";
    case "failed_before_acceptance":
    case "failed":
      return "Failed";
    case "unknown":
    case "unknown_after_ambiguous_response":
      return "Status unknown";
    case "scheduled":
      return "Scheduled";
    case "cancelled":
      return "Cancelled before sending";
    default:
      return "Execution status not confirmed";
  }
}

export function isCommunicationActionType(actionType: string): boolean {
  return (
    actionType === "call_contact" ||
    actionType === "call_me" ||
    actionType === "message_contact" ||
    actionType === "continue_in_channel" ||
    actionType === "broadcast_message"
  );
}

export function isCallActionType(actionType: string): boolean {
  return actionType === "call_contact" || actionType === "call_me";
}
