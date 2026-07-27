import { useRef, useState, useEffect, useCallback } from "react";
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
  const [saveConfirm, setSaveConfirm] = useState<"openai" | "replicate" | null>(
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
          if ((data.creasesFound ?? 0) === 0) {
            toast.info(
              "No creases found automatically — try painting them manually.",
            );
          } else {
            toast.success(
              `Found ${data.creasesFound} crease${data.creasesFound === 1 ? "" : "s"} — purple areas are highlighted. Adjust by painting before running.`,
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
              <strong>Auto-detect</strong> to let AI take a first pass — then
              touch up manually if needed. Auto-detect works best on
              plain-coloured fabrics; busy patterns may need manual painting.
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
              <div className="flex items-center gap-1 rounded-lg border border-card-border p-0.5">
                <button
                  title="Paint — mark creases"
                  onClick={() => setEraseMode(false)}
                  className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors ${!eraseMode ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/60"}`}
                >
                  <Brush className="h-3.5 w-3.5" />
                  Paint
                </button>
                <button
                  title="Erase — unmark areas"
                  onClick={() => setEraseMode(true)}
                  className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors ${eraseMode ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/60"}`}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  Erase
                </button>
              </div>

              {/* Brush size */}
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
                Clear
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
              Two different AIs will each try to smooth the purple-marked areas
              while preserving the rest of the fabric. Both run at the same time
              — takes about a minute.
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
                Compare the two AI versions side-by-side with the original.
                Click <strong>Use this photo</strong> on the one you prefer — it
                will replace the current fabric photo. The AI versions are only
                saved if you choose one.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ResultPanel
                  title="Original"
                  subtitle="Unchanged"
                  imageUrl={imageUrl}
                  isOriginal
                />
                <ResultPanel
                  title="Version A"
                  subtitle="OpenAI GPT-Image"
                  result={openaiResult}
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
  );
}

// ── Supporting components ──────────────────────────────────────────────────

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
};

type AiPanelProps = {
  title: string;
  subtitle: string;
  result: ProviderResult;
  onSaveRequest: () => void;
  onSaveConfirm: () => void;
  onSaveCancel: () => void;
  saveConfirmPending: boolean;
  isSaving: boolean;
};

function ResultPanel(props: OriginalPanelProps | AiPanelProps) {
  if ("isOriginal" in props) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-medium">{props.title}</p>
          <p className="text-xs text-muted-foreground">{props.subtitle}</p>
        </div>
        <div className="aspect-square w-full overflow-hidden rounded-xl border border-card-border bg-muted">
          <img
            src={props.imageUrl}
            alt={props.title}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    );
  }

  const {
    title,
    subtitle,
    result,
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
      <div className="aspect-square w-full overflow-hidden rounded-xl border border-card-border bg-muted flex items-center justify-center">
        {result.status === "loading" && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-xs">Working…</p>
          </div>
        )}
        {result.status === "success" && (
          <img
            src={result.dataUrl}
            alt={title}
            className="h-full w-full object-cover"
          />
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
