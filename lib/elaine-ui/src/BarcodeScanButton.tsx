import { useState, useRef, useEffect, useCallback } from "react";
import { ScanBarcode, X } from "lucide-react";
import { Button } from "@workspace/ui";

interface NativeBarcodeResult {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(image: HTMLVideoElement): Promise<NativeBarcodeResult[]>;
}
declare const BarcodeDetector: {
  new (options: { formats: string[] }): BarcodeDetectorLike;
};

const BARCODE_FORMATS_NATIVE = [
  "upc_a",
  "upc_e",
  "ean_13",
  "ean_8",
  "code_128",
  "code_39",
];

interface BarcodeScanButtonProps {
  onScanned: (code: string) => void;
  disabled?: boolean;
}

export function BarcodeScanButton({
  onScanned,
  disabled,
}: BarcodeScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const codeReaderRef = useRef<{ reset: () => void } | null>(null);
  const isScanningRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);

  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  }, [onScanned]);

  const stopScanning = useCallback(() => {
    isScanningRef.current = false;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (codeReaderRef.current) {
      try {
        codeReaderRef.current.reset();
      } catch {
        // ignore
      }
      codeReaderRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const handleFoundRef = useRef<(code: string) => void>(() => {});

  const startScanning = useCallback(async () => {
    if (!videoRef.current) return;
    isScanningRef.current = true;
    setIsScanning(true);

    if ("BarcodeDetector" in window) {
      try {
        if (!detectorRef.current) {
          detectorRef.current = new BarcodeDetector({
            formats: BARCODE_FORMATS_NATIVE,
          });
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const loop = async () => {
          if (
            !isScanningRef.current ||
            !detectorRef.current ||
            !videoRef.current
          )
            return;
          if (videoRef.current.readyState >= 2) {
            try {
              const barcodes = await detectorRef.current.detect(
                videoRef.current,
              );
              if (!isScanningRef.current) return;
              if (barcodes.length > 0) {
                handleFoundRef.current(barcodes[0].rawValue);
                return;
              }
            } catch {
              // frame not ready — keep looping
            }
          }
          if (isScanningRef.current) {
            animFrameRef.current = requestAnimationFrame(loop);
          }
        };
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      } catch {
        // BarcodeDetector unavailable — fall through to ZXing
      }
    }

    try {
      const {
        BrowserMultiFormatReader,
        BarcodeFormat,
        DecodeHintType,
        NotFoundException,
      } = await import("@zxing/library");
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
      ]);
      const reader = new BrowserMultiFormatReader(hints, 150);
      codeReaderRef.current = reader;
      if (!videoRef.current || !isScanningRef.current) {
        reader.reset();
        return;
      }
      await reader.decodeFromConstraints(
        {
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current,
        (result, err) => {
          if (result && isScanningRef.current) {
            handleFoundRef.current(result.getText());
          }
          if (err && !(err instanceof NotFoundException)) {
            // scan decode error — non-fatal
          }
        },
      );
    } catch {
      isScanningRef.current = false;
      setIsScanning(false);
      setHasCamera(false);
    }
  }, []);

  const handleFound = useCallback(
    (code: string) => {
      stopScanning();
      setOpen(false);
      setManualCode("");
      onScannedRef.current(code);
    },
    [stopScanning],
  );

  useEffect(() => {
    handleFoundRef.current = handleFound;
  }, [handleFound]);

  const handleClose = useCallback(() => {
    stopScanning();
    setOpen(false);
    setManualCode("");
  }, [stopScanning]);

  useEffect(() => {
    if (!open) return;
    setHasCamera(true);
    setManualCode("");
    const t = setTimeout(() => {
      void startScanning();
    }, 150);
    return () => {
      clearTimeout(t);
      stopScanning();
    };
  }, [open, startScanning, stopScanning]);

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        type="button"
        className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Scan a barcode"
      >
        <ScanBarcode className="h-3.5 w-3.5" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div className="relative mx-auto w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-background p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ScanBarcode className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Scan a barcode</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                className="h-7 w-7 rounded-full"
                onClick={handleClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {hasCamera ? (
              <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3]">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  playsInline
                  muted
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="relative w-56 h-32 border-2 border-primary/70 rounded-xl">
                    <div className="absolute -top-px -left-px w-5 h-5 border-t-[3px] border-l-[3px] border-primary rounded-tl-xl" />
                    <div className="absolute -top-px -right-px w-5 h-5 border-t-[3px] border-r-[3px] border-primary rounded-tr-xl" />
                    <div className="absolute -bottom-px -left-px w-5 h-5 border-b-[3px] border-l-[3px] border-primary rounded-bl-xl" />
                    <div className="absolute -bottom-px -right-px w-5 h-5 border-b-[3px] border-r-[3px] border-primary rounded-br-xl" />
                    {isScanning && (
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary/80 shadow-[0_0_6px_2px_rgba(99,102,241,0.5)] animate-pulse" />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground rounded-xl bg-muted/30">
                <ScanBarcode className="h-10 w-10 opacity-40" />
                <p className="text-sm text-center">
                  Camera unavailable on this browser.
                  <br />
                  Type the barcode below instead.
                </p>
              </div>
            )}

            <form
              className="flex gap-2 mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const v = manualCode.trim();
                if (v) handleFound(v);
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Or type / paste a barcode"
                className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!manualCode.trim()}
                className="shrink-0"
              >
                Go
              </Button>
            </form>

            <p className="text-xs text-muted-foreground text-center mt-2">
              Supports UPC, EAN, Code 128, Code 39
            </p>
          </div>
        </div>
      )}
    </>
  );
}
