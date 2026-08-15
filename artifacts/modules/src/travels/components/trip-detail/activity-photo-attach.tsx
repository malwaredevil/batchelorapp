import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useListTripPhotos,
  useUploadTripPhoto,
  getTripPhotoImageUrl,
  getListTripPhotosQueryKey,
  getUploadErrorMessage,
} from "@workspace/api-client-react";
import {
  LARGE_IMAGE_UPLOAD,
  validateClientUpload,
} from "@workspace/upload-policy";

/** Small thumbnail for a photo already attached to an itinerary activity —
 *  reuses the same trip-photo image URL as the main gallery, so it's always
 *  the same underlying photo, never a copy. */
export function ActivityPhotoThumb({
  tripId,
  photoId,
  onRemove,
}: {
  tripId: number;
  photoId: number;
  onRemove?: () => void;
}) {
  return (
    <div className="relative w-10 h-10 shrink-0 group/photo">
      <img
        src={getTripPhotoImageUrl(tripId, photoId)}
        alt=""
        className="w-10 h-10 object-cover rounded-md border border-border/60"
      />
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/photo:opacity-100 transition-opacity"
          title="Remove photo from this activity"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

/** Horizontal strip of activity photo thumbnails with per-photo remove
 *  buttons and an inline "+" that opens the attach dialog for more photos.
 *  The dialog state is self-contained here so callers don't need to thread
 *  open/close state per activity row. */
export function ActivityPhotoStrip({
  tripId,
  photoIds,
  onRemove,
  onAttach,
}: {
  tripId: number;
  photoIds: number[];
  onRemove: (photoId: number) => void;
  /** Called with newly-selected photo ids from the "add more" dialog. */
  onAttach: (newIds: number[]) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {photoIds.map((id) => (
        <ActivityPhotoThumb
          key={id}
          tripId={tripId}
          photoId={id}
          onRemove={() => onRemove(id)}
        />
      ))}
      {/* Compact "+" button — reuses the full attach dialog internally */}
      <AttachActivityPhotoButton
        tripId={tripId}
        compact
        existingPhotoIds={photoIds}
        onAttach={onAttach}
      />
    </div>
  );
}

/** Button + dialog letting the user attach one or more photos to a
 *  manually-added itinerary activity — either by uploading new ones (they
 *  land in the trip's gallery too) or by picking from the existing gallery.
 *  Multi-select is supported: the gallery shows checkboxes and the dialog
 *  stays open until the user clicks "Done". */
export function AttachActivityPhotoButton({
  tripId,
  onAttach,
  compact = false,
  existingPhotoIds = [],
}: {
  tripId: number;
  /** Called with all newly-selected photo ids when the dialog is confirmed. */
  onAttach: (photoIds: number[]) => void;
  /** Icon-only trigger for use inline on an existing activity row. */
  compact?: boolean;
  /** Ids already attached — shown as pre-checked in the gallery picker. */
  existingPhotoIds?: number[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const qc = useQueryClient();
  const { data: photos = [], isLoading } = useListTripPhotos(tripId, "photo", {
    query: {
      queryKey: getListTripPhotosQueryKey(tripId, "photo"),
      enabled: open,
    },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadPhoto = useUploadTripPhoto({
    mutation: {
      onSuccess: (photo) => {
        qc.invalidateQueries({
          queryKey: getListTripPhotosQueryKey(tripId, "photo"),
        });
        // Auto-select the freshly uploaded photo and confirm immediately
        onAttach([photo.id]);
        setOpen(false);
        setSelected(new Set());
        toast.success("Photo attached");
      },
      onError: (err) =>
        toast.error(getUploadErrorMessage(err, "Upload failed")),
    },
  });

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(new Set());
    setOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const validation = validateClientUpload(file, LARGE_IMAGE_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }
    const formData = new FormData();
    formData.append("photo", file);
    formData.append("type", "photo");
    uploadPhoto.mutate({ tripId, formData });
  };

  const toggleSelect = (photoId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const handleDone = () => {
    if (selected.size > 0) {
      onAttach(Array.from(selected));
    }
    setOpen(false);
    setSelected(new Set());
  };

  // Photos not yet attached to this activity (filter out already-attached)
  const availablePhotos = photos.filter(
    (p) => !existingPhotoIds.includes(p.id),
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={
          compact
            ? "h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            : "h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        }
        title="Attach photo"
        onClick={handleOpen}
      >
        <Camera className={compact ? "w-3.5 h-3.5" : "w-3.5 h-3.5 mr-1"} />
        {!compact && "Attach photo"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setSelected(new Set());
          }
          setOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attach photos</DialogTitle>
            <DialogDescription>
              Upload new photos or pick from this trip's gallery. Select
              multiple and click Done to attach them all at once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={uploadPhoto.isPending}
            >
              {uploadPhoto.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1.5" />
              )}
              {uploadPhoto.isPending ? "Uploading…" : "Upload new photo"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            {isLoading ? (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : availablePhotos.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {photos.length === 0
                  ? "No photos in this trip's gallery yet."
                  : "All gallery photos are already attached to this activity."}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {selected.size === 0
                    ? "Tap photos to select"
                    : `${selected.size} selected`}
                </p>
                <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
                  {availablePhotos.map((photo) => {
                    const isChecked = selected.has(photo.id);
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => toggleSelect(photo.id)}
                        className={`relative aspect-square rounded-md overflow-hidden border transition-all ${
                          isChecked
                            ? "ring-2 ring-primary border-primary"
                            : "border-border/60 hover:ring-2 hover:ring-primary/50"
                        }`}
                        title={photo.caption ?? undefined}
                      >
                        <img
                          src={getTripPhotoImageUrl(tripId, photo.id)}
                          alt={photo.caption ?? ""}
                          className="w-full h-full object-cover"
                        />
                        {isChecked && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                              <Check className="w-3 h-3 text-primary-foreground" />
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(new Set());
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleDone}
              disabled={selected.size === 0}
            >
              {selected.size === 0
                ? "Done"
                : `Attach ${selected.size} photo${selected.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
