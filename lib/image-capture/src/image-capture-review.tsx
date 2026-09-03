import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, RotateCcw, RotateCw, X } from "lucide-react";
import {
  normalizeCapturedImage,
  rotateImageCounterClockwise,
  rotateImageClockwise,
} from "./image-normalization";
import { ImageEditor } from "./image-editor";

interface ImageCaptureReviewProps {
  file: File;
  onConfirm: (file: File) => void | Promise<void>;
  onRetry: () => void;
  /**
   * When enabled, the review can transition into the shared full editor.
   * Keeping this opt-in preserves the existing picker/gallery flows.
   */
  enableEditing?: boolean;
}

/**
 * Small, touch-first review step shared by camera capture flows.
 * The preview is always backed by the currently accepted pixel file, so a
 * rotation is also the file that gets uploaded and analyzed.
 */
export function ImageCaptureReview({
  file,
  onConfirm,
  onRetry,
  enableEditing = false,
}: ImageCaptureReviewProps) {
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(true);
  const [isRotating, setIsRotating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmedRef = useRef(false);
  const captureGenerationRef = useRef(0);

  useEffect(() => {
    const generation = ++captureGenerationRef.current;
    confirmedRef.current = false;
    setReviewFile(null);
    setIsPreparing(true);
    setIsRotating(false);
    setIsConfirming(false);
    setIsEditing(false);
    setError(null);
    normalizeCapturedImage(file)
      .then((normalized) => {
        if (captureGenerationRef.current === generation) {
          setReviewFile(normalized);
        }
      })
      .catch((err) => {
        if (captureGenerationRef.current === generation) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not read this image. Please try again.",
          );
        }
      })
      .finally(() => {
        if (captureGenerationRef.current === generation) setIsPreparing(false);
      });
  }, [file]);

  useEffect(() => {
    if (!reviewFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(reviewFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reviewFile]);

  async function rotate(direction: "left" | "right") {
    if (!reviewFile || isPreparing || isRotating || isConfirming) return;
    const generation = captureGenerationRef.current;
    setIsRotating(true);
    setError(null);
    try {
      const rotated =
        direction === "left"
          ? await rotateImageCounterClockwise(reviewFile)
          : await rotateImageClockwise(reviewFile);
      if (captureGenerationRef.current === generation) setReviewFile(rotated);
    } catch (err) {
      if (captureGenerationRef.current === generation) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not rotate this image. Please try again.",
        );
      }
    } finally {
      if (captureGenerationRef.current === generation) setIsRotating(false);
    }
  }

  async function confirm() {
    if (
      !reviewFile ||
      isPreparing ||
      isRotating ||
      isConfirming ||
      confirmedRef.current
    ) {
      return;
    }
    const generation = captureGenerationRef.current;
    confirmedRef.current = true;
    setIsConfirming(true);
    try {
      await onConfirm(reviewFile);
    } catch (err) {
      if (captureGenerationRef.current === generation) {
        confirmedRef.current = false;
        setIsConfirming(false);
        setError(
          err instanceof Error ? err.message : "Could not save this photo.",
        );
      }
    }
  }

  function retry() {
    if (isPreparing || isRotating || isConfirming) return;
    captureGenerationRef.current += 1;
    setReviewFile(null);
    onRetry();
  }

  function saveEditedFile(editedFile: File) {
    setReviewFile(editedFile);
    setIsEditing(false);
    setError(null);
  }

  if (isEditing && reviewFile) {
    return (
      <ImageEditor
        file={reviewFile}
        onSave={saveEditedFile}
        onCancel={() => setIsEditing(false)}
        onRetake={() => {
          setIsEditing(false);
          retry();
        }}
        retakeLabel="Retry"
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-review-title"
      data-testid="capture-review"
    >
      <div className="flex items-center justify-center px-4 py-3 text-white">
        <h2 id="capture-review-title" className="text-sm font-semibold">
          Review photo
        </h2>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black px-4">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Captured photo preview"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-white/50" />
        )}
        {error && (
          <div className="absolute inset-x-6 bottom-4 rounded-xl bg-red-950/90 p-4 text-center text-sm text-red-100">
            {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 pb-8 pt-4">
        {enableEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={!reviewFile || isPreparing || isRotating || isConfirming}
            className="col-span-2 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-40"
            data-testid="button-review-edit"
          >
            <Pencil className="h-5 w-5" />
            Edit photo
          </button>
        )}
        <button
          type="button"
          onClick={() => void rotate("left")}
          disabled={!reviewFile || isPreparing || isRotating || isConfirming}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-40"
          data-testid="button-review-rotate-left"
        >
          {isRotating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <RotateCcw className="h-5 w-5" />
          )}
          Rotate left
        </button>
        <button
          type="button"
          onClick={() => void rotate("right")}
          disabled={!reviewFile || isPreparing || isRotating || isConfirming}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-40"
          data-testid="button-review-rotate-right"
        >
          {isRotating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <RotateCw className="h-5 w-5" />
          )}
          Rotate right
        </button>
        <button
          type="button"
          onClick={retry}
          disabled={isPreparing || isRotating || isConfirming}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-40"
          data-testid="button-review-retry"
        >
          <X className="h-5 w-5" />
          Retry
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={!reviewFile || isPreparing || isRotating || isConfirming}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
          data-testid="button-review-ok"
        >
          {isConfirming ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Check className="h-5 w-5" />
          )}
          OK
        </button>
      </div>
    </div>
  );
}
