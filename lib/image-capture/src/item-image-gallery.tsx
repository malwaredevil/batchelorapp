import {
  forwardRef,
  useImperativeHandle,
  useState,
  useRef,
  useEffect,
} from "react";
import {
  Camera,
  Upload,
  Pencil,
  Star,
  Trash2,
  Loader2,
  Plus,
  ZoomIn,
  Check,
  X,
} from "lucide-react";
import { cn } from "@workspace/web-core/utils";
import { Input } from "@workspace/ui/input";
import { Button } from "@workspace/ui/button";
import { ImageEditor } from "./image-editor";
import { CameraModal } from "./image-picker";
import { ImageCaptureReview } from "./image-capture-review";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default label suggestions — shared across all collection add/detail pages. */
export const DEFAULT_LABEL_SUGGESTIONS = [
  "Front",
  "Back",
  "Left side",
  "Right side",
  "Top",
  "Bottom",
  "Detail",
  "Maker's mark",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Extract the `v` cache-buster from an image URL (e.g. "/api/.../images/10?v=abc123").
 * Used as the compare-and-swap token for promote-to-primary requests so a
 * retried/duplicated promotion cannot silently swap the images back.
 */
export function extractImageVersion(url: string): string | undefined {
  const match = /[?&]v=([^&#]+)/.exec(url);
  return match ? match[1] : undefined;
}

export interface GalleryImage {
  id: number;
  url: string;
  label?: string | null;
  isPrimary: boolean;
}

export interface ItemImageGalleryProps {
  images: GalleryImage[];
  /** Called after the user finishes editing a new photo. Parent handles the upload. */
  onAddImage: (file: File) => Promise<void>;
  /**
   * @deprecated No longer called — editing an existing image now adds it as a
   * new image so the original is preserved. Pass a no-op if required by the
   * call site; this prop will be removed in a future cleanup.
   */
  onReplaceImage?: (
    imageId: number,
    isPrimary: boolean,
    file: File,
  ) => Promise<void>;
  /** Optional delete handler — pass to show the trash button. */
  onDeleteImage?: (imageId: number, isPrimary: boolean) => void;
  /** Optional promote-to-primary handler — pass to show the star button. */
  onSetPrimary?: (imageId: number) => void;
  /**
   * Optional relabel handler — pass to let the user tag a supplemental photo
   * (e.g. "Front", "Maker's mark"). Shows a labeling panel below the action
   * bar, matching the Pottery module's photo labeler.
   */
  onRelabel?: (imageId: number, label: string | null) => Promise<void> | void;
  /** Override the quick-pick suggestion chips shown in the label editor. */
  labelSuggestions?: string[];
  /** Optional lightbox callback — pass to make the main image click-to-zoom. */
  onZoom?: (url: string, label?: string) => void;
  /** Max total images before the add button disappears. */
  maxImages?: number;
  /** External uploading state (e.g. from a mutation). */
  isUploading?: boolean;
  /**
   * External mutation-in-flight state (set-primary / relabel / delete).
   * Disables all gallery actions while true (like isUploading) but does NOT
   * show the add-tile upload spinner. Pass the OR of your image-mutation
   * pending flags so rapid double-activations can't race (e.g. two
   * set-primary swaps reversing each other).
   */
  isMutating?: boolean;
  className?: string;
  /**
   * Override the main image's aspect/size classes.
   * Default: "aspect-square w-full object-cover"
   * Use to cap height on mobile, e.g. "aspect-[4/3] max-h-[55vh] w-full object-cover"
   */
  mainImageClassName?: string;
}

export interface ItemImageGalleryHandle {
  openFilePicker: () => void;
  openCamera: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ItemImageGallery = forwardRef<
  ItemImageGalleryHandle,
  ItemImageGalleryProps
>(function ItemImageGallery(
  {
    images,
    onAddImage,
    onReplaceImage,
    onDeleteImage,
    onSetPrimary,
    onRelabel,
    labelSuggestions = DEFAULT_LABEL_SUGGESTIONS,
    onZoom,
    maxImages,
    isUploading = false,
    isMutating = false,
    className,
    mainImageClassName,
  },
  ref,
) {
  const [activeIdx, setActiveIdx] = useState(0);

  // ── Add flow ──────────────────────────────────────────────────────────────
  const [showCamera, setShowCamera] = useState(false);
  const [reviewingCameraFile, setReviewingCameraFile] = useState<File | null>(
    null,
  );
  const [pendingAddFile, setPendingAddFile] = useState<File | null>(null);
  const [isSavingAdd, setIsSavingAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Delete confirmation ───────────────────────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    isPrimary: boolean;
  } | null>(null);

  // ── Edit-existing flow ────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<GalleryImage | null>(null);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [isFetchingEdit, setIsFetchingEdit] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // ── Label flow ────────────────────────────────────────────────────────────
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [pendingLabel, setPendingLabel] = useState("");
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  /** Set right after a new photo is added so we jump to it and prompt for a label. */
  const openLabelAfterAddRef = useRef(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const safeIdx = Math.min(activeIdx, Math.max(0, images.length - 1));
  const active = images[safeIdx];
  const canAddMore = maxImages == null || images.length < maxImages;
  const isBusy =
    isFetchingEdit || isSavingEdit || isSavingAdd || isUploading || isMutating;

  useImperativeHandle(
    ref,
    () => ({
      openFilePicker: () => {
        if (canAddMore && !isBusy) fileInputRef.current?.click();
      },
      openCamera: () => {
        if (canAddMore && !isBusy) setShowCamera(true);
      },
    }),
    [canAddMore, isBusy],
  );

  // ── Reset active index when the primary image changes (e.g. after set-primary) ──
  // Keyed on id AND url: some callers use a fixed synthetic id for the primary
  // slot (the backend swaps storage paths in place), so only the URL changes
  // after a promotion.
  const primary = images.find((i) => i.isPrimary);
  const primaryKey = primary ? `${primary.id}:${primary.url}` : undefined;
  const prevPrimaryKeyRef = useRef(primaryKey);
  useEffect(() => {
    if (prevPrimaryKeyRef.current !== primaryKey) {
      prevPrimaryKeyRef.current = primaryKey;
      setActiveIdx(0);
    }
  }, [primaryKey]);

  // ── Jump to a freshly-added photo and open the label picker right away ──────
  const prevImageCountRef = useRef(images.length);
  useEffect(() => {
    if (
      openLabelAfterAddRef.current &&
      images.length > prevImageCountRef.current
    ) {
      openLabelAfterAddRef.current = false;
      setActiveIdx(images.length - 1);
      setPendingLabel("");
      setShowLabelInput(true);
    }
    prevImageCountRef.current = images.length;
  }, [images.length]);

  // ── Camera / file pick for ADD ────────────────────────────────────────────
  function handleCapture(file: File) {
    setShowCamera(false);
    setReviewingCameraFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    setPendingAddFile(file);
  }

  async function handleAddSave(edited: File) {
    setPendingAddFile(null);
    setIsSavingAdd(true);
    if (onRelabel) openLabelAfterAddRef.current = true;
    try {
      await onAddImage(edited);
    } catch (err) {
      openLabelAfterAddRef.current = false;
      throw err;
    } finally {
      setIsSavingAdd(false);
    }
  }

  // ── Label existing ────────────────────────────────────────────────────────
  function openLabelEditor() {
    if (!active) return;
    setPendingLabel(active.label ?? "");
    setShowLabelInput(true);
  }

  async function handleSaveLabel() {
    if (!active || !onRelabel) return;
    setIsSavingLabel(true);
    try {
      await onRelabel(active.id, pendingLabel.trim() || null);
      setShowLabelInput(false);
    } finally {
      setIsSavingLabel(false);
    }
  }

  // ── Edit existing ─────────────────────────────────────────────────────────
  async function handleEditImage(img: GalleryImage) {
    if (isBusy) return;
    setIsFetchingEdit(true);
    setEditTarget(img);
    try {
      const resp = await fetch(img.url, { credentials: "include" });
      if (!resp.ok) throw new Error("fetch failed");
      const blob = await resp.blob();
      const file = new File([blob], "photo.jpg", {
        type: blob.type || "image/jpeg",
      });
      setEditFile(file);
    } catch {
      setEditTarget(null);
    } finally {
      setIsFetchingEdit(false);
    }
  }

  async function handleEditSave(edited: File) {
    setEditFile(null);
    setIsSavingEdit(true);
    try {
      // Add as a new image — original is preserved so the user can set the
      // new one as primary and delete the old one if desired.
      await onAddImage(edited);
    } finally {
      setIsSavingEdit(false);
      setEditTarget(null);
    }
  }

  // Editing applies to every existing image, including the primary image.
  // Keep the action bar visible even when there is no primary/delete action:
  // a tiny overlay icon is too easy to miss on a touch device.
  const showActionBar = !!active;
  const showLabelPanel = !!(active && !active.isPrimary && onRelabel);

  /** Set-primary / delete buttons, or the delete-confirmation strip — shared
   * between the standalone action bar and the merged labeling panel. */
  function ActionButtons() {
    if (!active) return null;
    if (pendingDelete?.id === active.id) {
      return (
        <>
          <span className="text-xs text-muted-foreground">
            Delete this photo?
          </span>
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onDeleteImage!(pendingDelete.id, pendingDelete.isPrimary);
              setPendingDelete(null);
            }}
            className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm transition hover:bg-red-100 disabled:opacity-40 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
            disabled={isBusy}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Confirm delete
          </button>
        </>
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={() => void handleEditImage(active)}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-primary/10 hover:text-primary disabled:opacity-40"
          disabled={isBusy}
        >
          {isFetchingEdit && editTarget?.id === active.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pencil className="h-3.5 w-3.5" />
          )}
          Edit photo
        </button>
        {!active.isPrimary && onSetPrimary && (
          <button
            type="button"
            onClick={() => onSetPrimary(active.id)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-primary/10 hover:text-primary disabled:opacity-40"
            disabled={isBusy}
          >
            <Star className="h-3.5 w-3.5" />
            Set primary
          </button>
        )}
        {onDeleteImage && (
          <button
            type="button"
            onClick={() =>
              setPendingDelete({ id: active.id, isPrimary: active.isPrimary })
            }
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 disabled:opacity-40"
            disabled={isBusy}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        )}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn("space-y-3", className)}>
      {/* Camera / picker overlay for new-photo flow */}
      {showCamera && (
        <CameraModal
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
      {reviewingCameraFile && (
        <ImageCaptureReview
          file={reviewingCameraFile}
          onConfirm={(file) => {
            setReviewingCameraFile(null);
            setPendingAddFile(file);
          }}
          onRetry={() => {
            setReviewingCameraFile(null);
            setShowCamera(true);
          }}
        />
      )}

      {/* Editor for newly captured / picked photo */}
      {pendingAddFile && (
        <ImageEditor
          file={pendingAddFile}
          onSave={handleAddSave}
          onCancel={() => setPendingAddFile(null)}
        />
      )}

      {/* Editor for editing an existing image */}
      {editFile && editTarget && (
        <ImageEditor
          file={editFile}
          onSave={handleEditSave}
          onCancel={() => {
            setEditFile(null);
            setEditTarget(null);
          }}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ── Main image ────────────────────────────────────────────────────── */}
      {active ? (
        <>
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl border border-card-border bg-muted",
              onZoom && "cursor-zoom-in",
            )}
            onClick={() => onZoom?.(active.url, active.label ?? undefined)}
            title={onZoom ? "Click to zoom" : undefined}
          >
            {/* Edit-this-photo — small icon, top-left */}
            <button
              type="button"
              className="absolute left-3 top-3 z-10 rounded-full bg-black/50 p-1.5 text-white transition hover:bg-primary/80 disabled:opacity-40"
              onClick={(e) => {
                e.stopPropagation();
                void handleEditImage(active);
              }}
              disabled={isBusy}
              title="Edit photo"
            >
              {isFetchingEdit && editTarget?.id === active.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="h-4 w-4" />
              )}
            </button>

            <img
              src={active.url}
              alt={active.label ?? "Photo"}
              className={
                mainImageClassName ?? "aspect-square w-full object-cover"
              }
            />

            {/* Label badge on selected supplemental image */}
            {active.label && !active.isPrimary && (
              <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {active.label}
              </span>
            )}

            {/* Zoom hint — top-right, purely visual */}
            {onZoom && (
              <span className="absolute right-3 top-3 rounded-full bg-black/40 p-1.5 text-white backdrop-blur pointer-events-none">
                <ZoomIn className="h-4 w-4" />
              </span>
            )}

            {/* Full-image saving spinner */}
            {isSavingEdit && editTarget?.id === active.id && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            )}
          </div>

          {/* Action bar — explicitly labeled photo management for touch devices. */}
          {showActionBar &&
            (showLabelPanel ? (
              /* Merged into the labeling panel below for supplemental photos */
              <div className="space-y-2 rounded-xl border border-card-border bg-card p-3">
                {showLabelInput ? (
                  <div className="space-y-2">
                    <span className="text-xs text-muted-foreground">
                      Label this photo
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {labelSuggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPendingLabel(s)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition",
                            pendingLabel === s
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-card-border hover:border-primary/30",
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={pendingLabel}
                        onChange={(e) => setPendingLabel(e.target.value)}
                        placeholder="Custom label…"
                        className="h-8 text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={() => void handleSaveLabel()}
                        disabled={isSavingLabel || isBusy}
                      >
                        {isSavingLabel ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowLabelInput(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {active.label ?? "No label"}
                      </span>
                      <button
                        type="button"
                        onClick={openLabelEditor}
                        className="rounded px-2 py-0.5 text-xs text-primary transition hover:bg-primary/10"
                      >
                        Edit label
                      </button>
                    </div>
                    <ActionButtons />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <ActionButtons />
              </div>
            ))}
        </>
      ) : (
        /* ── Empty state — no images yet ─────────────────────────────────── */
        canAddMore && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-muted/30 p-8">
            {isBusy ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Add a photo to get started
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition hover:bg-muted"
                    onClick={() => setShowCamera(true)}
                  >
                    <Camera className="h-4 w-4" /> Camera
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition hover:bg-muted"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" /> Choose File
                  </button>
                </div>
              </>
            )}
          </div>
        )
      )}

      {/* ── Thumbnail strip + add tile ─────────────────────────────────────── */}
      {(images.length > 1 || (images.length >= 1 && canAddMore)) && (
        <div className="flex flex-wrap gap-2 pb-1">
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              className={cn(
                "relative h-20 w-20 shrink-0 snap-start overflow-hidden rounded-lg border-2 transition",
                safeIdx === idx
                  ? "border-primary"
                  : "border-transparent hover:border-muted-foreground/40",
              )}
              onClick={() => setActiveIdx(idx)}
              aria-label={img.isPrimary ? "Primary image" : `Image ${idx + 1}`}
            >
              <img
                src={img.url}
                alt={img.label ?? ""}
                className="h-full w-full object-cover"
              />

              {/* Primary badge */}
              {img.isPrimary && (
                <div className="absolute left-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Star className="h-2.5 w-2.5 fill-current" />
                </div>
              )}
            </button>
          ))}

          {/* Add photo tile */}
          {canAddMore && (
            <div className="relative h-20 w-20 shrink-0 snap-start">
              {isSavingAdd || isUploading ? (
                <div className="flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="group/add flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/50 transition hover:border-primary/50 hover:bg-primary/5">
                  <Plus className="h-4 w-4 text-muted-foreground transition group-hover/add:text-primary" />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground transition hover:text-primary"
                      onClick={() => setShowCamera(true)}
                      title="Take photo"
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground transition hover:text-primary"
                      onClick={() => fileInputRef.current?.click()}
                      title="Choose file"
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
