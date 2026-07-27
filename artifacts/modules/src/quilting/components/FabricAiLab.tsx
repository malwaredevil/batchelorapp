import {
  useRef,
  useState,
  useEffect,
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
  Move,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useLabDetectCreases,
  useLabRemoveCreasesOpenai,
  getGetFabricQueryKey,
  getListFabricsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = { fabricId: number; imageUrl: string };

type ProviderResult =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; dataUrl: string }
  | { status: "error"; message: string };

type LightboxState = { src: string; title: string } | null;

type DrawMode = "paint" | "erase" | "pan";

type DetectedCrease = {
  x1Pct: number;
  y1Pct: number;
  x2Pct: number;
  y2Pct: number;
  widthPct: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BRUSH_SIZES = [8, 16, 32, 56];
const DEFAULT_BRUSH_IDX = 1;
const PAINT_COLOR = "rgba(180, 0, 255, 0.72)";
const MIN_SCALE = 0.4;
const MAX_SCALE = 10;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FabricAiLab({ fabricId, imageUrl }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Refs
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null); // scroll-wheel + overflow:hidden
  const innerRef = useRef<HTMLDivElement>(null); // CSS-transformed wrapper

  // Drawing state
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 }); // for pan drag delta
  const [drawMode, setDrawMode] = useState<DrawMode>("paint");
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[DEFAULT_BRUSH_IDX]);
  const [canvasPainted, setCanvasPainted] = useState(false);
  const [detectedCreases, setDetectedCreases] = useState<DetectedCrease[]>([]);

  // View transform (zoom + pan on the drawing canvas)
  const [viewScale, setViewScale] = useState(1);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });

  // Results
  const [detectDesc, setDetectDesc] = useState<string | null>(null);
  const [openaiResult, setOpenaiResult] = useState<ProviderResult>({
    status: "idle",
  });
  const [savingFor, setSavingFor] = useState(false);
  const [saveConfirm, setSaveConfirm] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  const detectMutation = useLabDetectCreases();
  const openaiMutation = useLabRemoveCreasesOpenai();

  // ---------------------------------------------------------------------------
  // Canvas helpers
  // ---------------------------------------------------------------------------

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
    ro.observe(img);
    return () => {
      img.removeEventListener("load", syncCanvasSize);
      ro.disconnect();
    };
  }, [open]);

  // Escape closes lightbox
  useEffect(() => {
    if (!lightbox) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lightbox]);

  // ---------------------------------------------------------------------------
  // Coordinate mapping: screen px → canvas logical px
  // getBoundingClientRect() accounts for CSS transforms, so dividing by the
  // displayed rect size gives us the correct canvas-space coordinate.
  // ---------------------------------------------------------------------------

  function canvasCoord(e: ReactPointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  // ---------------------------------------------------------------------------
  // Zoom (scroll wheel on the outer container)
  // Zoom is centered on the cursor position.
  // ---------------------------------------------------------------------------

  function handleOuterWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const outerEl = outerRef.current;
    if (!outerEl) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setViewScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
      const outerRect = outerEl.getBoundingClientRect();
      const cx = e.clientX - outerRect.left;
      const cy = e.clientY - outerRect.top;
      // Keep the point under the cursor fixed
      setViewOffset((o) => ({
        x: cx - (cx - o.x) * (next / prev),
        y: cy - (cy - o.y) * (next / prev),
      }));
      return next;
    });
  }

  function resetView() {
    setViewScale(1);
    setViewOffset({ x: 0, y: 0 });
  }

  // ---------------------------------------------------------------------------
  // Pointer handlers (paint / erase / pan)
  // ---------------------------------------------------------------------------

  function paint(x: number, y: number) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (drawMode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = PAINT_COLOR;
    }
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    setCanvasPainted(true);
  }

  function handlePointerDown(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (drawMode === "pan") {
      lastPos.current = { x: e.clientX, y: e.clientY };
    } else {
      syncCanvasSize();
      paint(canvasCoord(e).x, canvasCoord(e).y);
    }
    isDrawing.current = true;
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!isDrawing.current) return;
    if (drawMode === "pan") {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setViewOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    } else {
      const { x, y } = canvasCoord(e);
      paint(x, y);
    }
  }

  function handlePointerUp() {
    isDrawing.current = false;
  }

  // ---------------------------------------------------------------------------
  // Mask operations
  // ---------------------------------------------------------------------------

  function clearMask() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setCanvasPainted(false);
    setDetectedCreases([]);
    setDetectDesc(null);
    setOpenaiResult({ status: "idle" });
  }

  function removeDetectedCrease(index: number) {
    const crease = detectedCreases[index];
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !crease) return;
    const minDim = Math.min(canvas.width, canvas.height);
    const sw = Math.max(6, (crease.widthPct / 100) * minDim) + 10; // +10px margin
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = sw;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.beginPath();
    ctx.moveTo(
      (crease.x1Pct / 100) * canvas.width,
      (crease.y1Pct / 100) * canvas.height,
    );
    ctx.lineTo(
      (crease.x2Pct / 100) * canvas.width,
      (crease.y2Pct / 100) * canvas.height,
    );
    ctx.stroke();
    ctx.restore();
    setDetectedCreases((prev) => prev.filter((_, i) => i !== index));
  }

  function getMaskDataUrl(): string | null {
    return canvasRef.current?.toDataURL("image/png") ?? null;
  }

  // Server returns white-on-transparent mask; tint to purple for visual
  // consistency with manually-painted marks (and so Erase works on it).
  function loadMaskFromDataUrl(maskDataUrl: string) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = PAINT_COLOR;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      setCanvasPainted(true);
    };
    img.src = maskDataUrl;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function handleAutoDetect() {
    setDetectDesc(null);
    detectMutation.mutate(
      { data: { fabricId } },
      {
        onSuccess: (rawData) => {
          // Cast to include the `creases` array the server now returns
          const data = rawData as typeof rawData & {
            creases?: DetectedCrease[];
          };
          setDetectDesc(data.description ?? null);
          if (data.maskDataUrl) loadMaskFromDataUrl(data.maskDataUrl);
          if (data.creases?.length) {
            setDetectedCreases(data.creases);
          }
          if ((data.creasesFound ?? 0) === 0) {
            toast.info(
              "No creases found automatically — try painting them manually.",
            );
          } else {
            toast.success(
              `Found ${data.creasesFound} crease${data.creasesFound === 1 ? "" : "s"} — click ✕ on any chip below to remove one, or use Erase to paint over it.`,
            );
          }
        },
        onError: () =>
          toast.error("Auto-detect failed. Try painting the creases manually."),
      },
    );
  }

  function handleRemoveCreases() {
    const maskDataUrl = getMaskDataUrl();
    if (!maskDataUrl) return;
    setOpenaiResult({ status: "loading" });
    setSaveConfirm(false);

    openaiMutation.mutate(
      { data: { fabricId, maskDataUrl } },
      {
        onSuccess: (d) =>
          setOpenaiResult(
            d.dataUrl
              ? { status: "success", dataUrl: d.dataUrl }
              : { status: "error", message: "No image returned" },
          ),
        onError: (err) =>
          setOpenaiResult({
            status: "error",
            message:
              err instanceof Error ? err.message : "This AI couldn't run",
          }),
      },
    );
  }

  async function handleSave() {
    const dataUrl = (openaiResult as { status: "success"; dataUrl: string })
      .dataUrl;
    if (!dataUrl) return;
    setSavingFor(true);
    setSaveConfirm(false);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const form = new FormData();
      form.append("image", blob, "fabric-photo.png");
      // raw-fetch-ok: PUT /fabrics/:id/image (replace primary image) has no generated hook — route not in OpenAPI spec
      const r = await fetch(`/api/quilting/fabrics/${fabricId}/image`, {
        method: "PUT",
        body: form,
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
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
      setSavingFor(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const hasMask = canvasPainted || detectedCreases.length > 0;

  const isRunning = openaiResult.status === "loading";
  const hasResults = openaiResult.status !== "idle";

  const cursorStyle =
    drawMode === "pan"
      ? isDrawing.current
        ? "grabbing"
        : "grab"
      : drawMode === "erase"
        ? "cell"
        : "crosshair";

  const scalePct = Math.round(viewScale * 100);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
                Paint purple over any physical fold lines or wrinkles. Use{" "}
                <strong>Auto-detect</strong> to let AI take a first pass, then
                refine. <strong>Scroll</strong> to zoom in for precision.{" "}
                <strong>Pan</strong> to move around while zoomed.
              </p>

              {/* ── Toolbar ── */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Auto-detect */}
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

                {/* Paint | Erase | Pan pill toggle */}
                <div className="flex items-center rounded-lg border border-card-border overflow-hidden">
                  <ModeButton
                    active={drawMode === "paint"}
                    onClick={() => setDrawMode("paint")}
                    icon={<Brush className="h-3.5 w-3.5" />}
                    label="Paint"
                  />
                  <ModeButton
                    active={drawMode === "erase"}
                    onClick={() => setDrawMode("erase")}
                    icon={<Eraser className="h-3.5 w-3.5" />}
                    label="Erase"
                  />
                  <ModeButton
                    active={drawMode === "pan"}
                    onClick={() => setDrawMode("pan")}
                    icon={<Move className="h-3.5 w-3.5" />}
                    label="Pan"
                  />
                </div>

                {/* Brush size (hidden in pan mode) */}
                {drawMode !== "pan" && (
                  <div className="flex items-center gap-1">
                    {BRUSH_SIZES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setBrushSize(s)}
                        title={`Brush ${s}px`}
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
                )}

                {/* Zoom controls */}
                <div className="flex items-center gap-1 rounded-lg border border-card-border overflow-hidden">
                  <button
                    onClick={() =>
                      setViewScale((s) => Math.max(MIN_SCALE, s / 1.3))
                    }
                    className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[3rem] text-center text-xs text-muted-foreground">
                    {scalePct}%
                  </span>
                  <button
                    onClick={() =>
                      setViewScale((s) => Math.min(MAX_SCALE, s * 1.3))
                    }
                    className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors"
                    title="Zoom in"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={resetView}
                    className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors"
                    title="Reset view"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
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

              {/* ── Zoomable drawing canvas ── */}
              {/*
                outerRef: overflow-hidden container, receives scroll events
                innerRef: CSS-transformed layer (image + canvas overlay)
                The canvas getBoundingClientRect() accounts for the CSS transform,
                so canvasCoord() maps correctly at any zoom level.
              */}
              <div
                ref={outerRef}
                className="relative w-full overflow-hidden rounded-xl border border-card-border bg-muted select-none"
                style={{ height: "22rem", touchAction: "none" }}
                onWheel={handleOuterWheel}
              >
                <div
                  ref={innerRef}
                  style={{
                    transformOrigin: "0 0",
                    transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewScale})`,
                    // Size the inner layer to fill the outer at scale=1
                    position: "absolute",
                    inset: 0,
                  }}
                >
                  <img
                    ref={imgRef}
                    src={imageUrl}
                    alt="Fabric"
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0"
                    style={{
                      cursor: cursorStyle,
                      touchAction: "none",
                    }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                  />
                </div>

                {/* Floating zoom hint */}
                <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/40 px-2 py-1 text-[10px] text-white/80">
                  Scroll to zoom · Pan mode to drag
                </div>
              </div>

              {detectDesc && (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground italic">
                  AI detected: {detectDesc}
                </p>
              )}

              {detectedCreases.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground shrink-0">
                    Detected:
                  </span>
                  {detectedCreases.map((c, idx) => (
                    <button
                      key={idx}
                      onClick={() => removeDetectedCrease(idx)}
                      title="Click to remove this detected crease from the mask"
                      className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    >
                      {((): string => {
                        const dx = Math.abs(c.x2Pct - c.x1Pct);
                        const dy = Math.abs(c.y2Pct - c.y1Pct);
                        const vert = dy > dx;
                        const mid = vert
                          ? Math.round((c.x1Pct + c.x2Pct) / 2)
                          : Math.round((c.y1Pct + c.y2Pct) / 2);
                        return vert
                          ? `↕ Vertical ~${mid}%`
                          : `↔ Horizontal ~${mid}%`;
                      })()}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* ── Step 2 ── */}
            <section className="space-y-2">
              <StepHeading number={2} label="Generate fixes" />
              <p className="text-xs text-muted-foreground">
                Two different AIs try to smooth the marked areas while
                preserving the rest. Both run simultaneously — takes about a
                minute.
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
                  Click any image to zoom and inspect. Choose{" "}
                  <strong>Use this photo</strong> to replace the current fabric
                  photo.
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
                    title="Result"
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
                              title: "Result — OpenAI",
                            })
                        : null
                    }
                    onSaveRequest={() => setSaveConfirm(true)}
                    onSaveConfirm={() => handleSave()}
                    saveConfirmPending={saveConfirm}
                    isSaving={savingFor}
                    onSaveCancel={() => setSaveConfirm(false)}
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

// ---------------------------------------------------------------------------
// Zoom/Pan Lightbox (for reviewing results)
// ---------------------------------------------------------------------------

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
    setOffset((o) => ({
      x: o.x + e.clientX - lastPos.current.x,
      y: o.y + e.clientY - lastPos.current.y,
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp() {
    dragging.current = false;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50">
            Scroll to zoom · Drag to pan
          </span>
          <button
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted/60"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

const IMG_CONTAINER =
  "group relative h-72 w-full overflow-hidden rounded-xl border border-card-border bg-muted flex items-center justify-center";

function ResultPanel(
  props:
    | {
        title: string;
        subtitle: string;
        imageUrl: string;
        isOriginal: true;
        onZoom: () => void;
      }
    | {
        title: string;
        subtitle: string;
        result: ProviderResult;
        onZoom: (() => void) | null;
        onSaveRequest: () => void;
        onSaveConfirm: () => void;
        onSaveCancel: () => void;
        saveConfirmPending: boolean;
        isSaving: boolean;
      },
) {
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
    <>
      {/* Full-frame hover overlay */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 bg-black/25">
        <div className="flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
          <ZoomIn className="h-3.5 w-3.5" />
          Click to zoom
        </div>
      </div>
      {/* Persistent corner badge */}
      <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] text-white/70">
        <ZoomIn className="h-3 w-3" />
      </div>
    </>
  );
}
