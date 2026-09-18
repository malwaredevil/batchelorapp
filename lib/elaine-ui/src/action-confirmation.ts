import type { AssistantAction } from "@workspace/api-client-react";

/** Prefer the server's structured safe error over transport fallbacks. */
export function getActionErrorMessage(error: unknown): string {
  const structuredError =
    error &&
    typeof error === "object" &&
    "data" in error &&
    (error as { data?: unknown }).data &&
    typeof (error as { data: unknown }).data === "object"
      ? (error as { data: { error?: unknown } }).data.error
      : undefined;
  if (typeof structuredError === "string") return structuredError;

  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "");
  try {
    const parsed = JSON.parse(rawMessage) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // customFetch may already have reduced the response to plain text.
  }
  return rawMessage;
}

export function removeFirstPendingAction(
  actions: AssistantAction[],
): AssistantAction[] {
  return actions.slice(1);
}
