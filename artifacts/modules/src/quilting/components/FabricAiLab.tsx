import { useRef, useState, useEffect, useCallback } from "react";
import {
  Wand2,
  Eraser,
  Trash2,
  Loader2,
  CheckCircle,
  Crown,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Brush,
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

  function pointerPos(e: React.PointerEvent): { x: number; y: number } {
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

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    syncCanvasSize();
    draw(...(Object.values(pointerPos(e)) as [number, number]));
  }

  function handlePointerMove(e: React.PointerEvent) {
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

  function loadMaskFromDataUrl(maskDataUrl: string) {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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
          if ((data.creasesFound ?? 0) === 0)
            toast.info(
              "No creases detected — you can paint the mask manually.",
            );
          else
            toast.success(
              `${data.creasesFound} crease${data.creasesFound === 1 ? "" : "s"} detected.`,
            );
        },
        onError: (err) => {
          toast.error("Detection failed. Try painting the mask manually.");
          console.error(err);
        },
      },
    );
  }

  function handleRemoveCreases() {
    const maskDataUrl = getMaskDataUrl();
    if (!maskDataUrl) return;

    setOpenaiResult({ status: "loading" });
    setReplResult({ status: "loading" });

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
            err instanceof Error ? err.message : "OpenAI inpainting failed";
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
            err instanceof Error ? err.message : "Replicate inpainting failed";
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
      toast.success("Primary photo updated.");
    } catch (err) {
      toast.error("Failed to save photo. Try again.");
      console.error(err);
    } finally {
      setSavingFor(null);
    }
  }

  const isRunning =
    openaiResult.status === "loading" || replResult.status === "loading";

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        className="flex w-full items-center justify-between p-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI Lab — Crease Removal
          </span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-card-border p-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Paint over creases on the fabric photo, or let AI detect them
            automatically. Then run crease removal to generate two AI-inpainted
            versions.
          </p>

          {/* ── Controls ── */}
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
              Auto-detect creases
            </Button>

            <div className="flex items-center gap-1">
              <button
                title="Paint mode"
                onClick={() => setEraseMode(false)}
                className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${!eraseMode ? "border-primary bg-primary/10 text-primary" : "border-card-border text-muted-foreground hover:bg-muted/60"}`}
              >
                <Brush className="h-4 w-4" />
              </button>
              <button
                title="Erase mode"
                onClick={() => setEraseMode(true)}
                className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${eraseMode ? "border-primary bg-primary/10 text-primary" : "border-card-border text-muted-foreground hover:bg-muted/60"}`}
              >
                <Eraser className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              {BRUSH_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setBrushSize(s)}
                  title={`Brush size ${s}px`}
                  className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${brushSize === s ? "border-primary bg-primary/10" : "border-card-border hover:bg-muted/60"}`}
                >
                  <span
                    className="rounded-full bg-foreground"
                    style={{
                      width: Math.max(4, s / 4),
                      height: Math.max(4, s / 4),
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
              Clear
            </Button>
          </div>

          {/* ── Canvas ── */}
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
              {detectDesc}
            </p>
          )}

          {/* ── Run button ── */}
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
            {isRunning ? "Removing creases…" : "Remove creases"}
          </Button>

          {/* ── Results ── */}
          {(openaiResult.status !== "idle" || replResult.status !== "idle") && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ResultPanel
                title="Original"
                imageUrl={imageUrl}
                status="success"
                onSave={null}
                savingFor={null}
              />
              <ResultPanel
                title="GPT Image (OpenAI)"
                result={openaiResult}
                onSave={() => handleSave("openai")}
                savingFor={savingFor === "openai"}
              />
              <ResultPanel
                title="FLUX Fill (Replicate)"
                result={replResult}
                onSave={() => handleSave("replicate")}
                savingFor={savingFor === "replicate"}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type OriginalPanelProps = {
  title: string;
  imageUrl: string;
  status: "success";
  onSave: null;
  savingFor: null;
};

type AiPanelProps = {
  title: string;
  result: ProviderResult;
  onSave: () => void;
  savingFor: boolean;
};

function ResultPanel(props: OriginalPanelProps | AiPanelProps) {
  const isOriginal =
    "imageUrl" in props &&
    props.imageUrl !== undefined &&
    props.onSave === null;

  if (isOriginal) {
    const p = props as OriginalPanelProps;
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">{p.title}</p>
        <div className="aspect-square w-full overflow-hidden rounded-xl border border-card-border bg-muted">
          <img
            src={p.imageUrl}
            alt={p.title}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    );
  }

  const p = props as AiPanelProps;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{p.title}</p>
      <div className="aspect-square w-full overflow-hidden rounded-xl border border-card-border bg-muted flex items-center justify-center">
        {p.result.status === "loading" && (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/60" />
        )}
        {p.result.status === "success" && (
          <img
            src={p.result.dataUrl}
            alt={p.title}
            className="h-full w-full object-cover"
          />
        )}
        {p.result.status === "error" && (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <AlertCircle className="h-6 w-6 text-destructive/70" />
            <p className="text-xs text-destructive/70">{p.result.message}</p>
          </div>
        )}
        {p.result.status === "idle" && null}
      </div>
      {p.result.status === "success" && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={p.onSave}
          disabled={p.savingFor}
        >
          {p.savingFor ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Crown className="mr-1.5 h-3.5 w-3.5" />
          )}
          {p.savingFor ? "Saving…" : "Save as primary photo"}
        </Button>
      )}
      {p.result.status === "error" && (
        <div className="flex items-center gap-1 text-xs text-destructive/70">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Failed
        </div>
      )}
      {p.result.status === "loading" && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running — this may take up to a minute…
        </div>
      )}
    </div>
  );
}
