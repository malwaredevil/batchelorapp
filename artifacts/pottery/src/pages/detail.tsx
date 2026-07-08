import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPottery,
  useListPottery,
  useUpdatePottery,
  useDeletePottery,
  useReanalyzePottery,
  useSetPrimaryImage,
  useListPotteryCategories as useListCategories,
  getListPotteryQueryKey,
  getGetCollectionStatsQueryKey,
  getGetPotteryQueryKey,
} from "@workspace/api-client-react";
import type {
  PotteryCategory as Category,
  PotteryPotteryImage as PotteryImage,
  PotteryPotteryItem as PotteryItem,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  Check,
  ImagePlus,
  Lock,
  LockOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AutocompleteInput } from "@/components/autocomplete-input";
import { TagSelector } from "@/components/tag-selector";
import { CameraModal } from "@/components/image-picker";
import { ImageEditor } from "@/components/image-editor";
import { useUploadPotteryImage } from "@/hooks/use-pottery";
import {
  useUpdatePotteryImage,
  useDeletePotteryImage,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LABEL_SUGGESTIONS = [
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
// Edit-field helpers
// ---------------------------------------------------------------------------

function EditField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {multiline ? (
        <Textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  locked,
  onToggleLock,
}: {
  label: string;
  value?: string | null;
  locked?: boolean;
  onToggleLock?: () => void;
}) {
  if (!value) return null;
  return (
    <div className="group flex flex-col gap-0.5 border-b border-card-border py-2.5 last:border-0 sm:flex-row sm:gap-4">
      <span className="flex w-36 shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground">
        <span className="flex-1">{label}</span>
        {onToggleLock && (
          <button
            type="button"
            onClick={onToggleLock}
            title={
              locked
                ? "Locked — AI re-analysis won't change this. Click to unlock."
                : "Click to lock — AI re-analysis won't overwrite this field."
            }
            className={cn(
              "rounded p-0.5 transition",
              locked
                ? "text-red-500 hover:text-red-600"
                : "text-green-500/60 hover:text-green-600",
            )}
          >
            {locked ? (
              <Lock className="h-3 w-3" />
            ) : (
              <LockOpen className="h-3 w-3" />
            )}
          </button>
        )}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image gallery
// ---------------------------------------------------------------------------

interface GalleryProps {
  primaryUrl: string;
  primaryAlt: string;
  supplemental: PotteryImage[];
  itemId: number;
}

function ImageGallery({
  primaryUrl,
  primaryAlt,
  supplemental,
  itemId,
}: GalleryProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const uploadImage = useUploadPotteryImage(itemId);
  const removeImage = useDeletePotteryImage();
  const relabelImage = useUpdatePotteryImage();
  const promotePrimary = useSetPrimaryImage();

  const [pendingLabel, setPendingLabel] = useState<string>("");
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [editingFile, setEditingFile] = useState<File | null>(null);

  // All images: index 0 = primary
  const allImages = [{ url: primaryUrl, label: null, id: -1 }, ...supplemental];
  const selected = allImages[activeIdx] ?? allImages[0];
  const isSupplemental = activeIdx > 0;
  const selectedSupplemental = isSupplemental
    ? supplemental[activeIdx - 1]
    : null;

  // When image count changes: keep index in bounds, and if a fresh upload just
  // completed jump to the new image and open the label picker right away.
  useEffect(() => {
    const lastIdx = allImages.length - 1;
    if (openLabelAfterUpload.current && allImages.length > 1) {
      openLabelAfterUpload.current = false;
      setActiveIdx(lastIdx);
      setPendingLabel("");
      setShowLabelInput(true);
    } else {
      setActiveIdx((prev) => Math.min(prev, lastIdx));
    }
  }, [allImages.length]);

  function handleCapture(captured: File) {
    setShowCamera(false);
    setEditingFile(captured);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (file) setEditingFile(file);
  }

  const openLabelAfterUpload = useRef(false);

  function handleEditorSave(edited: File) {
    setEditingFile(null);
    openLabelAfterUpload.current = true;
    uploadImage.mutate(
      { image: edited },
      {
        onError: (err) => {
          openLabelAfterUpload.current = false;
          toast.error(err.message);
        },
      },
    );
  }

  function handleRemove() {
    if (!selectedSupplemental) return;
    removeImage.mutate(
      { id: itemId, imageId: selectedSupplemental.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetPotteryQueryKey(itemId),
          });
          setActiveIdx(Math.max(0, activeIdx - 1));
          toast.success("Photo removed.");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleSetPrimary() {
    if (!selectedSupplemental) return;
    const toastId = toast.loading("Promoting to primary and re-analysing…");
    promotePrimary.mutate(
      { id: itemId, data: { imageId: selectedSupplemental.id } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetPotteryQueryKey(itemId), updated);
          queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
          setActiveIdx(0);
          toast.success("Photo promoted to primary.", { id: toastId });
        },
        onError: (err) => toast.error(err.message, { id: toastId }),
      },
    );
  }

  function handleSaveLabel() {
    if (!selectedSupplemental) return;
    relabelImage.mutate(
      {
        id: itemId,
        imageId: selectedSupplemental.id,
        data: { label: pendingLabel.trim() || null },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetPotteryQueryKey(itemId),
          });
          setShowLabelInput(false);
          toast.success("Label saved.");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function openLabelEditor() {
    setPendingLabel(selectedSupplemental?.label ?? "");
    setShowLabelInput(true);
  }

  return (
    <div className="space-y-3">
      {showCamera && (
        <CameraModal
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
      {editingFile && (
        <ImageEditor
          file={editingFile}
          onSave={handleEditorSave}
          onCancel={() => setEditingFile(null)}
        />
      )}

      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt={lightboxAlt}
          onClose={() => setLightboxSrc(null)}
        />
      )}

      {/* Main image display */}
      <div
        className="relative overflow-hidden rounded-2xl border border-card-border bg-muted cursor-zoom-in"
        onClick={() => {
          setLightboxSrc(selected.url);
          setLightboxAlt(
            isSupplemental
              ? (selectedSupplemental?.label ?? "Photo")
              : primaryAlt,
          );
        }}
        title="Click to zoom"
      >
        <img
          src={selected.url}
          alt={
            isSupplemental
              ? (selectedSupplemental?.label ?? "Photo")
              : primaryAlt
          }
          className="aspect-square w-full object-cover"
        />
        {/* Label badge on selected supplemental image */}
        {isSupplemental && selectedSupplemental?.label && (
          <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
            {selectedSupplemental.label}
          </span>
        )}
        <span className="absolute right-3 top-3 rounded-full bg-black/40 p-1.5 text-white backdrop-blur">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0zm0 0l2 2"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 8v6m-3-3h6"
            />
          </svg>
        </span>
      </div>

      {/* Thumbnail row */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {allImages.map((img, idx) => (
          <button
            key={img.id}
            type="button"
            onClick={() => {
              setActiveIdx(idx);
              setShowLabelInput(false);
            }}
            className={cn(
              "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition",
              activeIdx === idx
                ? "border-primary ring-2 ring-primary/30"
                : "border-card-border hover:border-primary/40",
            )}
          >
            <img
              src={img.url}
              alt={img.label ?? (idx === 0 ? "Primary" : "Photo")}
              className="h-full w-full object-cover"
            />
            {idx === 0 && (
              <span className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center text-[9px] text-white">
                Primary
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Add photo buttons — always visible below the thumbnail row */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          disabled={uploadImage.isPending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-card-border py-2.5 text-sm text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-50"
          aria-label="Take a photo"
        >
          {uploadImage.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          <span>Take photo</span>
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadImage.isPending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-card-border py-2.5 text-sm text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-50"
          aria-label="Upload from gallery"
        >
          <ImagePlus className="h-4 w-4" />
          <span>Upload photo</span>
        </button>
      </div>

      {/* Controls for selected supplemental image */}
      {isSupplemental && selectedSupplemental && (
        <div className="space-y-2 rounded-xl border border-card-border bg-card p-3">
          {showLabelInput ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Label this photo
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {LABEL_SUGGESTIONS.map((s) => (
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
                  onClick={handleSaveLabel}
                  disabled={relabelImage.isPending}
                >
                  {relabelImage.isPending ? (
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedSupplemental.label ?? "No label"}
                </span>
                <button
                  type="button"
                  onClick={openLabelEditor}
                  className="rounded px-2 py-0.5 text-xs text-primary hover:bg-primary/10 transition"
                >
                  Edit label
                </button>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSetPrimary}
                  disabled={promotePrimary.isPending}
                  title="Promote to primary and re-analyse"
                >
                  {promotePrimary.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Star className="h-4 w-4" />
                  )}
                  Make primary
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this photo?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This photo will be permanently deleted.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRemove}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image lightbox (fullscreen zoom + pan)
// ---------------------------------------------------------------------------

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const live = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    pinchStartDist: 0,
    pinchStartScale: 1,
    dragStartX: 0,
    dragStartY: 0,
    dragStartTx: 0,
    dragStartTy: 0,
  });
  const [display, setDisplay] = useState({ scale: 1, tx: 0, ty: 0 });

  function applyTransform(scale: number, tx: number, ty: number) {
    const maxPan = Math.max(0, (scale - 1) * 600);
    const cx = Math.max(-maxPan, Math.min(maxPan, tx));
    const cy = Math.max(-maxPan, Math.min(maxPan, ty));
    live.current.scale = scale;
    live.current.tx = cx;
    live.current.ty = cy;
    setDisplay({ scale, tx: cx, ty: cy });
  }

  function resetZoom() {
    applyTransform(1, 0, 0);
  }

  useEffect(() => {
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.88;
      const newScale = Math.max(1, Math.min(10, live.current.scale * factor));
      applyTransform(newScale, live.current.tx, live.current.ty);
    }
    const el = containerRef.current;
    if (el) el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (el) el.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onPointerDown(e: React.PointerEvent) {
    live.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (live.current.pointers.size === 1) {
      live.current.dragStartX = e.clientX;
      live.current.dragStartY = e.clientY;
      live.current.dragStartTx = live.current.tx;
      live.current.dragStartTy = live.current.ty;
    } else if (live.current.pointers.size === 2) {
      const pts = Array.from(live.current.pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      live.current.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
      live.current.pinchStartScale = live.current.scale;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    live.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (live.current.pointers.size === 2) {
      const pts = Array.from(live.current.pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const newScale = Math.max(
        1,
        Math.min(
          10,
          live.current.pinchStartScale * (dist / live.current.pinchStartDist),
        ),
      );
      applyTransform(newScale, live.current.tx, live.current.ty);
    } else if (live.current.pointers.size === 1 && live.current.scale > 1) {
      const tx =
        live.current.dragStartTx + (e.clientX - live.current.dragStartX);
      const ty =
        live.current.dragStartTy + (e.clientY - live.current.dragStartY);
      applyTransform(live.current.scale, tx, ty);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    live.current.pointers.delete(e.pointerId);
    if (live.current.pointers.size === 1) {
      const pt = live.current.pointers.values().next().value!;
      live.current.dragStartX = pt.x;
      live.current.dragStartY = pt.y;
      live.current.dragStartTx = live.current.tx;
      live.current.dragStartTy = live.current.ty;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          resetZoom();
          onClose();
        }
      }}
    >
      <button
        type="button"
        onClick={() => {
          resetZoom();
          onClose();
        }}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/25"
      >
        <X className="h-6 w-6" />
      </button>
      {display.scale > 1 && (
        <button
          type="button"
          onClick={resetZoom}
          className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/15 px-4 py-2 text-sm text-white transition hover:bg-white/30"
        >
          Reset zoom
        </button>
      )}
      <div
        ref={containerRef}
        className="touch-none select-none"
        style={{ cursor: display.scale > 1 ? "grab" : "zoom-in" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          if (live.current.scale > 1) resetZoom();
          else applyTransform(2.5, 0, 0);
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          style={{
            transform: `translate(${display.tx}px, ${display.ty}px) scale(${display.scale})`,
            transformOrigin: "center",
            transition:
              display.scale === 1 ? "transform 0.15s ease-out" : "none",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function PieceDetail() {
  const [, params] = useRoute("/piece/:id");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const id = Number(params?.id);

  const {
    data: item,
    isLoading,
    isError,
  } = useGetPottery(id, {
    query: {
      enabled: Number.isFinite(id),
      queryKey: getGetPotteryQueryKey(id),
    },
  });
  const { data: allCategories = [] } = useListCategories();
  const { data: allItems = [] } = useListPottery();

  const fieldSuggestions = useMemo(() => {
    const unique = (fn: (i: PotteryItem) => string | null | undefined) => {
      const seen = new Set<string>();
      for (const i of allItems) {
        const v = fn(i);
        if (v?.trim()) seen.add(v.trim());
      }
      return Array.from(seen).sort((a, b) => a.localeCompare(b));
    };
    return {
      maker: unique((i) => i.maker),
    };
  }, [allItems]);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [maker, setMaker] = useState("");
  const [makerInfo, setMakerInfo] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setQuantity(item.quantity ?? 1);
      setNotes(item.notes ?? "");
      setAcquiredAt(item.acquiredAt ?? "");
      setAiDescription(item.aiDescription ?? "");
      setMaker(item.maker ?? "");
      setMakerInfo(item.makerInfo ?? "");
      setDimensions(item.dimensions ?? "");
      setSelectedCategoryIds(item.categories.map((c) => c.id));
    }
  }, [item]);

  function cancelEdit() {
    if (!item) return;
    setEditing(false);
    setName(item.name);
    setQuantity(item.quantity ?? 1);
    setNotes(item.notes ?? "");
    setAcquiredAt(item.acquiredAt ?? "");
    setAiDescription(item.aiDescription ?? "");
    setMaker(item.maker ?? "");
    setMakerInfo(item.makerInfo ?? "");
    setDimensions(item.dimensions ?? "");
    setSelectedCategoryIds(item.categories.map((c) => c.id));
  }

  function toggleCategory(catId: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId],
    );
  }

  const reanalyze = useReanalyzePottery({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetPotteryQueryKey(id), updated);
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
        toast.success("AI analysis refreshed.");
      },
      onError: () => toast.error("Re-analysis failed. Please try again."),
    },
  });

  const update = useUpdatePottery({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPotteryQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
        setEditing(false);
        toast.success("Saved.");
      },
      onError: () => toast.error("Could not save changes."),
    },
  });

  function toggleFieldLock(field: string) {
    if (!item) return;
    const current = item.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((f) => f !== field)
      : [...current, field];
    update.mutate({ id, data: { lockedFields: next } });
  }

  const remove = useDeletePottery({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetCollectionStatsQueryKey(),
        });
        toast.success("Piece removed.");
        navigate("/");
      },
      onError: () => toast.error("Could not delete this piece."),
    },
  });

  function save() {
    if (!name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    update.mutate({
      id,
      data: {
        name: name.trim(),
        quantity,
        notes: notes.trim() || null,
        acquiredAt: acquiredAt || null,
        aiDescription: aiDescription.trim() || null,
        maker: maker.trim() || null,
        makerInfo: makerInfo.trim() || null,
        dimensions: dimensions.trim() || null,
        categoryIds: selectedCategoryIds,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Loading / error
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-9 w-24" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-2xl" />
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="mx-auto max-w-3xl text-center">
        <p className="py-10 text-sm text-muted-foreground">
          This piece could not be found.
        </p>
        <Button asChild variant="outline">
          <Link href="/">Back to collection</Link>
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl">
      {/* Back nav */}
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={() => navigate("/")}
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4" />
        Collection
      </Button>

      {/* Hero */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Image gallery */}
        <div className="space-y-4">
          <ImageGallery
            primaryUrl={item.imageUrl}
            primaryAlt={item.name}
            supplemental={item.images}
            itemId={id}
          />
        </div>

        {/* Info + actions */}
        <div className="flex flex-col gap-4">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            {editing ? (
              <div className="flex-1">
                <Label
                  htmlFor="edit-name"
                  className="text-xs text-muted-foreground"
                >
                  Name
                </Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1"
                  data-testid="input-edit-name"
                />
              </div>
            ) : (
              <h1
                className="text-2xl font-bold tracking-tight leading-tight"
                data-testid="text-detail-name"
              >
                {item.name}
              </h1>
            )}

            {!editing && (
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => reanalyze.mutate({ id })}
                  disabled={reanalyze.isPending}
                  title="Re-run AI analysis"
                  data-testid="button-reanalyze"
                >
                  {reanalyze.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => toggleFieldLock("name")}
                  disabled={update.isPending}
                  title={
                    item.lockedFields?.includes("name")
                      ? "Name is locked — AI re-analysis will not change it. Click to unlock."
                      : "Name is unlocked — AI re-analysis may update it. Click to lock."
                  }
                  data-testid="button-lock-name"
                  className={
                    item.lockedFields?.includes("name")
                      ? "border-red-400 text-red-600 hover:border-red-500 hover:text-red-700"
                      : "border-green-400 text-green-600 hover:border-green-500 hover:text-green-700"
                  }
                >
                  {item.lockedFields?.includes("name") ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <LockOpen className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setEditing(true)}
                  data-testid="button-edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      data-testid="button-delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this piece?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes "{item.name}" and all its
                        photos. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => remove.mutate({ id })}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        data-testid="button-confirm-delete"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>

          {/* AI description */}
          {editing ? (
            <EditField
              label="AI Description (editable)"
              value={aiDescription}
              onChange={setAiDescription}
              multiline
              placeholder="Describe this piece…"
            />
          ) : item.aiDescription ? (
            <div className="group relative">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {item.aiDescription}
              </p>
              <button
                type="button"
                onClick={() => toggleFieldLock("aiDescription")}
                title={
                  item.lockedFields?.includes("aiDescription")
                    ? "Locked — AI re-analysis won't change this. Click to unlock."
                    : "Click to lock — AI re-analysis won't overwrite this."
                }
                className={cn(
                  "absolute right-0 top-0 rounded p-0.5 transition",
                  item.lockedFields?.includes("aiDescription")
                    ? "text-red-500 hover:text-red-600"
                    : "text-green-500/60 hover:text-green-600",
                )}
              >
                {item.lockedFields?.includes("aiDescription") ? (
                  <Lock className="h-3 w-3" />
                ) : (
                  <LockOpen className="h-3 w-3" />
                )}
              </button>
            </div>
          ) : null}

          {/* Categories — view only; click any chip to jump to that filter in the collection */}
          {!editing && item.categories.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Categories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...item.categories]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => navigate("/?cat=" + cat.id)}
                      title={`Filter collection by "${cat.name}"`}
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition hover:opacity-80",
                        !cat.bgColor &&
                          "border border-card-border bg-muted text-muted-foreground",
                      )}
                      style={
                        cat.bgColor
                          ? {
                              backgroundColor: cat.bgColor,
                              color: cat.textColor ?? "#fff",
                            }
                          : undefined
                      }
                    >
                      {cat.name}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Colors + motifs (view only) */}
          {!editing && (
            <>
              {item.dominantColors.length > 0 && (
                <div className="group relative flex flex-wrap items-center gap-2">
                  {item.dominantColors.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        navigate("/?color=" + encodeURIComponent(c))
                      }
                      title={`Filter collection by this colour`}
                      className="flex items-center gap-1.5 rounded-full border border-card-border bg-card py-1 pl-1.5 pr-2.5 text-xs transition hover:border-primary/40 hover:bg-accent"
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-black/10"
                        style={{ backgroundColor: c }}
                      />
                      {c}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => toggleFieldLock("dominantColors")}
                    title={
                      item.lockedFields?.includes("dominantColors")
                        ? "Locked — AI won't update colours. Click to unlock."
                        : "Click to lock — AI won't overwrite colours."
                    }
                    className={cn(
                      "rounded p-0.5 transition",
                      item.lockedFields?.includes("dominantColors")
                        ? "text-red-500 hover:text-red-600"
                        : "text-green-500/60 hover:text-green-600",
                    )}
                  >
                    {item.lockedFields?.includes("dominantColors") ? (
                      <Lock className="h-3 w-3" />
                    ) : (
                      <LockOpen className="h-3 w-3" />
                    )}
                  </button>
                </div>
              )}
              {item.motifs.length > 0 && (
                <div className="group relative flex flex-wrap gap-1.5">
                  {item.motifs.map((m, i) => (
                    <Badge key={i} variant="secondary">
                      {m}
                    </Badge>
                  ))}
                  <button
                    type="button"
                    onClick={() => toggleFieldLock("motifs")}
                    title={
                      item.lockedFields?.includes("motifs")
                        ? "Locked — AI won't update motifs. Click to unlock."
                        : "Click to lock — AI won't overwrite motifs."
                    }
                    className={cn(
                      "rounded p-0.5 transition",
                      item.lockedFields?.includes("motifs")
                        ? "text-red-500 hover:text-red-600"
                        : "text-green-500/60 hover:text-green-600",
                    )}
                  >
                    {item.lockedFields?.includes("motifs") ? (
                      <Lock className="h-3 w-3" />
                    ) : (
                      <LockOpen className="h-3 w-3" />
                    )}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Save/cancel */}
          {editing && (
            <div className="flex gap-2">
              <Button
                onClick={save}
                disabled={update.isPending}
                data-testid="button-save"
              >
                {update.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </Button>
              <Button variant="ghost" onClick={cancelEdit}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Details panel */}
      <div className="mt-6 space-y-4">
        {editing ? (
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h2 className="mb-4 text-sm font-semibold">Edit details</h2>
            <div className="mb-4">
              <TagSelector
                allCategories={allCategories}
                selectedIds={selectedCategoryIds}
                onToggle={toggleCategory}
                onCreated={(cat: Category) =>
                  setSelectedCategoryIds((prev) => [...prev, cat.id])
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Quantity
                </Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  onFocus={(e) => e.target.select()}
                  className="w-24"
                />
              </div>
              <EditField
                label="Notes"
                value={notes}
                onChange={setNotes}
                multiline
                placeholder="Where you bought it, notes…"
              />
              <AutocompleteInput
                label="Maker / mark"
                value={maker}
                onChange={setMaker}
                suggestions={fieldSuggestions.maker}
                placeholder="e.g. Wedgwood"
              />
              <EditField
                label="Maker info"
                value={makerInfo}
                onChange={setMakerInfo}
                multiline
                placeholder="Background about the manufacturer, era, pattern…"
              />
              <EditField
                label="Dimensions"
                value={dimensions}
                onChange={setDimensions}
                placeholder="e.g. 12cm tall × 9cm wide"
              />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Date acquired
                </Label>
                <Input
                  type="date"
                  value={acquiredAt}
                  onChange={(e) => setAcquiredAt(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={save}
                disabled={update.isPending}
                data-testid="button-save-bottom"
              >
                {update.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save all changes
              </Button>
              <Button variant="ghost" onClick={cancelEdit}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-card-border bg-card">
            <div className="border-b border-card-border px-4 py-3">
              <h2 className="text-sm font-semibold">Details</h2>
            </div>
            <div className="px-4">
              <div className="border-b border-card-border py-2.5">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Quantity
                </p>
                <p className="text-sm">{item.quantity ?? 1}</p>
              </div>
              {item.notes && (
                <div className="border-b border-card-border py-2.5">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Notes
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{item.notes}</p>
                </div>
              )}
              <DetailRow
                label="Pattern"
                value={item.patternDescription}
                locked={item.lockedFields?.includes("patternDescription")}
                onToggleLock={() => toggleFieldLock("patternDescription")}
              />
              <DetailRow
                label="Style"
                value={item.style}
                locked={item.lockedFields?.includes("style")}
                onToggleLock={() => toggleFieldLock("style")}
              />
              <DetailRow
                label="Shape"
                value={item.shape}
                locked={item.lockedFields?.includes("shape")}
                onToggleLock={() => toggleFieldLock("shape")}
              />
              <DetailRow
                label="Maker"
                value={item.maker}
                locked={item.lockedFields?.includes("maker")}
                onToggleLock={() => toggleFieldLock("maker")}
              />
              {item.makerInfo && (
                <div className="group border-b border-card-border py-2.5 last:border-0">
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span className="flex-1">Maker info</span>
                    <button
                      type="button"
                      onClick={() => toggleFieldLock("makerInfo")}
                      title={
                        item.lockedFields?.includes("makerInfo")
                          ? "Locked — AI won't update maker info. Click to unlock."
                          : "Click to lock — AI won't overwrite maker info."
                      }
                      className={cn(
                        "rounded p-0.5 transition",
                        item.lockedFields?.includes("makerInfo")
                          ? "text-amber-500"
                          : "text-muted-foreground/25 opacity-0 group-hover:opacity-100 hover:text-muted-foreground/60",
                      )}
                    >
                      {item.lockedFields?.includes("makerInfo") ? (
                        <Lock className="h-3 w-3" />
                      ) : (
                        <LockOpen className="h-3 w-3" />
                      )}
                    </button>
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {item.makerInfo}
                  </p>
                </div>
              )}
              <DetailRow label="Dimensions" value={item.dimensions} />
              <DetailRow
                label="Acquired"
                value={
                  item.acquiredAt
                    ? new Date(
                        item.acquiredAt + "T00:00:00",
                      ).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : null
                }
              />
              <DetailRow
                label="Added"
                value={new Date(item.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
