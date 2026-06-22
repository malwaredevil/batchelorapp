import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  FlipHorizontal2,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  Upload,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

// ---------------------------------------------------------------------------
// CameraModal — full-screen viewfinder with zoom, flash, and flip controls
// ---------------------------------------------------------------------------

interface CameraModalProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export function CameraModal({ onCapture, onClose }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(5);
  const [hwZoom, setHwZoom] = useState(false); // device supports hardware zoom
  const [flashOn, setFlashOn] = useState(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [switching, setSwitching] = useState(false);

  /** Live values for pinch handlers (avoids stale closures). */
  const liveRef = useRef({ zoom, maxZoom });
  useEffect(() => {
    liveRef.current = { zoom, maxZoom };
  });

  /** Active pointer positions for pinch detection. */
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  /** State captured at pinch start. */
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setSwitching(true);
    setReady(false);
    setError(null);

    async function start() {
      // Stop any existing stream first
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Your browser doesn't support in-app camera. Use Upload instead.",
        );
        setSwitching(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 4096 },
            height: { ideal: 3072 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        // Probe capabilities
        const track = stream.getVideoTracks()[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const caps = (track.getCapabilities?.() ?? {}) as any;
        if (caps.zoom) {
          setHwZoom(true);
          setMaxZoom(Math.min(caps.zoom.max ?? 5, 10));
        } else {
          setHwZoom(false);
          setMaxZoom(5);
        }
        setHasFlash(!!caps.torch);
        setFlashOn(false);
        setZoom(1);
      } catch {
        if (!cancelled) {
          setError(
            "Couldn't access the camera — check permissions, then try again or use Upload.",
          );
        }
      } finally {
        if (!cancelled) setSwitching(false);
      }
    }

    start().catch(() => {});
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  async function applyZoom(newZoom: number) {
    setZoom(newZoom);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    if (hwZoom) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await track.applyConstraints({ advanced: [{ zoom: newZoom } as any] });
      } catch {
        /* ignore — will fall back to CSS */
      }
    }
  }

  async function toggleFlash() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !hasFlash) return;
    const next = !flashOn;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setFlashOn(next);
    } catch {
      /* torch not supported on this device */
    }
  }

  function snap() {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    // Mirror the frame for front-facing camera to match preview
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    // Apply digital zoom by cropping the centre
    const cssZoom = hwZoom ? 1 : zoom;
    if (cssZoom > 1) {
      const sw = canvas.width / cssZoom;
      const sh = canvas.height / cssZoom;
      const sx = (canvas.width - sw) / 2;
      const sy = (canvas.height - sh) / 2;
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      tmp.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(tmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(video, 0, 0);
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        onCapture(
          new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
      },
      "image/jpeg",
      0.95,
    );
  }

  function handleClose() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  }

  // ---------------------------------------------------------------------------
  // Pinch-to-zoom handlers (viewfinder)
  // ---------------------------------------------------------------------------
  function onViewfinderPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchRef.current = { startDist: dist, startZoom: liveRef.current.zoom };
    }
  }

  function onViewfinderPointerMove(e: React.PointerEvent) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (!pinch || pointersRef.current.size < 2) return;
    const pts = [...pointersRef.current.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const newZoom = Math.min(
      Math.max(1, pinch.startZoom * (dist / pinch.startDist)),
      liveRef.current.maxZoom,
    );
    void applyZoom(newZoom);
  }

  function onViewfinderPointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  }

  // CSS-based digital zoom (used when hardware zoom not available)
  const cssScale = hwZoom ? 1 : zoom;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close camera"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium text-white/80">Take a photo</span>
        <button
          type="button"
          onClick={toggleFlash}
          aria-label="Toggle flash"
          className={cn(
            "grid h-10 w-10 place-items-center rounded-full text-white transition",
            hasFlash
              ? "bg-white/15 hover:bg-white/25"
              : "opacity-30 cursor-default",
          )}
          disabled={!hasFlash}
        >
          {flashOn ? (
            <Zap className="h-5 w-5 text-yellow-300" />
          ) : (
            <ZapOff className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Viewfinder — touch-none prevents page zoom; pinch handlers manage zoom */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden bg-black touch-none"
        onPointerDown={onViewfinderPointerDown}
        onPointerMove={onViewfinderPointerMove}
        onPointerUp={onViewfinderPointerUp}
        onPointerCancel={onViewfinderPointerUp}
      >
        {error ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <CameraOff className="h-10 w-10 text-white/30" />
            <p className="max-w-xs text-sm leading-relaxed text-white/60">
              {error}
            </p>
          </div>
        ) : (
          <>
            {(switching || !ready) && (
              <Loader2 className="absolute h-8 w-8 animate-spin text-white/40" />
            )}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onCanPlay={() => setReady(true)}
              className={cn(
                "h-full w-full object-cover transition-opacity duration-300",
                ready && !switching ? "opacity-100" : "opacity-0",
              )}
              style={{
                transform:
                  [
                    facing === "user" ? "scaleX(-1)" : "",
                    cssScale > 1 ? `scale(${cssScale})` : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined,
                transformOrigin: "center center",
              }}
            />
          </>
        )}
      </div>

      {/* Zoom slider */}
      <div className="flex items-center gap-3 px-6 pb-2 pt-3">
        <button
          type="button"
          onClick={() => applyZoom(Math.max(1, zoom - 0.5))}
          className="text-white/50 hover:text-white transition"
        >
          <Minus className="h-4 w-4" />
        </button>
        <Slider
          min={1}
          max={maxZoom}
          step={0.1}
          value={[zoom]}
          onValueChange={([v]) => applyZoom(v)}
          className="flex-1 [&_[role=slider]]:bg-white"
          disabled={!!error}
        />
        <button
          type="button"
          onClick={() => applyZoom(Math.min(maxZoom, zoom + 0.5))}
          className="text-white/50 hover:text-white transition"
        >
          <Plus className="h-4 w-4" />
        </button>
        <span className="w-10 text-right text-xs text-white/50">
          {zoom.toFixed(1)}×
        </span>
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-between px-8 pb-10 pt-2">
        {/* Flip camera */}
        <button
          type="button"
          onClick={() =>
            setFacing((f) => (f === "environment" ? "user" : "environment"))
          }
          className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
          aria-label="Switch camera"
        >
          <FlipHorizontal2 className="h-6 w-6" />
        </button>

        {/* Shutter */}
        <button
          type="button"
          onClick={snap}
          disabled={!ready || !!error || switching}
          aria-label="Snap photo"
          data-testid="button-snap"
          className={cn(
            "relative h-20 w-20 rounded-full border-4 border-white/40 bg-transparent p-2 shadow-lg transition",
            "hover:border-white/70 active:scale-95 disabled:opacity-30",
          )}
        >
          <span className="block h-full w-full rounded-full bg-white" />
        </button>

        {/* Spacer to balance the flip button */}
        <div className="h-12 w-12" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImagePicker — two-option picker with preview
// ---------------------------------------------------------------------------

interface ImagePickerProps {
  file: File | null;
  onSelect: (file: File | null) => void;
  disabled?: boolean;
}

export function ImagePicker({ file, onSelect, disabled }: ImagePickerProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    onSelect(e.target.files?.[0] ?? null);
    if (e.target) e.target.value = "";
  }

  function handleCapture(captured: File) {
    setShowCamera(false);
    onSelect(captured);
  }

  return (
    <>
      {showCamera && (
        <CameraModal
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
        data-testid="input-image"
      />

      <div className="w-full">
        {preview ? (
          <div>
            <div className="relative overflow-hidden rounded-xl border border-card-border bg-muted">
              <img
                src={preview}
                alt="Selected image"
                className="aspect-square w-full object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur transition hover:bg-background"
                  aria-label="Remove photo"
                  data-testid="button-clear-image"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {!disabled && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  className="flex items-center justify-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted"
                  data-testid="button-retake"
                >
                  <Camera className="h-4 w-4" />
                  Retake photo
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted"
                  data-testid="button-change-image"
                >
                  <Upload className="h-4 w-4" />
                  Upload file
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-card-border bg-muted/40 py-9 text-muted-foreground transition",
                "hover:border-primary/50 hover:bg-muted/70 disabled:opacity-50",
              )}
              data-testid="button-open-camera"
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-background shadow-sm">
                <Camera className="h-5 w-5 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  Take photo
                </p>
                <p className="text-xs">Use your camera</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-card-border bg-muted/40 py-9 text-muted-foreground transition",
                "hover:border-primary/50 hover:bg-muted/70 disabled:opacity-50",
              )}
              data-testid="button-pick-image"
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-background shadow-sm">
                <ImagePlus className="h-5 w-5 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  Upload file
                </p>
                <p className="text-xs">Choose a photo</p>
              </div>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
