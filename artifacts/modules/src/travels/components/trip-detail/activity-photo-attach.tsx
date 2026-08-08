import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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

/** Button + dialog letting the user attach a photo to a manually-added
 *  itinerary activity — either by uploading a new one (created in the
 *  trip's existing photo storage, so it shows up in the gallery too) or by
 *  picking one already in the trip's gallery. */
export function AttachActivityPhotoButton({
  tripId,
  onAttach,
  compact = false,
}: {
  tripId: number;
  onAttach: (photoId: number) => void;
  /** Icon-only trigger for use inline on an existing activity row. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
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
        onAttach(photo.id);
        setOpen(false);
        toast.success("Photo attached");
      },
      onError: (err) =>
        toast.error(getUploadErrorMessage(err, "Upload failed")),
    },
  });

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
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Camera className={compact ? "w-3.5 h-3.5" : "w-3.5 h-3.5 mr-1"} />
        {!compact && "Attach photo"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attach a photo</DialogTitle>
            <DialogDescription>
              Upload a new photo or pick one already in this trip's gallery.
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
            ) : photos.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No photos in this trip's gallery yet.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => {
                      onAttach(photo.id);
                      setOpen(false);
                    }}
                    className="aspect-square rounded-md overflow-hidden border border-border/60 hover:ring-2 hover:ring-primary transition-all"
                    title={photo.caption ?? undefined}
                  >
                    <img
                      src={getTripPhotoImageUrl(tripId, photo.id)}
                      alt={photo.caption ?? ""}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
