/**
 * Provider status strings may include recipient addresses/numbers in errors.
 * Log a bounded category, never an arbitrary provider-supplied status message.
 */
export function communicationLogOutcome(
  status: string,
): "sent" | "already_complete" | "unknown" | "error" | "skipped" {
  if (status === "sent") return "sent";
  if (status === "already sent" || status === "n/a") return "already_complete";
  if (status.startsWith("unknown:")) return "unknown";
  if (status.startsWith("error:")) return "error";
  return "skipped";
}
