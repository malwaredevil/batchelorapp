export interface ElaineModelStreamRecoveryInput {
  canRetry: boolean;
  hasPartialContent: boolean;
  hasSuccessfulObservation: boolean;
}

export interface ElaineModelStreamRecoveryDecision {
  retry: boolean;
  resetPartialContent: boolean;
  suppressTools: boolean;
  instruction: string | null;
}

/**
 * Keeps transient model-stream recovery inside the existing turn budget.
 * Completed tool evidence is reused with tools suppressed so a synthesis
 * failure cannot cause a completed read or consequential action to repeat.
 */
export function decideElaineModelStreamRecovery(
  input: ElaineModelStreamRecoveryInput,
): ElaineModelStreamRecoveryDecision {
  if (!input.canRetry) {
    return {
      retry: false,
      resetPartialContent: false,
      suppressTools: false,
      instruction: null,
    };
  }

  return {
    retry: true,
    resetPartialContent: input.hasPartialContent,
    suppressTools: input.hasSuccessfulObservation,
    instruction: input.hasSuccessfulObservation
      ? "SERVER RECOVERY: The prior response stream failed after tool evidence was received. Use the existing tool results to finish the response. Do not call another tool or repeat an action."
      : "SERVER RECOVERY: The prior response stream failed before the turn completed. Retry the request within the remaining runtime budget. Do not repeat a completed action.",
  };
}
