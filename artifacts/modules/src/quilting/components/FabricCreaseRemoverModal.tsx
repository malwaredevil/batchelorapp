import {
  useState,
  useEffect,
  useRef,
  type WheelEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  X,
  Brush,
  Eraser,
  Move,
  Trash2,
  Wand2,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ImagePlus,
  Check,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useLabDetectCreases,
  useLabRemoveCreasesOpenai,
  useAddFabricImage,
  useSetFabricImageDefault,
  getGetFabricQueryKey,
  getListFabricsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@workspace/web-core/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DrawMode = "paint" | "erase" | "pan";
type Step = "draw" | "result";

interface DetectedCrease {
  x1Pct: number;
  y1Pct: number;
  x2Pct: number;
  y2Pct: number;
  widthPct: number;
}

interface ZoomPanState {
  scale: number;
  offset: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BRUSH_SIZES = [8, 16, 32, 56];
const DEFAULT_BRUSH_IDX = 1;
const PAINT_COLOR = "rgba(180, 0, 255, 0.72)";
const MIN_SCALE = 0.4;
const MAX_SCALE = 10;

// ---------------------------------------------------------------------------
// ZoomPan hook — shared by the result-step panels
// ---------------------------------------------------------------------------

function useZoomPan() {
  const outerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ZoomPanState>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setState((prev) => {
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, prev.scale * factor),
      );
      const rect = outerRef.current?.getBoundingClientRect();
      if (!rect) return { scale: next, offset: prev.offset };
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return {
        scale: next,
        offset: {
          x: cx - (cx - prev.offset.x) * (next / prev.scale),
          y: cy - (cy - prev.offset.y) * (next / prev.scale),
        },
      };
    });
  }

  function handlePointerDown(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setState((prev) => ({
      ...prev,
      offset: { x: prev.offset.x + dx, y: prev.offset.y + dy },
    }));
  }

  function handlePointerUp() {
    isDragging.current = false;
  }

  function reset() {
    setState({ scale: 1, offset: { x: 0, y: 0 } });
  }

  return {
    outerRef,
    state,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    reset,
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  fabricId: number;
  fabricName: string;
  imageUrl: string;
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FabricCreaseRemoverModal({
  fabricId,
  fabricName,
  imageUrl,
  open,
  onClose,
}: Props) {
  const queryClient = useQueryClient();

  // Canvas refs
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Step
  const [step, setStep] = useState<Step>("draw");

  // Draw mode
  const [drawMode, setDrawMode] = useState<DrawMode>("paint");
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[DEFAULT_BRUSH_IDX]);
  const [canvasPainted, setCanvasPainted] = useState(false);
  const [detectedCreases, setDetectedCreases] = useState<DetectedCrease[]>([]);

  // Draw-step zoom/pan
  const [viewScale, setViewScale] = useState(1);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });

  // Result
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null);

  // Result-step zoom/pan for each panel
  const leftPanel = useZoomPan();
  const rightPanel = useZoomPan();

  // Saving
  const [saving, setSaving] = useState(false);

  // Mutations
  const detectMutation = useLabDetectCreases();
  const openaiMutation = useLabRemoveCreasesOpenai();
  const addImageMutation = useAddFabricImage();
  const setDefaultMutation = useSetFabricImageDefault();

  // ---------------------------------------------------------------------------
  // Reset when modal opens/closes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open) return;
    setStep("draw");
    setDrawMode("paint");
    setBrushSize(BRUSH_SIZES[DEFAULT_BRUSH_IDX]);
    setCanvasPainted(false);
    setDetectedCreases([]);
    setViewScale(1);
    setViewOffset({ x: 0, y: 0 });
    setResultDataUrl(null);
  }, [open]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

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
  // Zoom/pan for draw step
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
  // Drawing
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
      paint(canvasCoord(e).x, canvasCoord(e).y);
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
  }

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

  function getMaskDataUrl(): string | null {
    return canvasRef.current?.toDataURL("image/png") ?? null;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function handleDetectCreases() {
    detectMutation.mutate(
      { data: { fabricId } },
      {
        onSuccess: (rawData) => {
          const data = rawData as typeof rawData & {
            creases?: DetectedCrease[];
          };
          if (data.maskDataUrl) loadMaskFromDataUrl(data.maskDataUrl);
          if (data.creases?.length) setDetectedCreases(data.creases);
          if ((data.creasesFound ?? 0) === 0) {
            toast.info(
              "No creases detected automatically. Paint them manually below.",
            );
          } else {
            toast.success(
              `Detected ${data.creasesFound} crease${data.creasesFound === 1 ? "" : "s"}. Adjust with the brush, then press AI Enhance.`,
            );
          }
        },
        onError: () =>
          toast.error("Auto-detect failed. Try painting the creases manually."),
      },
    );
  }

  function handleRemoveCreases() {
    // Send the current canvas as the inpainting mask. A transparent canvas
    // (nothing detected, nothing painted) tells gpt-image-2 to apply
    // prompt-guided smoothing across the whole image rather than inpainting
    // specific areas — this removes creases while largely preserving the pattern.
    // If detection ran and found creases, the canvas has those marks and
    // gpt-image-2 targets only those bands (better result when it works).
    const maskDataUrl =
      getMaskDataUrl() ??
      // Fallback 1×1 transparent PNG in case canvas ref isn't mounted yet.
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    openaiMutation.mutate(
      { data: { fabricId, maskDataUrl } },
      {
        onSuccess: (d) => {
          if (d.dataUrl) {
            setResultDataUrl(d.dataUrl);
            leftPanel.reset();
            rightPanel.reset();
            setStep("result");
          } else {
            toast.error("No image returned from AI — please try again.");
          }
        },
        onError: (err) => {
          // Extract the server's error message (e.g. "No creases detected…")
          // from the axios response body when available.
          const serverMsg = (
            err as { response?: { data?: { error?: string } } }
          ).response?.data?.error;
          toast.error(
            serverMsg ??
              (err instanceof Error ? err.message : "AI removal failed."),
          );
        },
      },
    );
  }

  async function handleSave(setDefault: boolean) {
    if (!resultDataUrl) return;
    setSaving(true);
    try {
      const blob = await (await fetch(resultDataUrl)).blob();
      const imageFile = new File([blob], "crease-removed.png", {
        type: "image/png",
      });
      const uploaded = await addImageMutation.mutateAsync({
        id: fabricId,
        data: { image: imageFile },
      });

      if (setDefault) {
        const updatedFabric = await setDefaultMutation.mutateAsync({
          id: fabricId,
          imageId: uploaded.id,
        });
        // Pre-load the new default image into the browser cache before switching
        // the React Query cache. This prevents the partial-load flash that occurs
        // when the image hasn't finished downloading from Supabase yet.
        await new Promise<void>((resolve) => {
          const img = new window.Image();
          img.onload = () => resolve();
          img.onerror = () => resolve(); // Don't block on a fetch error
          img.src = updatedFabric.imageUrl;
        });
        // Now the browser has the image cached — switching the data is instant.
        queryClient.setQueryData(getGetFabricQueryKey(fabricId), updatedFabric);
      } else {
        // Image was added as supplemental only — refetch to get the updated
        // images array (addFabricImage returns just the new image, not the full fabric).
        await queryClient.invalidateQueries({
          queryKey: getGetFabricQueryKey(fabricId),
        });
      }

      // Refresh the fabrics list in the background so gallery thumbnails update.
      void queryClient.invalidateQueries({
        queryKey: getListFabricsQueryKey(),
      });

      toast.success(
        setDefault
          ? "Photo added and set as default."
          : "Photo added to fabric.",
      );
      onClose();
    } catch {
      toast.error("Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleBackToEdit() {
    setStep("draw");
    // Mask is preserved — user can continue editing
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const hasMask = canvasPainted || detectedCreases.length > 0;
  const isRemoving = openaiMutation.isPending;
  const isDetecting = detectMutation.isPending;
  const scalePct = Math.round(viewScale * 100);

  const cursorStyle =
    drawMode === "pan"
      ? isDrawing.current
        ? "grabbing"
        : "grab"
      : drawMode === "erase"
        ? "cell"
        : "crosshair";

  if (!open) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="relative flex h-[94vh] w-full max-w-6xl flex-col rounded-2xl border border-card-border bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-card-border px-5 py-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">
              {step === "draw" ? "AI Enhance" : "Results"} —{" "}
              <span className="text-muted-foreground">{fabricName}</span>
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ----------------------------------------------------------------
            STEP 1: DRAW
        ---------------------------------------------------------------- */}
        {step === "draw" && (
          <>
            {/* Toolbar */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-card-border bg-muted/40 px-4 py-2">
              {/* Draw mode */}
              <div className="flex items-center gap-1 rounded-lg border border-card-border bg-background p-1">
                {(
                  [
                    {
                      mode: "paint" as const,
                      icon: <Brush className="h-3.5 w-3.5" />,
                      label: "Paint",
                    },
                    {
                      mode: "erase" as const,
                      icon: <Eraser className="h-3.5 w-3.5" />,
                      label: "Erase",
                    },
                    {
                      mode: "pan" as const,
                      icon: <Move className="h-3.5 w-3.5" />,
                      label: "Pan",
                    },
                  ] as const
                ).map(({ mode, icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setDrawMode(mode)}
                    title={label}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-xs transition",
                      drawMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {icon}
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>

              {/* Brush size */}
              {drawMode !== "pan" && (
                <div className="flex items-center gap-1">
                  {BRUSH_SIZES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setBrushSize(s)}
                      title={`Brush ${s}px`}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full transition",
                        brushSize === s
                          ? "bg-primary/20 ring-2 ring-primary"
                          : "hover:bg-muted",
                      )}
                    >
                      <span
                        className="rounded-full bg-foreground"
                        style={{
                          width: Math.max(4, s / 5),
                          height: Math.max(4, s / 5),
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Clear */}
              <button
                onClick={clearMask}
                disabled={!hasMask}
                title="Clear all marks"
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40 transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </button>

              {/* Zoom controls */}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => {
                    setViewScale((s) => Math.max(MIN_SCALE, s / 1.15));
                  }}
                  className="rounded p-1 hover:bg-muted"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="w-10 text-center text-xs text-muted-foreground">
                  {scalePct}%
                </span>
                <button
                  onClick={() => {
                    setViewScale((s) => Math.min(MAX_SCALE, s * 1.15));
                  }}
                  className="rounded p-1 hover:bg-muted"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={resetView}
                  className="rounded p-1 hover:bg-muted"
                  title="Reset view"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Canvas area */}
            <div
              ref={outerRef}
              className="relative flex-1 overflow-hidden bg-checkerboard select-none p-4"
              style={{ cursor: cursorStyle }}
              onWheel={handleOuterWheel}
            >
              <div
                ref={innerRef}
                style={{
                  transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewScale})`,
                  transformOrigin: "0 0",
                  display: "inline-block",
                  position: "relative",
                }}
              >
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt={fabricName}
                  draggable={false}
                  className="block max-h-[calc(94vh-160px)] max-w-full object-contain select-none"
                />
                <canvas
                  ref={canvasRef}
                  className="pointer-events-none absolute inset-0"
                  style={{ mixBlendMode: "normal" }}
                />
                {/* Pointer capture overlay */}
                <div
                  className="absolute inset-0"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between border-t border-card-border bg-muted/30 px-5 py-3">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {hasMask
                    ? `${detectedCreases.length > 0 ? `${detectedCreases.length} crease${detectedCreases.length === 1 ? "" : "s"} detected — targeted removal` : "manual marks — ready for targeted removal"}`
                    : "Ready — click AI Enhance to smooth the image, or use Detect Creases first to target specific fold lines"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDetectCreases}
                  disabled={isDetecting || isRemoving}
                >
                  {isDetecting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Detect Creases
                </Button>
                <Button
                  size="sm"
                  onClick={handleRemoveCreases}
                  disabled={isRemoving || isDetecting}
                >
                  {isRemoving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isRemoving ? "Enhancing…" : "AI Enhance →"}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ----------------------------------------------------------------
            STEP 2: RESULT (side-by-side)
        ---------------------------------------------------------------- */}
        {step === "result" && resultDataUrl && (
          <>
            <div className="flex flex-1 overflow-hidden">
              {/* Left panel — Original + mask overlay */}
              <div className="flex flex-1 flex-col border-r border-card-border">
                <div className="shrink-0 border-b border-card-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Original
                </div>
                <div
                  ref={leftPanel.outerRef}
                  className="relative flex-1 overflow-hidden bg-checkerboard cursor-grab select-none"
                  onWheel={leftPanel.handleWheel}
                  onPointerDown={leftPanel.handlePointerDown}
                  onPointerMove={leftPanel.handlePointerMove}
                  onPointerUp={leftPanel.handlePointerUp}
                >
                  <div
                    style={{
                      transform: `translate(${leftPanel.state.offset.x}px, ${leftPanel.state.offset.y}px) scale(${leftPanel.state.scale})`,
                      transformOrigin: "0 0",
                      position: "relative",
                      display: "inline-block",
                    }}
                  >
                    <img
                      src={imageUrl}
                      alt="Original fabric"
                      draggable={false}
                      className="block max-h-[calc(94vh-120px)] max-w-full object-contain select-none"
                    />
                    {/* Mask overlay snapshot */}
                    {canvasRef.current && (
                      <img
                        src={canvasRef.current.toDataURL("image/png")}
                        alt=""
                        aria-hidden
                        draggable={false}
                        className="pointer-events-none absolute inset-0 block h-full w-full select-none"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Right panel — AI Result */}
              <div className="flex flex-1 flex-col">
                <div className="shrink-0 border-b border-card-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  AI Result
                </div>
                <div
                  ref={rightPanel.outerRef}
                  className="relative flex-1 overflow-hidden bg-checkerboard cursor-grab select-none"
                  onWheel={rightPanel.handleWheel}
                  onPointerDown={rightPanel.handlePointerDown}
                  onPointerMove={rightPanel.handlePointerMove}
                  onPointerUp={rightPanel.handlePointerUp}
                >
                  <div
                    style={{
                      transform: `translate(${rightPanel.state.offset.x}px, ${rightPanel.state.offset.y}px) scale(${rightPanel.state.scale})`,
                      transformOrigin: "0 0",
                      display: "inline-block",
                    }}
                  >
                    <img
                      src={resultDataUrl}
                      alt="AI crease-removed result"
                      draggable={false}
                      className="block max-h-[calc(94vh-120px)] max-w-full object-contain select-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between border-t border-card-border bg-muted/30 px-5 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBackToEdit}
                disabled={saving}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Edit Mask
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSave(false)}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Add to item
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSave(true)}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Add + Set as Default
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
