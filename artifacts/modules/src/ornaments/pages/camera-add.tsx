import { useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import {
  Camera,
  CheckCircle2,
  Loader2,
  XCircle,
  ImagePlus,
  ScanLine,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createOrnamentFromImage,
  uploadOrnamentImage,
  getListOrnamentsQueryKey,
  getGetOrnamentStatsQueryKey,
  useLookupBarcode,
  useDeleteOrnament,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import {
  STANDARD_IMAGE_UPLOAD,
  validateClientUpload,
} from "@workspace/upload-policy";
import { useBarcodeCamera } from "@/ornaments/components/use-barcode-camera";
import { CameraModal } from "@/ornaments/components/image-picker";
import {
  createOrnamentPhotoQueue,
  deriveHandleDoneRoute,
} from "./camera-add-logic";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemStatus = "queued" | "processing" | "done" | "error";

/** A barcode lookup result shape (subset we care about). */
type BarcodeResult = Awaited<
  ReturnType<ReturnType<typeof useLookupBarcode>["mutateAsync"]>
>;

interface QueueItem {
  clientId: string;
  kind: "photo" | "barcode";
  // photo-only
  file?: File;
  preview?: string;
  // barcode-only
  code?: string;
  /** When kind==="barcode" and data was rejected by user, mark this. */
  dataRejected?: boolean;
  status: ItemStatus;
  label?: string;
}

/** A pending confirmation that the user must resolve before the barcode entry is finalised. */
interface PendingConfirmation {
  clientId: string;
  code: string;
  result: BarcodeResult;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CameraAddOrnament() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Queue of confirmations waiting to be shown (only one shown at a time).
  const [confirmationQueue, setConfirmationQueue] = useState<
    PendingConfirmation[]
  >([]);

  // The serial photo queue — created once per mount, holds ornamentId internally.
  const queueRef = useRef(
    createOrnamentPhotoQueue(createOrnamentFromImage, uploadOrnamentImage),
  );

  const lookupBarcode = useLookupBarcode();
  const deleteOrnament = useDeleteOrnament();

  usePageAssistantContext(
    "ornaments-camera-add",
    `Camera Add Ornament: take photos or scan barcodes to add a new ornament. First photo creates the ornament and AI identifies it automatically. Subsequent photos are added as supplemental images. ${items.length} item(s) captured this session.`,
  );

  // ── Barcode camera ────────────────────────────────────────────────────────

  const handleBarcodeDetected = useCallback(
    async (code: string) => {
      setScannerOpen(false);

      const clientId = crypto.randomUUID();
      const item: QueueItem = {
        clientId,
        kind: "barcode",
        code,
        status: "processing",
        label: `Barcode: ${code}`,
      };
      setItems((prev) => [item, ...prev]);

      try {
        const result = await lookupBarcode.mutateAsync({
          data: { barcode: code },
        });
        // Instead of immediately marking done, push to confirmation queue.
        setConfirmationQueue((prev) => [...prev, { clientId, code, result }]);
        // Mark the queue row as "processing" still — it stays there until confirmed.
      } catch {
        // On lookup failure just mark done with the raw barcode.
        setItems((prev) =>
          prev.map((i) =>
            i.clientId === clientId
              ? { ...i, status: "done", label: `Barcode: ${code}` }
              : i,
          ),
        );
      }
    },
    [lookupBarcode],
  );

  const { videoRef, isScanning, hasCamera } = useBarcodeCamera({
    enabled: scannerOpen,
    onDetected: handleBarcodeDetected,
  });

  // ── Confirmation handlers ─────────────────────────────────────────────────

  /** User confirmed the barcode data looks correct. */
  function handleConfirmYes(confirmation: PendingConfirmation) {
    const { clientId, code, result } = confirmation;
    const label = result.found
      ? (result.name ?? `Barcode: ${code}`)
      : `Barcode: ${code}`;

    setItems((prev) =>
      prev.map((i) =>
        i.clientId === clientId
          ? { ...i, status: "done", label, dataRejected: false }
          : i,
      ),
    );

    // Prefill sessionStorage so /ornaments/add can pick it up.
    if (result.found) {
      // Warn the user if a previous barcode's data is being replaced.
      if (sessionStorage.getItem("ornament-add-prefill")) {
        toast.info("Barcode data updated — previous scan replaced.", {
          duration: 4000,
        });
      }
      sessionStorage.setItem(
        "ornament-add-prefill",
        JSON.stringify({
          barcode: code,
          label,
          brand: result.brand,
          year: result.year,
          series: result.seriesOrCollection,
        }),
      );
    }

    setConfirmationQueue((prev) => prev.filter((c) => c.clientId !== clientId));
  }

  /** User said the data is wrong. */
  function handleConfirmNo(confirmation: PendingConfirmation) {
    const { clientId, code } = confirmation;
    setItems((prev) =>
      prev.map((i) =>
        i.clientId === clientId
          ? {
              ...i,
              status: "done",
              label: "Barcode found — data not applied",
              dataRejected: true,
            }
          : i,
      ),
    );
    // Do NOT write sessionStorage.
    setConfirmationQueue((prev) => prev.filter((c) => c.clientId !== clientId));
  }

  /** User acknowledged a "not found" result. */
  function handleConfirmGotIt(confirmation: PendingConfirmation) {
    const { clientId, code } = confirmation;
    setItems((prev) =>
      prev.map((i) =>
        i.clientId === clientId
          ? {
              ...i,
              status: "done",
              label: `Barcode: ${code} — not in catalog`,
            }
          : i,
      ),
    );
    setConfirmationQueue((prev) => prev.filter((c) => c.clientId !== clientId));
  }

  // ── Photo processing queue ────────────────────────────────────────────────

  function schedulePhoto(item: QueueItem) {
    queueRef.current.schedulePhoto(item.file!, {
      onProcessingStart: () => {
        setItems((prev) =>
          prev.map((i) =>
            i.clientId === item.clientId ? { ...i, status: "processing" } : i,
          ),
        );
      },
      onCreate: (id, name) => {
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentStatsQueryKey(),
        });
        setItems((prev) =>
          prev.map((i) =>
            i.clientId === item.clientId
              ? { ...i, status: "done", label: name ?? "Ornament" }
              : i,
          ),
        );
      },
      onUpload: () => {
        setItems((prev) =>
          prev.map((i) =>
            i.clientId === item.clientId
              ? { ...i, status: "done", label: item.label }
              : i,
          ),
        );
      },
      onError: (err) => {
        const errorMsg = err instanceof Error ? err.message : "Upload failed";
        setItems((prev) =>
          prev.map((i) =>
            i.clientId === item.clientId ? { ...i, status: "error" } : i,
          ),
        );
        setErrorBanner(errorMsg);
        Sentry.captureException(err, {
          extra: { ornamentId: queueRef.current.getOrnamentId() },
        });
        toast.error("Upload failed — try again.", { duration: 5000 });
      },
    });
  }

  function enqueuePhotoFile(f: File) {
    const validation = validateClientUpload(f, STANDARD_IMAGE_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    const clientId = crypto.randomUUID();
    const preview = URL.createObjectURL(f);
    const photoCount = items.filter((i) => i.kind === "photo").length + 1;
    const label =
      queueRef.current.getOrnamentId() !== null
        ? `Supplemental photo ${photoCount}`
        : undefined;
    const item: QueueItem = {
      clientId,
      kind: "photo",
      file: f,
      preview,
      status: "queued",
      label,
    };

    setItems((prev) => [item, ...prev]);
    schedulePhoto(item);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const f of files) enqueuePhotoFile(f);
  }

  function handleCameraCapture(file: File) {
    // Stay open so the user can keep snapping — this is a bulk-add flow.
    enqueuePhotoFile(file);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  const hasAnyPhotos = items.some((i) => i.kind === "photo");

  async function handleDone() {
    const stillProcessing = items.some(
      (i) =>
        i.kind === "photo" &&
        (i.status === "processing" || i.status === "queued"),
    );
    const result = deriveHandleDoneRoute(
      queueRef.current.getOrnamentId(),
      hasAnyPhotos,
      stillProcessing,
    );
    if (result.kind === "blocked") {
      toast.info("Still saving — please wait a moment.", { duration: 3000 });
      return;
    }
    navigate(result.to);
  }

  async function handleCancel() {
    const id = queueRef.current.getOrnamentId();
    if (id !== null) {
      setCancelLoading(true);
      try {
        await deleteOrnament.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
      } catch {
        // best-effort
      } finally {
        setCancelLoading(false);
      }
    }
    navigate("/ornaments");
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const doneCount = items.filter((i) => i.status === "done").length;

  // The one confirmation to show right now (head of the queue).
  const activeConfirmation = confirmationQueue[0] ?? null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {cameraOpen && (
        <CameraModal
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
          capturedCount={items.filter((i) => i.kind === "photo").length}
        />
      )}

      <div className="mx-auto max-w-xl space-y-4">
        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold">Add Ornament</h1>
        </div>

        {/* ── Error banner ─────────────────────────────────────────────────── */}
        {errorBanner && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span className="flex-1">{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Three choice boxes ───────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {/* Take photos with the camera */}
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-card px-2 py-8 text-center transition-colors hover:border-primary hover:bg-muted/30"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Camera className="h-6 w-6 text-primary" />
            </div>
            <span className="text-sm font-semibold leading-tight text-foreground">
              Take Photos
            </span>
          </button>

          {/* Bulk upload photos from gallery */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-card px-2 py-8 text-center transition-colors hover:border-primary hover:bg-muted/30"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ImagePlus className="h-6 w-6 text-primary" />
            </div>
            <span className="text-sm font-semibold leading-tight text-foreground">
              Upload Photos
            </span>
          </button>

          {/* Scan barcode */}
          <button
            type="button"
            onClick={() => setScannerOpen((o) => !o)}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-2 py-8 text-center transition-colors ${
              scannerOpen
                ? "border-primary bg-primary/5"
                : "border-primary/40 bg-card hover:border-primary hover:bg-muted/30"
            }`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ScanLine className="h-6 w-6 text-primary" />
            </div>
            <span className="text-sm font-semibold leading-tight text-foreground">
              Scan Barcode
            </span>
          </button>
        </div>

        {/* ── Hidden file input ─────────────────────────────────────────────── */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* ── Inline barcode scanner ────────────────────────────────────────── */}
        {scannerOpen && (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
              <p className="text-sm font-medium">Scanning for barcode…</p>
              <button
                type="button"
                onClick={() => setScannerOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {hasCamera ? (
              <div className="relative aspect-video w-full bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                {isScanning && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-32 w-64 rounded-lg border-2 border-primary/60 bg-transparent" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <Camera className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No camera available on this device
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Barcode confirmation card ─────────────────────────────────────── */}
        {activeConfirmation && (
          <div className="rounded-xl border border-border bg-card shadow-sm">
            {activeConfirmation.result.found ? (
              <>
                <div className="border-b border-border/60 px-4 py-3">
                  <p className="text-sm font-semibold">
                    Is this the right ornament?
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    We found a catalog match for barcode{" "}
                    <span className="font-mono">{activeConfirmation.code}</span>
                  </p>
                </div>

                <div className="flex gap-3 px-4 py-3">
                  {(activeConfirmation.result.hallmarkImages?.[0] ??
                    activeConfirmation.result.imageUrl) && (
                    <img
                      src={
                        activeConfirmation.result.hallmarkImages?.[0] ??
                        activeConfirmation.result.imageUrl!
                      }
                      alt={activeConfirmation.result.name ?? "Product"}
                      className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {activeConfirmation.result.name ?? "Unknown Product"}
                    </p>
                    {activeConfirmation.result.brand && (
                      <p className="text-xs text-muted-foreground">
                        {activeConfirmation.result.brand}
                      </p>
                    )}
                    {(activeConfirmation.result.year ??
                      activeConfirmation.result.seriesOrCollection) && (
                      <p className="text-xs text-muted-foreground">
                        {[
                          activeConfirmation.result.year,
                          activeConfirmation.result.seriesOrCollection,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 border-t border-border/60 px-4 py-3">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleConfirmYes(activeConfirmation)}
                  >
                    Yes, looks correct
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
                    onClick={() => handleConfirmNo(activeConfirmation)}
                  >
                    No, wrong info
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="border-b border-border/60 px-4 py-3">
                  <p className="text-sm font-semibold">No catalog match</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    No catalog match for barcode{" "}
                    <span className="font-mono">{activeConfirmation.code}</span>
                  </p>
                </div>
                <div className="flex justify-end border-t border-border/60 px-4 py-3">
                  <Button
                    size="sm"
                    onClick={() => handleConfirmGotIt(activeConfirmation)}
                  >
                    Got it
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Processing queue ─────────────────────────────────────────────── */}
        {items.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Processing queue
              </p>
              <p className="text-xs text-muted-foreground">
                {doneCount}/{items.length} done
              </p>
            </div>
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.clientId} className="space-y-1">
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2.5">
                    {item.kind === "photo" && item.preview ? (
                      <img
                        src={item.preview}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <ScanLine className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      {item.status === "done" ? (
                        <>
                          <p className="truncate text-sm font-medium text-foreground">
                            {item.label ?? "Saved"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.kind === "photo"
                              ? "Saved to collection"
                              : "Barcode scanned"}
                          </p>
                        </>
                      ) : item.status === "error" ? (
                        <>
                          <p className="truncate text-sm font-medium text-destructive">
                            Upload failed
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Could not save this photo
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
                            {item.kind === "photo"
                              ? "Analysing…"
                              : "Looking up…"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.kind === "photo"
                              ? "AI cataloguing in progress"
                              : "Awaiting confirmation"}
                          </p>
                        </>
                      )}
                    </div>
                    {item.status === "done" && (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                    )}
                    {(item.status === "processing" ||
                      item.status === "queued") && (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                    )}
                    {item.status === "error" && (
                      <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                    )}
                  </div>
                  {/* Note shown under rejected barcode entries */}
                  {item.kind === "barcode" &&
                    item.status === "done" &&
                    item.dataRejected && (
                      <p className="px-1 text-[11px] text-muted-foreground">
                        The barcode data won&apos;t be applied — you can fill in
                        the details after saving.
                      </p>
                    )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Bottom action bar ─────────────────────────────────────────────── */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleCancel}
            disabled={cancelLoading}
          >
            {cancelLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleDone}>
            Done adding Ornament
          </Button>
        </div>
      </div>
    </>
  );
}
