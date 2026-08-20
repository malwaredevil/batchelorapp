import { useCallback, useEffect, useRef, useState } from "react";
import { ScanBarcode, X } from "lucide-react";
import {
  DEFAULT_CONFIRMATION_FRAMES,
  useBarcodeCamera,
} from "@workspace/barcode-scanner";
import { Button } from "@workspace/ui";

interface BarcodeScanButtonProps {
  onScanned: (code: string) => void;
  disabled?: boolean;
}

export function BarcodeScanButton({
  onScanned,
  disabled,
}: BarcodeScanButtonProps) {
  // The visual wrapper is Elaine-specific; scanning behavior is shared with
  // every other camera barcode flow via @workspace/barcode-scanner.
  const [open, setOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const onScannedRef = useRef(onScanned);
  const handleFoundRef = useRef<(code: string) => void>(() => {});

  useEffect(() => {
    onScannedRef.current = onScanned;
  }, [onScanned]);

  const camera = useBarcodeCamera({
    enabled: open,
    onDetected: (code) => handleFoundRef.current(code),
  });

  const handleFound = useCallback(
    (code: string) => {
      camera.stopScanning();
      setOpen(false);
      setManualCode("");
      onScannedRef.current(code);
    },
    [camera.stopScanning],
  );

  useEffect(() => {
    handleFoundRef.current = handleFound;
  }, [handleFound]);

  const handleClose = useCallback(() => {
    camera.stopScanning();
    setOpen(false);
    setManualCode("");
  }, [camera.stopScanning]);

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
          onClick={(event) => {
            if (event.target === event.currentTarget) handleClose();
          }}
        >
          <div className="relative mx-auto w-full max-w-sm rounded-t-2xl bg-background p-4 shadow-2xl sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
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

            {camera.hasCamera ? (
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
                <video
                  ref={camera.videoRef}
                  className="h-full w-full object-cover"
                  playsInline
                  muted
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative h-32 w-56 rounded-xl border-2 border-primary/70">
                    <div className="absolute -left-px -top-px h-5 w-5 rounded-tl-xl border-l-[3px] border-t-[3px] border-primary" />
                    <div className="absolute -right-px -top-px h-5 w-5 rounded-tr-xl border-r-[3px] border-t-[3px] border-primary" />
                    <div className="absolute -bottom-px -left-px h-5 w-5 rounded-bl-xl border-b-[3px] border-l-[3px] border-primary" />
                    <div className="absolute -bottom-px -right-px h-5 w-5 rounded-br-xl border-b-[3px] border-r-[3px] border-primary" />
                    {camera.isScanning && (
                      <div className="absolute left-0 right-0 top-0 h-0.5 animate-pulse bg-primary/80 shadow-[0_0_6px_2px_rgba(99,102,241,0.5)]" />
                    )}
                  </div>
                </div>
                {camera.confirmationProgress > 0 && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
                    Hold steady — confirming{" "}
                    {Array.from({ length: DEFAULT_CONFIRMATION_FRAMES })
                      .map((_, index) =>
                        index < camera.confirmationProgress ? "●" : "○",
                      )
                      .join(" ")}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 py-8 text-muted-foreground">
                <ScanBarcode className="h-10 w-10 opacity-40" />
                <p className="text-center text-sm">
                  Camera unavailable on this browser.
                  <br />
                  Type the barcode below instead.
                </p>
              </div>
            )}

            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const code = manualCode.trim();
                if (code) handleFound(code);
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
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

            <p className="mt-2 text-center text-xs text-muted-foreground">
              Supports UPC, EAN, Code 128, Code 39
            </p>
          </div>
        </div>
      )}
    </>
  );
}
