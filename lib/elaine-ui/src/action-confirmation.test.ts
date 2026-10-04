import { describe, expect, it } from "vitest";
import type { AssistantAction } from "@workspace/api-client-react";
import {
  getActionExecutionBody,
  getActionExecutionBodyWithRepeatAcknowledgement,
  getActionProgressLabel,
  getCommunicationReceiptLabel,
  getActionErrorMessage,
  getRepeatConfirmationDetails,
  isCommunicationActionType,
  removeFirstPendingAction,
  removeSubmittedAction,
  shouldPollCommunicationReceipt,
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

  it("shows channel-specific active progress for confirmed communications", () => {
    expect(
      getActionProgressLabel({
        type: "call_contact",
        payload: {},
        label: "Call Pat",
      }),
    ).toBe("Calling…");
    expect(
      getActionProgressLabel({
        type: "message_contact",
        payload: { channel: "sms" },
        label: "Text Pat",
      }),
    ).toBe("Sending SMS…");
    expect(
      getActionProgressLabel({
        type: "message_contact",
        payload: { channel: "email" },
        label: "Email Pat",
      }),
    ).toBe("Sending email…");
    expect(
      getActionProgressLabel({
        type: "message_contact",
        payload: { channel: "slack" },
        label: "Slack Pat",
      }),
    ).toBe("Sending Slack DM…");
    expect(
      getActionProgressLabel({
        type: "message_contact",
        payload: { channel: "elaine_chat" },
        label: "Message Pat",
      }),
    ).toBe("Sending Elaine message…");
    expect(
      getActionProgressLabel({
        type: "call_me",
        payload: {},
        label: "Call me",
      }),
    ).toBe("Calling…");
    expect(
      getActionProgressLabel({
        type: "continue_in_channel",
        payload: { targetChannel: "slack" },
        label: "Continue on Slack",
      }),
    ).toBe("Sending Slack DM…");
    expect(
      getActionProgressLabel({
        type: "broadcast_message",
        payload: {},
        label: "Broadcast",
      }),
    ).toBe("Sending to connected channels…");
  });

  it("sends the server-issued proposal identity with action approval", () => {
    const proposedAction = {
      type: "message_contact",
      payload: { message: "hello", channel: "sms" },
      label: "Text Pat",
      proposalId: "proposal-token",
      conversationId: 42,
    } as AssistantAction;
    expect(getActionExecutionBody(proposedAction)).toEqual({
      type: "message_contact",
      payload: { message: "hello", channel: "sms" },
      proposalId: "proposal-token",
      conversationId: 42,
    });
  });

  it("acknowledges a repeat only with the same proposal and payload", () => {
    const action: AssistantAction = {
      type: "call_contact",
      payload: { contactId: 7, purpose: "check in" },
      label: "Call Pat",
      proposalId: "proposal-7",
      conversationId: 42,
    };
    expect(
      getActionExecutionBodyWithRepeatAcknowledgement(action, "receipt-9"),
    ).toEqual({
      type: "call_contact",
      payload: { contactId: 7, purpose: "check in" },
      proposalId: "proposal-7",
      conversationId: 42,
      acknowledgeRepeat: "receipt-9",
    });
  });

  it("recognizes the structured repeat-attempt conflict but not generic errors", () => {
    const error = Object.assign(new Error("HTTP 409"), {
      status: 409,
      data: {
        requiresRepeatConfirmation: true,
        receiptId: "receipt-9",
        status: "unknown",
      },
    });
    expect(getRepeatConfirmationDetails(error)).toEqual({
      receiptId: "receipt-9",
      status: "unknown",
    });
    expect(getRepeatConfirmationDetails(new Error("Network error"))).toBeNull();
  });

  it("polls only receipts the server marks as still pending", () => {
    expect(
      shouldPollCommunicationReceipt({ status: "accepted", pending: true }),
    ).toBe(true);
    // A sent message stays "accepted" forever; it must not poll indefinitely.
    expect(
      shouldPollCommunicationReceipt({ status: "accepted", pending: false }),
    ).toBe(false);
    expect(
      shouldPollCommunicationReceipt({ status: "unknown", pending: false }),
    ).toBe(false);
  });

  it("falls back to polling only in-flight sends without a server flag", () => {
    expect(shouldPollCommunicationReceipt({ status: "executing" })).toBe(true);
    for (const status of ["accepted", "unknown", "completed", "failed"]) {
      expect(shouldPollCommunicationReceipt({ status })).toBe(false);
    }
  });

  it("does not equate provider acceptance with message delivery or call outcome", () => {
    expect(
      getCommunicationReceiptLabel("executing", "message_contact", null, "sms"),
    ).toBe("Sending SMS…");
    expect(
      getCommunicationReceiptLabel("executing", "call_contact", null, "voice"),
    ).toBe("Calling…");
    expect(
      getCommunicationReceiptLabel("executing", "call_me", null, "voice"),
    ).toBe("Calling…");
    expect(
      getCommunicationReceiptLabel(
        "executing",
        "continue_in_channel",
        null,
        "email",
      ),
    ).toBe("Sending email…");
    expect(
      getCommunicationReceiptLabel(
        "executing",
        "broadcast_message",
        null,
        "slack",
      ),
    ).toBe("Sending Slack DM…");
    expect(getCommunicationReceiptLabel("accepted", "message_contact")).toBe(
      "Provider accepted; delivery pending",
    );
    expect(getCommunicationReceiptLabel("completed", "message_contact")).toBe(
      "Confirmed completed",
    );
    expect(getCommunicationReceiptLabel("pending", "call_contact")).toBe(
      "Call initiated; outcome pending",
    );
    expect(getCommunicationReceiptLabel("unknown", "call_contact")).toBe(
      "Call status unknown",
    );
    expect(
      getCommunicationReceiptLabel("confirmed_completed", "call_contact"),
    ).toBe("Call ended; answer unknown");
    expect(isCommunicationActionType("call_me")).toBe(true);
    expect(isCommunicationActionType("continue_in_channel")).toBe(true);
    expect(isCommunicationActionType("broadcast_message")).toBe(true);
    expect(isCommunicationActionType("correct_memory")).toBe(false);
  });
});
