/**
 * Magnets – Bulk Add page (Quilting-style camera flow)
 *
 * • One photo at a time via camera capture (file input with capture="environment")
 * • Each capture creates exactly one Magnet via AI and sets that photo as the
 *   default image
 * • Processing queue persists between captures — failed items can be retried
 * • "Done" exits the flow and navigates back to the collection
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Camera, CheckCircle2, Loader2, ArrowLeft, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  addMagnetImage,
  createMagnet,
  deleteMagnet,
  getListMagnetsQueryKey,
  reanalyzeMagnet,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  STANDARD_IMAGE_UPLOAD,
  validateClientUpload,
} from "@workspace/upload-policy";
import { ImageCaptureReview } from "@workspace/image-capture";
import { claimCaptureSchedule, releaseCaptureSchedule } from "./bulk-add-queue";

type ItemStatus = "queued" | "processing" | "done" | "error";

interface CaptureItem {
  clientId: string;
  file: File;
  preview: string;
  status: ItemStatus;
  magnetId?: number;
  imageUploaded?: boolean;
  name?: string;
  errorMsg?: string;
}

export default function BulkAddMagnets() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [pendingCaptureFile, setPendingCaptureFile] = useState<File | null>(
    null,
  );

  // Simple sequential processing — one at a time is fine for camera captures
  const processingRef = useRef(false);
  const pendingRef = useRef<CaptureItem[]>([]);
  const scheduledIdsRef = useRef(new Set<string>());
  const itemsRef = useRef<CaptureItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.preview);
    };
  }, []);

  async function processItem(item: CaptureItem) {
    setItems((prev) =>
      prev.map((i) =>
        i.clientId === item.clientId ? { ...i, status: "processing" } : i,
      ),
    );

    try {
      // Hold on to the server record as soon as it is created. A retry then
      // resumes the same item rather than silently creating a duplicate.
      let magnetId = item.magnetId;
      if (!magnetId) {
        const created = await createMagnet({
          name: "New Magnet",
          description: null,
          notes: null,
          categoryIds: [],
        });
        magnetId = created.id;
        setItems((prev) =>
          prev.map((current) =>
            current.clientId === item.clientId
              ? { ...current, magnetId }
              : current,
          ),
        );
      }

      // The first image endpoint promotes the capture to the default image.
      // Do not upload it twice if a later AI call was the part that failed.
      if (!item.imageUploaded) {
        await addMagnetImage(magnetId, { image: item.file });
        setItems((prev) =>
          prev.map((current) =>
            current.clientId === item.clientId
              ? { ...current, imageUploaded: true }
              : current,
          ),
        );
        // The stored photo is already a collection-visible mutation. Refresh
        // before AI analysis so a later analysis failure cannot hide it behind
        // a stale list cache.
        await queryClient.invalidateQueries({
          queryKey: getListMagnetsQueryKey(),
        });
      }

      // A capture is an AI scan: once its default photo is present, update
      // unlocked Name/Description and attach reusable AI categories.
      const analyzed = await reanalyzeMagnet(magnetId);
      await queryClient.invalidateQueries({
        queryKey: getListMagnetsQueryKey(),
      });

      setItems((prev) =>
        prev.map((i) =>
          i.clientId === item.clientId
            ? { ...i, status: "done", magnetId, name: analyzed.name }
            : i,
        ),
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Upload failed";
      setItems((prev) =>
        prev.map((i) =>
          i.clientId === item.clientId
            ? { ...i, status: "error", errorMsg }
            : i,
        ),
      );
      toast.error("Could not save magnet — tap Retry to try again.", {
        duration: 6000,
      });
    } finally {
      processingRef.current = false;
      releaseCaptureSchedule(scheduledIdsRef.current, item.clientId);
      const next = pendingRef.current.shift();
      if (next) {
        processingRef.current = true;
        void processItem(next);
      }
    }
  }

  function scheduleItem(item: CaptureItem) {
    if (!claimCaptureSchedule(scheduledIdsRef.current, item.clientId)) return;
    if (!processingRef.current) {
      processingRef.current = true;
      void processItem(item);
    } else {
      pendingRef.current.push(item);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";

    const validation = validateClientUpload(f, STANDARD_IMAGE_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    setPendingCaptureFile(f);
  }

  function enqueueFile(f: File) {
    const validation = validateClientUpload(f, STANDARD_IMAGE_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    const clientId = crypto.randomUUID();
    const preview = URL.createObjectURL(f);
    const item: CaptureItem = {
      clientId,
      file: f,
      preview,
      status: "queued",
    };

    setItems((prev) => [...prev, item]);
    scheduleItem(item);
  }

  function handleReviewRetry() {
    setPendingCaptureFile(null);
    // Wait for the review overlay to unmount before opening the native camera
    // picker again. Clearing the input value allows the same camera photo to
    // be selected twice without the browser suppressing the change event.
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }

  function handleReviewConfirm(file: File) {
    setPendingCaptureFile(null);
    enqueueFile(file);
  }

  function retryItem(item: CaptureItem) {
    // Reset to queued and reschedule
    const retried: CaptureItem = {
      ...item,
      status: "queued",
      errorMsg: undefined,
    };
    setItems((prev) =>
      prev.map((i) => (i.clientId === item.clientId ? retried : i)),
    );
    scheduleItem(retried);
  }

  function removeItem(clientId: string) {
    const item = items.find((current) => current.clientId === clientId);
    pendingRef.current = pendingRef.current.filter(
      (current) => current.clientId !== clientId,
    );
    if (item) URL.revokeObjectURL(item.preview);
    // Removing a failed, incomplete capture also removes its draft record so
    // the collection cannot accumulate invisible no-photo magnets.
    if (item?.magnetId && item.status !== "done") {
      void deleteMagnet(item.magnetId).then(() =>
        queryClient.invalidateQueries({ queryKey: getListMagnetsQueryKey() }),
      );
    }
    setItems((prev) => prev.filter((current) => current.clientId !== clientId));
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const totalCount = items.length;
  const hasProcessing = items.some(
    (i) => i.status === "processing" || i.status === "queued",
  );

  return (
    <div className="mx-auto max-w-xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/magnets")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Add Magnets</h1>
      </div>

      {/* Capture zone */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="relative flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-card py-10 transition-colors hover:border-primary hover:bg-muted/30"
      >
        {/* Corner accents */}
        <div className="absolute left-3 top-3 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-primary/60" />
        <div className="absolute right-3 top-3 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-primary/60" />
        <div className="absolute bottom-3 left-3 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-primary/60" />
        <div className="absolute bottom-3 right-3 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-primary/60" />

        {totalCount > 0 && (
          <div className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {totalCount} captured
          </div>
        )}

        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Camera className="h-7 w-7 text-primary" />
        </div>
        <span className="text-sm font-semibold text-foreground">
          Tap to capture
        </span>
        <span className="text-xs text-muted-foreground">
          Each photo creates one magnet — tap again to add more
        </span>
      </button>

      {/* Camera input — one photo at a time */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {pendingCaptureFile && (
        <ImageCaptureReview
          file={pendingCaptureFile}
          onConfirm={handleReviewConfirm}
          onRetry={handleReviewRetry}
          enableEditing
        />
      )}

      {/* Done button */}
      <Button
        className="mt-4 w-full"
        onClick={() => navigate("/magnets")}
        disabled={hasProcessing}
      >
        {hasProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          "Done"
        )}
      </Button>
      {hasProcessing && (
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Please wait while photos are being saved
        </p>
      )}

      {/* Processing queue */}
      {items.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Processing queue
            </p>
            <p className="text-xs text-muted-foreground">
              {doneCount}/{totalCount} saved
            </p>
          </div>
          <div className="space-y-2">
            {[...items].reverse().map((item) => (
              <div
                key={item.clientId}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2.5"
              >
                <img
                  src={item.preview}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  {item.status === "done" ? (
                    <>
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.name ?? "Magnet"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Saved to collection
                      </p>
                    </>
                  ) : item.status === "error" ? (
                    <>
                      <p className="truncate text-sm font-medium text-destructive">
                        Upload failed
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.errorMsg ?? "Could not save this photo"}
                      </p>
                    </>
                  ) : item.status === "queued" ? (
                    <>
                      <p className="truncate text-sm font-medium text-muted-foreground">
                        Queued…
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Waiting to process
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium text-muted-foreground">
                        Creating magnet…
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Uploading photo
                      </p>
                    </>
                  )}
                </div>

                {/* Status icon / action */}
                {item.status === "done" && (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                )}
                {(item.status === "processing" || item.status === "queued") && (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                )}
                {item.status === "error" && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => retryItem(item)}
                      className="rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/20"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.clientId)}
                      className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {item.status === "done" && item.magnetId && (
                  <a
                    href={`/magnets/item/${item.magnetId}`}
                    className="text-[11px] text-primary hover:underline shrink-0"
                  >
                    View
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
