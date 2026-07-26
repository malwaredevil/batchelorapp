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
  /** Called after the user finishes editing an existing image. Parent does the PUT. */
  onReplaceImage: (
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
    if (!editTarget) return;
    setEditFile(null);
    setIsSavingEdit(true);
    try {
      await onReplaceImage(editTarget.id, editTarget.isPrimary, edited);
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
              "group relative aspect-square w-full overflow-hidden rounded-2xl border border-card-border bg-muted",
              onZoom && "cursor-zoom-in",
            )}
            onClick={() => onZoom?.(active.url, active.label ?? undefined)}
          >
            <img
              src={active.url}
              alt={active.label ?? "Photo"}
              className="h-full w-full object-cover"
            />

            {/* Desktop hover overlay — purely decorative on touch devices.
                All buttons use pointer-events-none + group-hover:pointer-events-auto
                so they cannot swallow taps on mobile when invisible. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 bg-black/50 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              {onZoom && (
                <button
                  type="button"
                  className="pointer-events-none flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/30 group-hover:pointer-events-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onZoom(active.url, active.label ?? undefined);
                  }}
                >
                  <ZoomIn className="h-4 w-4" /> View
                </button>
              )}
              <button
                type="button"
                className="pointer-events-none flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/30 disabled:opacity-40 group-hover:pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleEditImage(active);
                }}
                disabled={isBusy}
              >
                {isFetchingEdit && editTarget?.id === active.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                Edit
              </button>
            </div>

            {/* Full-image saving spinner */}
            {isSavingEdit && editTarget?.id === active.id && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            )}
          </div>

          {/* ── Persistent action bar — visible on all screen sizes ──────── */}
          <div className="flex items-center justify-center gap-2">
            {onZoom && (
              <button
                type="button"
                onClick={() => onZoom(active.url, active.label ?? undefined)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={isBusy}
              >
                <ZoomIn className="h-3.5 w-3.5" />
                View
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleEditImage(active)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground disabled:opacity-40"
              disabled={isBusy}
            >
              {isFetchingEdit && editTarget?.id === active.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
              Edit
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
                onClick={() => onDeleteImage(active.id, active.isPrimary)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 disabled:opacity-40"
                disabled={isBusy}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>
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
