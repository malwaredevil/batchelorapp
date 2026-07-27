import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type WheelEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Wand2,
  Eraser,
  Trash2,
  Loader2,
  Brush,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  ZoomIn,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useLabDetectCreases,
  useLabRemoveCreasesOpenai,
  useLabRemoveCreasesReplicate,
  getGetFabricQueryKey,
  getListFabricsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  fabricId: number;
  imageUrl: string;
};

type ProviderResult =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; dataUrl: string }
  | { status: "error"; message: string };

type LightboxState = { src: string; title: string } | null;

const BRUSH_SIZES = [8, 16, 32, 56];
const DEFAULT_BRUSH = 1;
const PAINT_COLOR = "rgba(180, 0, 255, 0.72)";

export function FabricAiLab({ fabricId, imageUrl }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [eraseMode, setEraseMode] = useState(false);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[DEFAULT_BRUSH]);
  const [hasMask, setHasMask] = useState(false);
  const [detectDesc, setDetectDesc] = useState<string | null>(null);
  const [openaiResult, setOpenaiResult] = useState<ProviderResult>({
    status: "idle",
  });
  const [replResult, setReplResult] = useState<ProviderResult>({
    status: "idle",
  });
  const [savingFor, setSavingFor] = useState<"openai" | "replicate" | null>(
    null,
  );
  const [saveConfirm, setSaveConfirm] = useState<"openai" | "replicate" | null>(
    null,
  );
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  const detectMutation = useLabDetectCreases();
  const openaiMutation = useLabRemoveCreasesOpenai();
  const replMutation = useLabRemoveCreasesReplicate();

  function getCanvas() {
    return canvasRef.current;
  }
  function getCtx() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function syncCanvasSize() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const { offsetWidth: w, offsetHeight: h } = img;
    if (canvas.width !== w || canvas.height !== h) {
      const ctx = canvas.getContext("2d");
      let saved: ImageData | null = null;
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        saved = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      canvas.width = w;
      canvas.height = h;
      if (saved && ctx) ctx.putImageData(saved, 0, 0);
    }
  }

  useEffect(() => {
    if (!open) return;
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) syncCanvasSize();
    img.addEventListener("load", syncCanvasSize);
    const ro = new ResizeObserver(syncCanvasSize);
    if (img) ro.observe(img);
    return () => {
      img.removeEventListener("load", syncCanvasSize);
      ro.disconnect();
    };
  }, [open]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox]);

  function pointerPos(e: ReactPointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function draw(x: number, y: number) {
    const ctx = getCtx();
    if (!ctx) return;
    if (eraseMode) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = PAINT_COLOR;
    }
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    setHasMask(true);
  }

  function handlePointerDown(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    syncCanvasSize();
    draw(...(Object.values(pointerPos(e)) as [number, number]));
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!isDrawing) return;
    draw(...(Object.values(pointerPos(e)) as [number, number]));
  }

  function handlePointerUp() {
    setIsDrawing(false);
  }

  function clearMask() {
    const ctx = getCtx();
    const canvas = getCanvas();
    if (!ctx || !canvas) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasMask(false);
    setDetectDesc(null);
    setOpenaiResult({ status: "idle" });
    setReplResult({ status: "idle" });
  }

  function getMaskDataUrl(): string | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  }

  // Load a server-returned white-on-transparent mask and tint it purple so it
  // is visually consistent with manually-painted marks and editable with Erase.
  function loadMaskFromDataUrl(maskDataUrl: string) {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw the raw mask (white-on-transparent) then tint non-transparent
      // pixels to the same purple used for manual painting.
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = PAINT_COLOR;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      setHasMask(true);
    };
    img.src = maskDataUrl;
  }

  function handleAutoDetect() {
    setDetectDesc(null);
    detectMutation.mutate(
      { data: { fabricId } },
      {
        onSuccess: (data) => {
          setDetectDesc(data.description ?? null);
          if (data.maskDataUrl) loadMaskFromDataUrl(data.maskDataUrl);
          if ((data.creasesFound ?? 0) === 0) {
            toast.info(
              "No creases found automatically — try painting them manually.",
            );
          } else {
            toast.success(
              `Found ${data.creasesFound} crease${data.creasesFound === 1 ? "" : "s"} — adjust with Paint/Erase before running.`,
            );
          }
        },
        onError: () => {
          toast.error("Auto-detect failed. Try painting the creases manually.");
        },
      },
    );
  }

  function handleRemoveCreases() {
    const maskDataUrl = getMaskDataUrl();
    if (!maskDataUrl) return;

    setOpenaiResult({ status: "loading" });
    setReplResult({ status: "loading" });
    setSaveConfirm(null);

    openaiMutation.mutate(
      { data: { fabricId, maskDataUrl } },
      {
        onSuccess: (data) => {
          if (data.dataUrl)
            setOpenaiResult({ status: "success", dataUrl: data.dataUrl });
          else
            setOpenaiResult({ status: "error", message: "No image returned" });
        },
        onError: (err) => {
          const msg =
            err instanceof Error ? err.message : "This AI couldn't run";
          setOpenaiResult({ status: "error", message: msg });
        },
      },
    );

    replMutation.mutate(
      { data: { fabricId, maskDataUrl } },
      {
        onSuccess: (data) => {
          if (data.dataUrl)
            setReplResult({ status: "success", dataUrl: data.dataUrl });
          else setReplResult({ status: "error", message: "No image returned" });
        },
        onError: (err) => {
          const msg =
            err instanceof Error ? err.message : "This AI couldn't run";
          setReplResult({ status: "error", message: msg });
        },
      },
    );
  }

  async function handleSave(provider: "openai" | "replicate") {
    const dataUrl =
      provider === "openai"
        ? (openaiResult as { status: "success"; dataUrl: string }).dataUrl
        : (replResult as { status: "success"; dataUrl: string }).dataUrl;

    if (!dataUrl) return;
    setSavingFor(provider);
    setSaveConfirm(null);

    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const form = new FormData();
      form.append("image", blob, "fabric-photo.png");

      const uploadResp = await fetch(
        `/api/quilting/fabrics/${fabricId}/image`,
        {
          method: "PUT",
          body: form,
          credentials: "include",
        },
      );
      if (!uploadResp.ok)
        throw new Error(`Upload failed: ${uploadResp.status}`);

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetFabricQueryKey(fabricId),
        }),
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() }),
      ]);
      toast.success("Photo replaced successfully.");
    } catch {
      toast.error("Failed to save — please try again.");
    } finally {
      setSavingFor(null);
    }
  }

  const isRunning =
    openaiResult.status === "loading" || replResult.status === "loading";
  const hasResults =
    openaiResult.status !== "idle" || replResult.status !== "idle";

  return (
    <>
      {lightbox && (
        <ZoomPanLightbox
          src={lightbox.src}
          title={lightbox.title}
          onClose={() => setLightbox(null)}
        />
      )}

      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <button
          className="flex w-full items-center justify-between p-4 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI Crease Removal — Experimental
            </span>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {open && (
          <div className="border-t border-card-border p-4 space-y-5">
            {/* ── Step 1 ── */}
            <section className="space-y-3">
              <StepHeading number={1} label="Highlight the creases" />
              <p className="text-xs text-muted-foreground">
                Paint over any folds or wrinkles in purple. Use{" "}
                <strong>Auto-detect</strong> to let AI take a first pass, then
                touch up with Paint or Erase. Auto-detect works best on
                plain-coloured fabrics — busy patterns may need manual
                correction.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAutoDetect}
                  disabled={detectMutation.isPending || isRunning}
                >
                  {detectMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Auto-detect
                </Button>

                {/* Paint / Erase toggle */}
                <div className="flex items-center rounded-lg border border-card-border overflow-hidden">
                  <button
                    onClick={() => setEraseMode(false)}
                    className={`flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors ${!eraseMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
                  >
                    <Brush className="h-3.5 w-3.5" />
                    Paint
                  </button>
                  <button
                    onClick={() => setEraseMode(true)}
                    className={`flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors ${eraseMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    Erase
                  </button>
                </div>

                {/* Brush size dots */}
                <div className="flex items-center gap-1">
                  {BRUSH_SIZES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setBrushSize(s)}
                      title={`Brush size ${s}`}
                      className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${brushSize === s ? "border-primary bg-primary/10" : "border-card-border hover:bg-muted/60"}`}
                    >
                      <span
                        className="rounded-full bg-foreground"
                        style={{
                          width: Math.max(3, s / 4),
                          height: Math.max(3, s / 4),
                        }}
                      />
                    </button>
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearMask}
                  disabled={!hasMask || isRunning}
                  className="text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Clear all
                </Button>
              </div>

              {/* Canvas */}
              <div
                ref={containerRef}
                className="relative w-full overflow-hidden rounded-xl border border-card-border bg-muted select-none"
                style={{ touchAction: "none" }}
              >
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt="Fabric"
                  className="w-full object-contain"
                  draggable={false}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0"
                  style={{
                    cursor: eraseMode ? "cell" : "crosshair",
                    touchAction: "none",
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                />
              </div>

              {detectDesc && (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground italic">
                  AI detected: {detectDesc}
                </p>
              )}
            </section>

            {/* ── Step 2 ── */}
            <section className="space-y-2">
              <StepHeading number={2} label="Generate fixes" />
              <p className="text-xs text-muted-foreground">
                Two different AIs will each try to smooth the marked areas while
                preserving the rest of the fabric. Both run at the same time —
                takes about a minute.
              </p>
              <Button
                className="w-full"
                onClick={handleRemoveCreases}
                disabled={!hasMask || isRunning}
              >
                {isRunning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                {isRunning ? "Working — please wait…" : "Generate fixes"}
              </Button>
            </section>

            {/* ── Step 3 — Results ── */}
            {hasResults && (
              <section className="space-y-3">
                <StepHeading number={3} label="Pick the best result" />
                <p className="text-xs text-muted-foreground">
                  Click any image to zoom and inspect it. Click{" "}
                  <strong>Use this photo</strong> on the one you prefer — it
                  replaces the current fabric photo. The AI versions are only
                  saved if you choose one.
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <ResultPanel
                    title="Original"
                    subtitle="Unchanged"
                    imageUrl={imageUrl}
                    isOriginal
                    onZoom={() =>
                      setLightbox({ src: imageUrl, title: "Original" })
                    }
                  />
                  <ResultPanel
                    title="Version A"
                    subtitle="OpenAI GPT-Image"
                    result={openaiResult}
                    onZoom={
                      openaiResult.status === "success"
                        ? () =>
                            setLightbox({
                              src: (
                                openaiResult as {
                                  status: "success";
                                  dataUrl: string;
                                }
                              ).dataUrl,
                              title: "Version A — OpenAI",
                            })
                        : null
                    }
                    onSaveRequest={() => setSaveConfirm("openai")}
                    onSaveConfirm={() => handleSave("openai")}
                    saveConfirmPending={saveConfirm === "openai"}
                    isSaving={savingFor === "openai"}
                    onSaveCancel={() => setSaveConfirm(null)}
                  />
                  <ResultPanel
                    title="Version B"
                    subtitle="FLUX Fill (Replicate)"
                    result={replResult}
                    onZoom={
                      replResult.status === "success"
                        ? () =>
                            setLightbox({
                              src: (
                                replResult as {
                                  status: "success";
                                  dataUrl: string;
                                }
                              ).dataUrl,
                              title: "Version B — FLUX Fill",
                            })
                        : null
                    }
                    onSaveRequest={() => setSaveConfirm("replicate")}
                    onSaveConfirm={() => handleSave("replicate")}
                    saveConfirmPending={saveConfirm === "replicate"}
                    isSaving={savingFor === "replicate"}
                    onSaveCancel={() => setSaveConfirm(null)}
                  />
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Zoom/Pan Lightbox ────────────────────────────────────────────────────────

function ZoomPanLightbox({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setScale((s) => Math.min(8, Math.max(0.5, s - e.deltaY * 0.001)));
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
  }

  function handlePointerUp() {
    dragging.current = false;
  }

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50">
            Scroll to zoom · Drag to pan
          </span>
          <button
            onClick={resetView}
            className="rounded-lg border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10 transition-colors"
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Zoom/pan canvas */}
      <div
        className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ touchAction: "none" }}
      >
        <div
          className="h-full w-full flex items-center justify-center"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: dragging.current ? "none" : "transform 0.1s ease-out",
          }}
        >
          <img
            src={src}
            alt={title}
            className="max-h-[90vh] max-w-[90vw] object-contain select-none"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

// ── Supporting components ────────────────────────────────────────────────────

function StepHeading({ number, label }: { number: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
        {number}
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

type OriginalPanelProps = {
  title: string;
  subtitle: string;
  imageUrl: string;
  isOriginal: true;
  onZoom: () => void;
};

type AiPanelProps = {
  title: string;
  subtitle: string;
  result: ProviderResult;
  onZoom: (() => void) | null;
  onSaveRequest: () => void;
  onSaveConfirm: () => void;
  onSaveCancel: () => void;
  saveConfirmPending: boolean;
  isSaving: boolean;
};

// Fixed-height image container — every panel is the same height so images
// align regardless of original aspect ratio vs. AI-output square format.
const IMG_CONTAINER =
  "relative h-56 w-full overflow-hidden rounded-xl border border-card-border bg-muted flex items-center justify-center";

function ResultPanel(props: OriginalPanelProps | AiPanelProps) {
  if ("isOriginal" in props) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-medium">{props.title}</p>
          <p className="text-xs text-muted-foreground">{props.subtitle}</p>
        </div>
        <div className={IMG_CONTAINER}>
          <img
            src={props.imageUrl}
            alt={props.title}
            className="h-full w-full object-contain cursor-zoom-in"
            onClick={props.onZoom}
          />
          <ZoomHint />
        </div>
      </div>
    );
  }

  const {
    title,
    subtitle,
    result,
    onZoom,
    onSaveRequest,
    onSaveConfirm,
    onSaveCancel,
    saveConfirmPending,
    isSaving,
  } = props;

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className={IMG_CONTAINER}>
        {result.status === "loading" && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-xs">Working…</p>
          </div>
        )}
        {result.status === "success" && (
          <>
            <img
              src={result.dataUrl}
              alt={title}
              className="h-full w-full object-contain cursor-zoom-in"
              onClick={onZoom ?? undefined}
            />
            {onZoom && <ZoomHint />}
          </>
        )}
        {result.status === "error" && (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <AlertCircle className="h-6 w-6 text-destructive/70" />
            <p className="text-xs text-destructive/70">
              This AI couldn't complete the job.
            </p>
          </div>
        )}
      </div>

      {result.status === "success" && !saveConfirmPending && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onSaveRequest}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isSaving ? "Saving…" : "Use this photo"}
        </Button>
      )}

      {result.status === "success" && saveConfirmPending && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground text-center">
            This replaces the current photo permanently.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-muted-foreground"
              onClick={onSaveCancel}
            >
              Cancel
            </Button>
            <Button size="sm" className="flex-1" onClick={onSaveConfirm}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Confirm
            </Button>
          </div>
        </div>
      )}

      {result.status === "loading" && (
        <p className="text-center text-xs text-muted-foreground">
          Up to a minute…
        </p>
      )}
    </div>
  );
}

function ZoomHint() {
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] text-white/80">
      <ZoomIn className="h-3 w-3" />
      Click to zoom
    </div>
  );
}
