import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Loader2,
  Camera,
  Search,
  RefreshCw,
  Plus,
  ExternalLink,
  ScanLine,
  ImageUp,
  ScanBarcode,
  Package,
  Tag,
  Calendar,
  DollarSign,
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

/// <reference path="../ornaments/types/barcode-detector.d.ts" />

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

type BarcodeResult = Awaited<
  ReturnType<ReturnType<typeof useLookupBarcode>["mutateAsync"]>
>;

export default function BarcodeLookupPage() {
  const [_, setLocation] = useLocation();
  const lookupBarcode = useLookupBarcode();
  const extractBarcodePhoto = useExtractOrnamentBarcodePhoto();

  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isScanningRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isPhotoExtracting, setIsPhotoExtracting] = useState(false);
  const [scannedCode, setScannedCode] = useState("");
  const [scanResult, setScanResult] = useState<BarcodeResult | null>(null);

  useEffect(() => {
    let useBarcodeDetector = false;

    if ("BarcodeDetector" in window) {
      try {
        detectorRef.current = new BarcodeDetector({
          formats: BARCODE_FORMATS_NATIVE,
        });
        useBarcodeDetector = true;
      } catch {
        // fall through
      }
    }

    if (!useBarcodeDetector) {
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS_ZXING);
      codeReaderRef.current = new BrowserMultiFormatReader(hints, 150);
    }

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        setHasCamera(videoDevices.length > 0);
        if (videoDevices.length > 0) startScanning();
      })
      .catch(() => setHasCamera(false));

    return () => stopScanning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const barcodeDetectorLoop = useCallback(async () => {
    if (!isScanningRef.current || !detectorRef.current || !videoRef.current)
      return;
    if (videoRef.current.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(barcodeDetectorLoop);
      return;
    }
    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      if (!isScanningRef.current) return;
      if (barcodes.length > 0) {
        void handleScannedCode(barcodes[0].rawValue);
        return;
      }
    } catch {
      // frame not ready
    }
    if (isScanningRef.current) {
      animFrameRef.current = requestAnimationFrame(barcodeDetectorLoop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScanning = async () => {
    if (!videoRef.current) return;
    isScanningRef.current = true;
    setIsScanning(true);

    if (detectorRef.current) {
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
            if (result) void handleScannedCode(result.getText());
            if (err && !(err instanceof NotFoundException)) console.error(err);
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

  const handleScannedCode = async (code: string) => {
    if (isLookingUp) return;
    stopScanning();
    setIsLookingUp(true);
    setScannedCode(code);
    setManualCode(code);
    setScanResult(null);

    try {
      toast.loading(`Looking up ${code}…`, { id: "lookup" });
      const result = await lookupBarcode.mutateAsync({
        data: { barcode: code },
      });
      toast.dismiss("lookup");
      setScanResult(result);
    } catch {
      toast.dismiss("lookup");
      toast.error("Lookup failed. Please try again.");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    void handleScannedCode(manualCode.trim());
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
        void handleScannedCode(result.barcode);
      } else {
        toast.error(
          "Couldn't read a barcode from the photo. Try manual entry.",
        );
      }
    } catch {
      toast.dismiss("photo-lookup");
      toast.error("Photo scan failed. Please try manual entry.");
    } finally {
      setIsPhotoExtracting(false);
    }
  };

  const handleScanAnother = () => {
    setScanResult(null);
    setScannedCode("");
    setManualCode("");
    void startScanning();
  };

  const isAnyLoading = isLookingUp || isPhotoExtracting;

  return (
    <div className="mx-auto max-w-md space-y-6 pt-4 pb-12">
      <div className="text-center mb-8">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <ScanBarcode className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-3xl font-serif font-bold text-foreground">
          Barcode Lookup
        </h1>
        <p className="text-muted-foreground mt-2">
          Scan any product barcode or UPC to identify it
        </p>
      </div>

      {/* Results view */}
      {scanResult ? (
        <div className="space-y-4">
          {scanResult.found ? (
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              {/* Product image */}
              {(scanResult.hallmarkImages?.[0] ?? scanResult.imageUrl) && (
                <div className="aspect-[4/3] overflow-hidden bg-muted">
                  <img
                    src={scanResult.hallmarkImages?.[0] ?? scanResult.imageUrl!}
                    alt={scanResult.name ?? "Product"}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              <div className="p-5 space-y-4">
                {/* Core identity */}
                <div>
                  <h2 className="text-xl font-serif font-bold leading-tight">
                    {scanResult.name ?? "Unknown Product"}
                  </h2>
                  {scanResult.brand && (
                    <p className="text-muted-foreground mt-0.5">
                      {scanResult.brand}
                    </p>
                  )}
                </div>

                {/* Year / series */}
                {(scanResult.year ?? scanResult.seriesOrCollection) && (
                  <div className="flex flex-wrap gap-3 text-sm">
                    {scanResult.year && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{scanResult.year}</span>
                      </div>
                    )}
                    {scanResult.seriesOrCollection && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Tag className="h-3.5 w-3.5" />
                        <span>{scanResult.seriesOrCollection}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                {scanResult.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {scanResult.description}
                  </p>
                )}

                {/* Barcode */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <Package className="h-3 w-3" />
                  <span>Barcode: {scannedCode}</span>
                </div>

                {/* Hallmark details */}
                {scanResult.hallmarkSku && (
                  <div className="border-t border-border pt-4 space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Hallmark Details
                    </h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">
                          SKU
                        </span>
                        <p className="font-mono font-medium">
                          {scanResult.hallmarkSku}
                        </p>
                      </div>
                      {scanResult.hallmarkArtist && (
                        <div>
                          <span className="text-muted-foreground text-xs">
                            Artist
                          </span>
                          <p className="font-medium">
                            {scanResult.hallmarkArtist}
                          </p>
                        </div>
                      )}
                      {scanResult.hallmarkSeriesName && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs">
                            Collection
                          </span>
                          <p className="font-medium">
                            {scanResult.hallmarkSeriesName}
                          </p>
                        </div>
                      )}
                      {scanResult.hallmarkRetailPriceUsd != null && (
                        <div>
                          <span className="text-muted-foreground text-xs">
                            Original Retail
                          </span>
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3 text-muted-foreground" />
                            <p className="font-medium">
                              {scanResult.hallmarkRetailPriceUsd.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      )}
                      {scanResult.hallmarkCollectorPriceUsd != null && (
                        <div>
                          <span className="text-muted-foreground text-xs">
                            Collector Value
                          </span>
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3 text-muted-foreground" />
                            <p className="font-medium">
                              {scanResult.hallmarkCollectorPriceUsd.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      )}
                      {scanResult.hallmarkInStock != null && (
                        <div>
                          <span className="text-muted-foreground text-xs">
                            In Stock
                          </span>
                          <p
                            className={
                              scanResult.hallmarkInStock
                                ? "font-medium text-green-600"
                                : "font-medium text-muted-foreground"
                            }
                          >
                            {scanResult.hallmarkInStock ? "Yes" : "No"}
                          </p>
                        </div>
                      )}
                    </div>

                    {scanResult.hallmarkProductUrl && (
                      <a
                        href={scanResult.hallmarkProductUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                      >
                        View on Hallmark.com
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-2xl border border-border p-8 text-center shadow-sm">
              <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                <Package className="h-7 w-7 text-muted-foreground opacity-50" />
              </div>
              <h3 className="font-serif text-lg font-medium">
                Product Not Found
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                No product information found for barcode{" "}
                <span className="font-mono">{scannedCode}</span>. It may not be
                in any database yet.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            {scanResult.found && scanResult.hallmarkSku && (
              <Button
                className="flex-1"
                onClick={() => {
                  sessionStorage.setItem(
                    "ornaments-add-prefill",
                    JSON.stringify({
                      name: scanResult.name,
                      brand: scanResult.brand ?? "Hallmark",
                      seriesOrCollection: scanResult.seriesOrCollection,
                      year: scanResult.year,
                      barcodeValue: scannedCode,
                    }),
                  );
                  setLocation("/ornaments/add");
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add to Ornaments
              </Button>
            )}
            {scanResult.found && scanResult.name && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const query = [scanResult.name, scanResult.year]
                    .filter(Boolean)
                    .join(" ");
                  window.open(
                    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1`,
                    "_blank",
                  );
                }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Search eBay
              </Button>
            )}
            <Button
              variant={scanResult.found ? "outline" : "default"}
              className={scanResult.found ? "flex-1" : "w-full"}
              onClick={handleScanAnother}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Scan Another
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Camera viewfinder */}
          {hasCamera ? (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-[3/4] sm:aspect-square shadow-xl shadow-black/10 border border-border">
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
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary shadow-[0_0_8px_2px_rgba(99,102,241,0.5)] animate-[scan_2s_ease-in-out_infinite]" />
                  )}
                </div>
              </div>

              {!isScanning && !isAnyLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <Button
                    onClick={() => void startScanning()}
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
                      : "Looking up product…"}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card rounded-2xl border border-border p-8 text-center shadow-sm">
              <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <ScanLine className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
              <h3 className="font-serif text-lg font-medium">
                Camera Unavailable
              </h3>
              <p className="text-sm text-muted-foreground mt-2 mb-6">
                We couldn't access your camera. Enter the barcode manually
                below, or take a photo to have AI read it.
              </p>
            </div>
          )}

          {/* AI photo escape hatch */}
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
                {isScanning
                  ? "Can't scan? Take a photo"
                  : "Take a photo instead"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1.5">
                AI will read the barcode digits from the photo
              </p>
            </div>
          )}

          {/* Manual entry */}
          <div className="pt-4 border-t border-border">
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Manual Entry</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. 076379554309"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    disabled={isAnyLoading}
                    className="bg-card font-mono text-base h-12"
                    inputMode="numeric"
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
          </div>
        </>
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
