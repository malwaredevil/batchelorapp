/**
 * Build the user-facing correction for actions that were dropped during
 * auto-run. Executor response bodies are deliberately not accepted here:
 * they can contain provider, storage, or database implementation details.
 */
export function buildAutoRunActionFailureCorrection(params: {
  droppedActionCount: number;
  executorFailureCount: number;
  repeatConfirmationCount?: number;
}): string | null {
  const {
    droppedActionCount,
    executorFailureCount,
    repeatConfirmationCount = 0,
  } = params;
  if (droppedActionCount <= 0) return null;

  if (repeatConfirmationCount > 0) {
    return repeatConfirmationCount === 1
      ? "I haven't made another attempt because a recent receipt shows the earlier attempt may already have reached the recipient. I've prepared this repeat for your explicit confirmation."
      : "I haven't made those repeat attempts because recent receipts show earlier attempts may already have reached the recipients. I've prepared the repeats for your explicit confirmation.";
  }

  if (executorFailureCount > 0) {
    return droppedActionCount === 1
      ? "I couldn't complete that action just now. Please try again in a moment."
      : "I couldn't complete some of those actions just now. Please try again in a moment.";
  }

  return droppedActionCount === 1
    ? "I wasn't actually able to prepare that as a confirmable action just now — nothing was scheduled or changed. Please try again in a moment."
    : "I wasn't actually able to prepare some of those as confirmable actions just now — nothing was scheduled or changed for them. Please try again in a moment.";
}
