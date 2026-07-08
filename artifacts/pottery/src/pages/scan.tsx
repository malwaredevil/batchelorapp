import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  Camera,
  FlipHorizontal,
  RotateCcw,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import type { PotteryCompareResult as CompareResult } from "@workspace/api-client-react";
import { useUploadCompare } from "@/hooks/use-pottery";
import { VerdictPill, type Verdict } from "@/components/verdict";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePageAssistantContext } from "@/lib/assistant-context";

// ── Verdict helpers (same copy as compare.tsx) ───────────────────────────────

const SAME_PATTERN_COPY: Record<Verdict, string> = {
  yes: "You very likely already own this pattern.",
  maybe: "You may own something with a similar pattern — check below.",
  no: "This pattern looks new to your collection.",
};

const EXACT_PIECE_COPY: Record<Verdict, string> = {
  yes: "This looks like a piece you already have.",
  maybe: "This could be a piece you already have — worth a closer look.",
  no: "This exact piece doesn't appear to be in your collection.",
};

// ── Verdict summary (big card shown immediately after analysis) ───────────────

function VerdictSummary({ result }: { result: CompareResult }) {
  const safe =
    result.ownsExactPiece === "no" && result.ownsSamePattern === "no";
  const likely = result.ownsExactPiece === "yes";

  const bg = likely
    ? "bg-destructive/10 border-destructive/30"
    : safe
      ? "bg-emerald-500/10 border-emerald-500/30"
      : "bg-amber-500/10 border-amber-500/30";

  const label = likely
    ? "⚠ You likely own this"
    : safe
      ? "✓ Safe to buy"
      : `⚠ You own ${result.matches.length} similar piece${result.matches.length !== 1 ? "s" : ""}`;

  return (
    <div className={cn("rounded-2xl border-2 p-5 text-center", bg)}>
      <p className="text-xl font-bold">{label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{result.summary}</p>
    </div>
  );
}

// ── Match thumbnail grid ─────────────────────────────────────────────────────

function MatchGrid({ result }: { result: CompareResult }) {
  if (result.matches.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Closest matches
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {result.matches.map((m) => (
          <Link
            key={m.item.id}
            href={`/piece/${m.item.id}`}
            className="relative overflow-hidden rounded-xl border border-card-border bg-card"
          >
            <img
              src={m.item.imageUrl}
              alt={m.item.name}
              className="aspect-square w-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              <p className="truncate text-xs font-medium text-white">
                {m.item.name}
              </p>
              <div className="mt-0.5 flex gap-1">
                <VerdictPill verdict={m.samePattern} />
                <VerdictPill verdict={m.exactPiece} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Verdict detail cards ──────────────────────────────────────────────────────

function VerdictDetails({ result }: { result: CompareResult }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-card-border bg-card p-3">
        <p className="text-xs font-medium text-muted-foreground">
          Own pattern?
        </p>
        <div className="mt-1">
          <VerdictPill verdict={result.ownsSamePattern} />
        </div>
        <p className="mt-1.5 text-xs">
          {SAME_PATTERN_COPY[result.ownsSamePattern]}
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-3">
        <p className="text-xs font-medium text-muted-foreground">Own piece?</p>
        <div className="mt-1">
          <VerdictPill verdict={result.ownsExactPiece} />
        </div>
        <p className="mt-1.5 text-xs">
          {EXACT_PIECE_COPY[result.ownsExactPiece]}
        </p>
      </div>
    </div>
  );
}

// ── Detected attributes ───────────────────────────────────────────────────────

function DetectedAttributes({ result }: { result: CompareResult }) {
  const hasColors = result.candidate.dominantColors.length > 0;
  const hasMotifs = result.candidate.motifs.length > 0;
  if (!hasColors && !hasMotifs) return null;
  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Detected in photo
      </p>
      <div className="flex flex-wrap gap-1.5">
        {result.candidate.dominantColors.map((c, i) => (
          <span
            key={`c-${i}`}
            className="flex items-center gap-1.5 rounded-full border border-card-border py-0.5 pl-1.5 pr-2 text-xs"
          >
            <span
              className="h-2.5 w-2.5 rounded-full border border-black/10"
              style={{ backgroundColor: c }}
            />
            {c}
          </span>
        ))}
        {result.candidate.motifs.map((m, i) => (
          <Badge key={`m-${i}`} variant="secondary" className="text-xs">
            {m}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ── Main scan page ────────────────────────────────────────────────────────────

type CameraFacing = "environment" | "user";

export default function Scan() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [cameraReady, setCameraReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

  const compare = useUploadCompare();
  const result = compare.data;

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(
    async (facingMode: CameraFacing) => {
      stopStream();
      setPermissionDenied(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setCameraReady(true);
        }
      } catch {
        setPermissionDenied(true);
      }
    },
    [stopStream],
  );

  useEffect(() => {
    void startCamera(facing);
    return () => stopStream();
  }, [facing, startCamera, stopStream]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCaptured(dataUrl);

    canvas.toBlob(
      (blob) => {
        if (blob)
          setCapturedFile(new File([blob], "scan.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  };

  const handleFlip = () => {
    setFacing((prev) => (prev === "environment" ? "user" : "environment"));
  };

  const handleAnalyze = () => {
    if (!capturedFile) return;
    compare.mutate(
      { image: capturedFile },
      { onError: () => toast.error("Analysis failed. Try again.") },
    );
  };

  const handleReset = () => {
    setCaptured(null);
    setCapturedFile(null);
    compare.reset();
    void startCamera(facing);
  };

  usePageAssistantContext(
    "pottery-scan",
    permissionDenied
      ? "Scan page: camera access was denied, cannot capture a photo."
      : result
        ? `Scan page: analysis complete. Summary: ${result.summary} Owns same pattern: ${result.ownsSamePattern}. Owns exact piece: ${result.ownsExactPiece}. ${result.matches.length} closest match(es): ${result.matches.map((m) => `itemId ${m.item.id} "${m.item.name}"`).join("; ") || "none"}.`
        : compare.isPending
          ? "Scan page: analyzing a just-captured photo against the collection…"
          : `Scan page: live camera view for quickly checking a piece before buying it. ${captured ? "A photo has been captured and is ready to analyze." : "Waiting for a photo to be captured."}`,
  );

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      {/* ── Permission denied state ── */}
      {permissionDenied && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">Camera access required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Allow camera access in your browser settings, then reload the
              page.
            </p>
          </div>
          <Button onClick={() => window.location.reload()} variant="outline">
            Reload
          </Button>
        </div>
      )}

      {/* ── Results view ── */}
      {!permissionDenied && result && (
        <div className="mx-auto w-full max-w-sm space-y-4 px-4 py-4">
          <VerdictSummary result={result} />
          <VerdictDetails result={result} />
          <MatchGrid result={result} />
          <DetectedAttributes result={result} />
          <Button variant="outline" className="w-full" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
            Scan again
          </Button>
        </div>
      )}

      {/* ── Analyzing spinner ── */}
      {!permissionDenied && !result && compare.isPending && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="font-medium">Analyzing…</p>
          <p className="max-w-xs text-center text-sm text-muted-foreground">
            Searching your collection for pattern and piece matches
          </p>
        </div>
      )}

      {/* ── Camera / preview ── */}
      {!permissionDenied && !result && !compare.isPending && (
        <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl bg-black">
          {/* Video stream — hidden when photo captured */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "absolute inset-0 h-full w-full object-cover",
              captured ? "opacity-0" : "opacity-100",
            )}
          />

          {/* Captured photo preview */}
          {captured && (
            <img
              src={captured}
              alt="Captured"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}

          {/* Viewfinder overlay (when no capture yet) */}
          {!captured && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-64 w-64 rounded-2xl border-2 border-white/60" />
            </div>
          )}

          {/* Top bar buttons */}
          {!captured && (
            <div className="absolute right-4 top-4 flex flex-col gap-2">
              <button
                onClick={handleFlip}
                className="rounded-full bg-black/40 p-2.5 text-white backdrop-blur"
                aria-label="Flip camera"
              >
                <FlipHorizontal className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Retake button (when captured) */}
          {captured && (
            <button
              onClick={handleReset}
              className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-2 text-sm text-white backdrop-blur"
            >
              <X className="h-4 w-4" />
              Retake
            </button>
          )}

          {/* Bottom controls */}
          <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-4">
            {!captured ? (
              <button
                onClick={handleCapture}
                disabled={!cameraReady}
                className="h-16 w-16 rounded-full border-4 border-white bg-white/20 backdrop-blur transition active:scale-95 disabled:opacity-40"
                aria-label="Take photo"
              >
                <Camera className="mx-auto h-7 w-7 text-white" />
              </button>
            ) : (
              <Button
                onClick={handleAnalyze}
                disabled={!capturedFile}
                className="px-8 py-3 text-base"
              >
                <Camera className="h-4 w-4" />
                Check my collection
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Off-screen canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
