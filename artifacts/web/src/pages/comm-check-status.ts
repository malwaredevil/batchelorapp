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

/** The API uses a successful HTTP response with an `unknown:` result when the
 * call was sent but its acceptance outcome could not be confirmed. */
export function isIndeterminateCommResult(result: string | undefined): boolean {
  return result?.startsWith("unknown:") ?? false;
}

export function formatIndeterminateCommResult(result?: string): string {
  const detail = result?.slice("unknown:".length).trim();
  return detail
    ? `Phone call outcome unknown — ${detail}`
    : "Phone call outcome unknown";
}
