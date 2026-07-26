import { useState, useRef, useEffect } from "react";
import {
  Camera,
  Upload,
  Pencil,
  Star,
  Trash2,
  Loader2,
  Plus,
  ZoomIn,
} from "lucide-react";
import { cn } from "@workspace/web-core/utils";
import { ImageEditor } from "./image-editor";
import { CameraModal } from "./image-picker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** Optional lightbox callback — pass to make the main image click-to-zoom. */
  onZoom?: (url: string, label?: string) => void;
  /** Max total images before the add button disappears. */
  maxImages?: number;
  /** External uploading state (e.g. from a mutation). */
  isUploading?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ItemImageGallery({
  images,
  onAddImage,
  onReplaceImage,
  onDeleteImage,
  onSetPrimary,
  onZoom,
  maxImages,
  isUploading = false,
  className,
}: ItemImageGalleryProps) {
  const [activeIdx, setActiveIdx] = useState(0);

  // ── Add flow ──────────────────────────────────────────────────────────────
  const [showCamera, setShowCamera] = useState(false);
  const [pendingAddFile, setPendingAddFile] = useState<File | null>(null);
  const [isSavingAdd, setIsSavingAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Edit-existing flow ────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<GalleryImage | null>(null);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [isFetchingEdit, setIsFetchingEdit] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const safeIdx = Math.min(activeIdx, Math.max(0, images.length - 1));
  const active = images[safeIdx];
  const canAddMore = maxImages == null || images.length < maxImages;
  const isBusy = isFetchingEdit || isSavingEdit || isSavingAdd || isUploading;

  // ── Reset active index when the primary image changes (e.g. after set-primary) ──
  const primaryId = images.find((i) => i.isPrimary)?.id;
  const prevPrimaryIdRef = useRef(primaryId);
  useEffect(() => {
    if (prevPrimaryIdRef.current !== primaryId) {
      prevPrimaryIdRef.current = primaryId;
      setActiveIdx(0);
    }
  }, [primaryId]);

  // ── Camera / file pick for ADD ────────────────────────────────────────────
  function handleCapture(file: File) {
    setShowCamera(false);
    setPendingAddFile(file);
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
    try {
      await onAddImage(edited);
    } finally {
      setIsSavingAdd(false);
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
              className="aspect-square w-full object-cover"
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

          {/* Action bar — Set Primary + Delete (Edit is now on the image icon) */}
          {((!active.isPrimary && onSetPrimary) || onDeleteImage) && (
            <div className="flex items-center justify-center gap-2">
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
                  onClick={() => onDeleteImage(active.id, active.isPrimary)}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 disabled:opacity-40"
                  disabled={isBusy}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
            </div>
          )}
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
        <div className="flex gap-2 overflow-x-auto pb-1 snap-x">
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
}
