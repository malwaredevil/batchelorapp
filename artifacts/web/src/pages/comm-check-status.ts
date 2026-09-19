export type CommStatus =
  | "pending"
  | "sending"
  | "sent"
  | "error"
  | "verified"
  | "indeterminate";

/**
 * Keep the phone lane's outcome distinct from a successful call placement.
 * In particular, an indeterminate call must never be presented as verified.
 */
export function formatCommStatus(
  status: CommStatus,
  treatSentAsVerified = false,
): string {
  if (status === "indeterminate") {
    return treatSentAsVerified ? "Call acceptance unknown" : "Outcome unknown";
  }
  if (status === "verified" || (treatSentAsVerified && status === "sent")) {
    return "Verified";
  }
  if (status === "sent") {
    return "Sent — awaiting reply";
  }
  if (status === "sending") {
    return "Sending";
  }
  if (status === "error") {
    return "Error";
  }
  return "Pending";
}
