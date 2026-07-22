import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Loader2,
  Camera,
  Search,
  ArrowRight,
  ScanLine,
  ImageUp,
  RefreshCw,
  Plus,
  Tag,
  Calendar,
} from "lucide-react";
import {
  useLookupBarcode,
  useExtractOrnamentBarcodePhoto,
} from "@workspace/api-client-react";
import {
  BrowserMultiFormatReader,
  NotFoundException,
  BarcodeFormat,
  DecodeHintType,
} from "@zxing/library";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";

/// <reference path="../types/barcode-detector.d.ts" />

const BARCODE_FORMATS_ZXING = [
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
];

const BARCODE_FORMATS_NATIVE: NativeBarcodeFormat[] = [
  "upc_a",
  "upc_e",
  "ean_13",
  "ean_8",
  "code_128",
  "code_39",
];

export default function ScanPage() {
  const [_, setLocation] = useLocation();
  const lookupBarcode = useLookupBarcode();
  const extractBarcodePhoto = useExtractOrnamentBarcodePhoto();

  const videoRef = useRef<HTMLVideoElement>(null);

  // ZXing fallback reader (created only when BarcodeDetector is unavailable)
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);

  // Native BarcodeDetector (Chrome/Android — hardware-accelerated)
  const detectorRef = useRef<BarcodeDetector | null>(null);

  // Camera stream, managed manually for the BarcodeDetector path
  const streamRef = useRef<MediaStream | null>(null);

  // A ref (not state) so the rAF loop always sees the current value without
  // a stale closure. Updated in sync with the `isScanning` state.
  const isScanningRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);

  // Hidden file input for the "take a photo" escape hatch
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isPhotoExtracting, setIsPhotoExtracting] = useState(false);
  const [scannedCode, setScannedCode] = useState("");
  const [scanResult, setScanResult] = useState<{
    found: boolean;
    name?: string | null;
    brand?: string | null;
    seriesOrCollection?: string | null;
    year?: number | null;
  } | null>(null);

  usePageAssistantContext(
    "ornaments-scan",
    `Barcode scanning page to quickly add an ornament. Uses device camera or manual UPC entry.`,
  );

  // Determine which scanning engine to use on mount.
  // BarcodeDetector (native, hardware-accelerated) is preferred when available.
  // ZXing is the fallback for Safari/Firefox.
  useEffect(() => {
    let useBarcodeDetector = false;

    if ("BarcodeDetector" in window) {
      try {
        detectorRef.current = new BarcodeDetector({
          formats: BARCODE_FORMATS_NATIVE,
        });
        useBarcodeDetector = true;
      } catch {
        // Construction failed — fall through to ZXing
      }
    }

    if (!useBarcodeDetector) {
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS_ZXING);
      // 150ms decode interval (vs 500ms default) for fast lock-on
      codeReaderRef.current = new BrowserMultiFormatReader(hints, 150);
    }

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        setHasCamera(videoDevices.length > 0);
        if (videoDevices.length > 0) {
          startScanning();
        }
      })
      .catch(() => setHasCamera(false));

    return () => {
      stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // BarcodeDetector rAF loop
  // -------------------------------------------------------------------------
  const barcodeDetectorLoop = useCallback(async () => {
    if (!isScanningRef.current || !detectorRef.current || !videoRef.current) {
      return;
    }
    // Video must have a frame to decode
    if (videoRef.current.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(barcodeDetectorLoop);
      return;
    }
    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      // Re-check after the async detect() call in case we stopped while waiting
      if (!isScanningRef.current) return;
      if (barcodes.length > 0) {
        handleScannedCode(barcodes[0].rawValue);
        return;
      }
    } catch {
      // Frame not ready or detect threw; continue to next frame
    }
    if (isScanningRef.current) {
      animFrameRef.current = requestAnimationFrame(barcodeDetectorLoop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Scanning lifecycle
  // -------------------------------------------------------------------------
  const startScanning = async () => {
    if (!videoRef.current) return;
    isScanningRef.current = true;
    setIsScanning(true);

    if (detectorRef.current) {
      // BarcodeDetector path — set up camera stream manually
      try {
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
        requestAnimationFrame(barcodeDetectorLoop);
      } catch {
        isScanningRef.current = false;
        setIsScanning(false);
        setHasCamera(false);
      }
    } else if (codeReaderRef.current) {
      // ZXing fallback — handles camera stream internally
      try {
        await codeReaderRef.current.decodeFromConstraints(
          {
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result, err) => {
            if (result) {
              handleScannedCode(result.getText());
            }
            if (err && !(err instanceof NotFoundException)) {
              console.error(err);
            }
          },
        );
      } catch {
        isScanningRef.current = false;
        setIsScanning(false);
        setHasCamera(false);
      }
    }
  };

  const stopScanning = () => {
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
      codeReaderRef.current.reset();
    }

    setIsScanning(false);
  };

  // -------------------------------------------------------------------------
  // Lookup after a code is detected (camera scan or manual entry)
  // -------------------------------------------------------------------------
  const handleScannedCode = async (code: string) => {
    if (isLookingUp) return;
    stopScanning();
    setIsLookingUp(true);
    setManualCode(code);
    setScannedCode(code);
    setScanResult(null);

    try {
      toast.loading(`Looking up ${code}...`, { id: "lookup" });
      const result = await lookupBarcode.mutateAsync({
        data: { barcode: code },
      });
      toast.dismiss("lookup");
      setScanResult(result);

      if (result.found) {
        toast.success("Found it!");
      } else {
        toast.info("Not in database — you can still add it manually.");
      }
    } catch {
      toast.dismiss("lookup");
      toast.error("Lookup failed. Proceeding to manual entry.");
      sessionStorage.setItem(
        "ornaments-add-prefill",
        JSON.stringify({ barcodeValue: code, brand: "Hallmark" }),
      );
      setLocation("/ornaments/add");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleScanAnother = () => {
    setScanResult(null);
    setScannedCode("");
    setManualCode("");
    void startScanning();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleScannedCode(manualCode.trim());
  };

  // -------------------------------------------------------------------------
  // "Take a photo" escape hatch — AI vision extracts the barcode digits
  // -------------------------------------------------------------------------
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input immediately so the same file can be re-selected if needed
    e.target.value = "";
    if (!file || isLookingUp || isPhotoExtracting) return;

    stopScanning();
    setIsPhotoExtracting(true);
    toast.loading("Reading barcode from photo…", { id: "photo-lookup" });

    try {
      const imageDataUrl = await fileToDataUrl(file);
      const result = await extractBarcodePhoto.mutateAsync({
        data: { imageDataUrl },
      });
      toast.dismiss("photo-lookup");

      if (result.barcode) {
        toast.success(`Barcode found: ${result.barcode}`);
        handleScannedCode(result.barcode);
      } else {
        toast.error(
          "Couldn't read a barcode from the photo. Try a different angle or use manual entry.",
        );
      }
    } catch {
      toast.dismiss("photo-lookup");
      toast.error("Photo scan failed. Please try manual entry.");
    } finally {
      setIsPhotoExtracting(false);
    }
  };

  const isAnyLoading = isLookingUp || isPhotoExtracting;

  return (
    <div className="mx-auto max-w-md space-y-6 pt-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          Scan Box
        </h1>
        <p className="text-muted-foreground mt-2">
          Scan the UPC barcode on the ornament box to autofill details
        </p>
      </div>

      {hasCamera ? (
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-[3/4] sm:aspect-square shadow-xl shadow-black/10 border border-card-border">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />

          <div className="absolute inset-0 border-[40px] sm:border-[60px] border-black/40 pointer-events-none" />

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-40 border-2 border-primary/80 rounded-xl relative">
              <div className="absolute top-[-2px] left-[-2px] w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-xl" />
              <div className="absolute top-[-2px] right-[-2px] w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-xl" />
              <div className="absolute bottom-[-2px] left-[-2px] w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-xl" />
              <div className="absolute bottom-[-2px] right-[-2px] w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-xl" />

              {isScanning && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary shadow-[0_0_8px_2px_rgba(255,100,50,0.6)] animate-[scan_2s_ease-in-out_infinite]" />
              )}
            </div>
          </div>

          {!isScanning && !isAnyLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <Button
                onClick={startScanning}
                size="lg"
                className="rounded-full shadow-lg"
              >
                <Camera className="mr-2 h-5 w-5" /> Start Camera
              </Button>
            </div>
          )}

          {isAnyLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm text-white space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="font-medium tracking-wide">
                {isPhotoExtracting
                  ? "Reading barcode from photo…"
                  : "Searching database…"}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-card-border p-8 text-center shadow-sm">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <ScanLine className="h-8 w-8 text-muted-foreground opacity-50" />
          </div>
          <h3 className="font-serif text-lg font-medium">Camera Unavailable</h3>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            We couldn't access your device's camera. You can still enter the
            barcode manually below, or take a photo to have AI read it.
          </p>
        </div>
      )}

      {/* Photo escape hatch — hidden file input triggered by button */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={handlePhotoCapture}
        aria-label="Take a photo to read barcode"
      />

      {(isScanning || !hasCamera) && (
        <div className="text-center">
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground"
            disabled={isAnyLoading}
            onClick={() => photoInputRef.current?.click()}
          >
            <ImageUp className="mr-2 h-4 w-4" />
            {isScanning ? "Can't scan? Take a photo" : "Take a photo instead"}
          </Button>
          <p className="text-xs text-muted-foreground mt-1.5">
            AI will read the barcode digits from the photo
          </p>
        </div>
      )}

      <div className="pt-4 border-t border-border">
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Manual UPC Entry</label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 76379512345"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                disabled={isAnyLoading}
                className="bg-card font-mono text-base h-12"
              />
              <Button
                type="submit"
                disabled={!manualCode.trim() || isAnyLoading}
                className="h-12 w-12 shrink-0 p-0"
              >
                {isAnyLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Search className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </form>

        {!scanResult && (
          <div className="mt-8 text-center">
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setLocation("/ornaments/add")}
            >
              Skip to manual entry <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Inline results — shown instead of redirecting to /add */}
      {scanResult && (
        <div className="pt-4 border-t border-border space-y-4">
          {scanResult.found ? (
            <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
              <div>
                <h2 className="text-lg font-serif font-bold">
                  {scanResult.name ?? "Unknown ornament"}
                </h2>
                {scanResult.brand && (
                  <p className="text-sm text-muted-foreground">
                    {scanResult.brand}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                {scanResult.year && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{scanResult.year}</span>
                  </div>
                )}
                {scanResult.seriesOrCollection && (
                  <div className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5" />
                    <span>{scanResult.seriesOrCollection}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-muted/50 rounded-xl p-4 text-center">
              <p className="text-sm text-muted-foreground">
                No product info found for{" "}
                <span className="font-mono">{scannedCode}</span>. You can still
                add it manually.
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={() => {
                sessionStorage.setItem(
                  "ornaments-add-prefill",
                  JSON.stringify({
                    name: scanResult.found ? scanResult.name : undefined,
                    brand:
                      (scanResult.found ? scanResult.brand : null) ??
                      "Hallmark",
                    seriesOrCollection: scanResult.found
                      ? scanResult.seriesOrCollection
                      : undefined,
                    year: scanResult.found ? scanResult.year : undefined,
                    barcodeValue: scannedCode,
                  }),
                );
                setLocation("/ornaments/add");
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {scanResult.found ? "Add to Collection" : "Add Manually"}
            </Button>
            <Button variant="outline" onClick={handleScanAnother}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Scan Another
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
