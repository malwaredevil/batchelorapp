/** Claim one queue slot per capture so fast repeated Retry taps are harmless. */
export function claimCaptureSchedule(
  scheduledIds: Set<string>,
  clientId: string,
): boolean {
  if (scheduledIds.has(clientId)) return false;
  scheduledIds.add(clientId);
  return true;
}

export function releaseCaptureSchedule(
  scheduledIds: Set<string>,
  clientId: string,
) {
  scheduledIds.delete(clientId);
}
