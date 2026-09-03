import { Check, Loader2 } from "lucide-react";

export type PhotoRecognitionStatusValue = "pending" | "complete" | null;

export interface PhotoRecognitionStatusProps {
  status?: PhotoRecognitionStatusValue;
}

export function getPhotoRecognitionRefetchInterval(
  status?: PhotoRecognitionStatusValue,
): number | false {
  // Keep polling during the short completion acknowledgement as well. The
  // server expires it, and this next response clears the non-blocking notice
  // from an already-open detail page.
  return status ? 1_000 : false;
}

export function PhotoRecognitionStatus({
  status,
}: PhotoRecognitionStatusProps) {
  if (!status) return null;

  return (
    <div
      className={
        status === "pending"
          ? "flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
          : "flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
      }
      role="status"
      aria-live="polite"
      data-testid="photo-recognition-status"
      data-status={status}
    >
      {status === "pending" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>
        {status === "pending"
          ? "Photo recognition refresh pending"
          : "Photo recognition refreshed"}
      </span>
    </div>
  );
}
