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

export function formatCommChannelFailure(result: {
  error?: string;
  result?: string;
}): string {
  return result.error ?? result.result ?? "Failed";
}

export type CommRunNotice = {
  kind: "success" | "neutral" | "error";
  title: string;
  description: string;
};

function isErrorCommResult(result: string | undefined): boolean {
  return result?.startsWith("error:") ?? false;
}

function laneDetail(label: string, result: string | undefined): string {
  return `${label}: ${result ?? "unknown"}`;
}

/**
 * Classify the complete daily run before presenting a notice. A phone outcome
 * is independent from the three daily lanes: an unknown phone outcome is
 * neutral only when those lanes all succeeded, and must not hide their errors.
 */
export function formatCommRunNotice(results: {
  email?: string;
  sms?: string;
  slack?: string;
  phone?: string;
}): CommRunNotice {
  const daily = [
    laneDetail("Email", results.email),
    laneDetail("SMS", results.sms),
    laneDetail("Slack", results.slack),
  ];
  const dailyResults = [results.email, results.sms, results.slack];
  const failedDaily = dailyResults
    .map((result, index) => (isErrorCommResult(result) ? daily[index] : null))
    .filter((detail): detail is string => detail !== null);

  if (failedDaily.length > 0 || isErrorCommResult(results.phone)) {
    const phoneDetail = isIndeterminateCommResult(results.phone)
      ? formatIndeterminateCommResult(results.phone)
      : laneDetail("Phone", results.phone);
    return {
      kind: "error",
      title: "Comms check partially failed",
      description: [...failedDaily, phoneDetail].join("; "),
    };
  }

  if (isIndeterminateCommResult(results.phone)) {
    return {
      kind: "neutral",
      title: "Phone call outcome unknown",
      description: formatIndeterminateCommResult(results.phone),
    };
  }

  return {
    kind: "success",
    title: "All comms checks sent",
    description: `Sent — ${daily.join(", ")}, ${laneDetail("Phone", results.phone)}`,
  };
}
