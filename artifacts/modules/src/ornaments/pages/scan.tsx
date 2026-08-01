import { useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  Loader2,
  Camera,
  Search,
  ArrowRight,
  ScanLine,
  ImageUp,
  RefreshCw,
  Tag,
  Calendar,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  useLookupBarcode,
  useExtractOrnamentBarcodePhoto,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { useBarcodeCamera } from "@/ornaments/components/use-barcode-camera";

type ScanResult = {
  found: boolean;
  name?: string | null;
  brand?: string | null;
  seriesOrCollection?: string | null;
  year?: number | null;
};

type ConfirmState =
  | { step: "confirming" }
  | { step: "confirmed" }
  | { step: "correcting" }
  | { step: "correction-submitted" };

export default function ScanPage() {
  const [_, setLocation] = useLocation();
  const lookupBarcode = useLookupBarcode();
  const extractBarcodePhoto = useExtractOrnamentBarcodePhoto();

  // Hidden file input for the "take a photo" escape hatch
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [manualCode, setManualCode] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isPhotoExtracting, setIsPhotoExtracting] = useState(false);
  const [scannedCode, setScannedCode] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // Correction form state
  const [correctedName, setCorrectedName] = useState("");
  const [correctedBrand, setCorrectedBrand] = useState("");
  const [correctedSeriesOrCollection, setCorrectedSeriesOrCollection] =
    useState("");
  const [correctedYear, setCorrectedYear] = useState("");
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);

  usePageAssistantContext(
    "ornaments-scan",
    `Lookup Ornament page — looks up ornament details by UPC barcode. This is a lookup-only tool; no data is saved to the collection.`,
  );

  const { videoRef, isScanning, hasCamera, startScanning, stopScanning } =
    useBarcodeCamera({
      enabled: true,
      onDetected: (barcode) => void handleScannedCode(barcode),
    });

  // -------------------------------------------------------------------------
  // Lookup after a code is detected (camera scan or manual entry)
  // -------------------------------------------------------------------------
  async function handleScannedCode(code: string) {
    if (isLookingUp) return;
    stopScanning();
    setIsLookingUp(true);
    setManualCode(code);
    setScannedCode(code);
    setScanResult(null);
    setConfirmState(null);

    try {
      toast.loading(`Looking up ${code}...`, { id: "lookup" });
      const result = await lookupBarcode.mutateAsync({
        data: { barcode: code },
      });
      toast.dismiss("lookup");
      setScanResult(result);
      setConfirmState({ step: "confirming" });

      if (result.found) {
        toast.success("Found it!");
      } else {
        toast.info("Nothing found for this barcode.");
      }
    } catch {
      toast.dismiss("lookup");
      toast.error("Lookup failed. Please try again.");
    } finally {
      setIsLookingUp(false);
    }
  }

  const handleScanAnother = () => {
    setScanResult(null);
    setConfirmState(null);
    setScannedCode("");
    setManualCode("");
    setCorrectedName("");
    setCorrectedBrand("");
    setCorrectedSeriesOrCollection("");
    setCorrectedYear("");
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

  // -------------------------------------------------------------------------
  // Correction submission
  // -------------------------------------------------------------------------
  const handleSubmitCorrection = async () => {
    if (!scanResult || !scannedCode) return;
    setIsSubmittingCorrection(true);
    try {
      await fetch("/api/ornaments/items/report-barcode-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode: scannedCode,
          wrongName: scanResult.name,
          wrongBrand: scanResult.brand,
          correctedName: correctedName.trim() || undefined,
          correctedBrand: correctedBrand.trim() || undefined,
          correctedSeriesOrCollection:
            correctedSeriesOrCollection.trim() || undefined,
          correctedYear: correctedYear ? Number(correctedYear) : undefined,
        }),
      });
      setConfirmState({ step: "correction-submitted" });
    } catch {
      toast.error("Failed to submit correction. Please try again.");
    } finally {
      setIsSubmittingCorrection(false);
    }
  };

  const isAnyLoading = isLookingUp || isPhotoExtracting;

  return (
    <div className="mx-auto max-w-md space-y-6 pt-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground">
          Lookup Ornament
        </h1>
        <p className="text-muted-foreground mt-2">
          Scan the UPC barcode on the ornament box to look up details
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

      {/* Results + confirmation flow */}
      {scanResult && confirmState && (
        <div className="pt-4 border-t border-border space-y-4">
          {/* ----------------------------------------------------------------
              NOT FOUND
          ---------------------------------------------------------------- */}
          {!scanResult.found && (
            <>
              {confirmState.step === "confirming" && (
                <div className="bg-muted/50 rounded-xl p-5 text-center space-y-4">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      Nothing found for this barcode.
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {scannedCode}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmState({ step: "confirmed" })}
                  >
                    Got it
                  </Button>
                </div>
              )}

              {confirmState.step === "confirmed" && (
                <div className="bg-muted/50 rounded-xl p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    No product info found for{" "}
                    <span className="font-mono">{scannedCode}</span>.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ----------------------------------------------------------------
              FOUND — confirmation step
          ---------------------------------------------------------------- */}
          {scanResult.found && confirmState.step === "confirming" && (
            <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
              <h2 className="text-base font-semibold">
                Is this information correct?
              </h2>

              {/* Info card */}
              <div className="space-y-1">
                <p className="font-serif text-lg font-bold">
                  {scanResult.name ?? "Unknown ornament"}
                </p>
                {scanResult.brand && (
                  <p className="text-sm text-muted-foreground">
                    {scanResult.brand}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground pt-1">
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

              <div className="flex gap-3">
                <Button
                  className="flex-1"
                  onClick={() => setConfirmState({ step: "confirmed" })}
                >
                  Yes
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-destructive border-destructive/40 hover:bg-destructive/5"
                  onClick={() => {
                    setCorrectedName(scanResult.name ?? "");
                    setCorrectedBrand(scanResult.brand ?? "");
                    setCorrectedSeriesOrCollection(
                      scanResult.seriesOrCollection ?? "",
                    );
                    setCorrectedYear(
                      scanResult.year ? String(scanResult.year) : "",
                    );
                    setConfirmState({ step: "correcting" });
                  }}
                >
                  No, this is wrong
                </Button>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------
              FOUND — confirmed, show result with muted note
          ---------------------------------------------------------------- */}
          {scanResult.found && confirmState.step === "confirmed" && (
            <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <div className="space-y-1 min-w-0">
                  <p className="font-serif text-lg font-bold leading-tight">
                    {scanResult.name ?? "Unknown ornament"}
                  </p>
                  {scanResult.brand && (
                    <p className="text-sm text-muted-foreground">
                      {scanResult.brand}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground pt-1">
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
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Lookup only — no data is saved.
              </p>
            </div>
          )}

          {/* ----------------------------------------------------------------
              FOUND — correction form
          ---------------------------------------------------------------- */}
          {scanResult.found && confirmState.step === "correcting" && (
            <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
              <p className="text-sm text-muted-foreground">
                Sorry about that! Please fill in the correct details below.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Name
                  </label>
                  <Input
                    value={correctedName}
                    onChange={(e) => setCorrectedName(e.target.value)}
                    placeholder="Ornament name"
                    disabled={isSubmittingCorrection}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Brand
                  </label>
                  <Input
                    value={correctedBrand}
                    onChange={(e) => setCorrectedBrand(e.target.value)}
                    placeholder="e.g. Hallmark"
                    disabled={isSubmittingCorrection}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Series / Collection
                  </label>
                  <Input
                    value={correctedSeriesOrCollection}
                    onChange={(e) =>
                      setCorrectedSeriesOrCollection(e.target.value)
                    }
                    placeholder="e.g. Keepsake Ornaments"
                    disabled={isSubmittingCorrection}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Year
                  </label>
                  <Input
                    type="number"
                    value={correctedYear}
                    onChange={(e) => setCorrectedYear(e.target.value)}
                    placeholder="e.g. 2023"
                    disabled={isSubmittingCorrection}
                  />
                </div>
              </div>
              <Button
                className="w-full"
                onClick={handleSubmitCorrection}
                disabled={isSubmittingCorrection}
              >
                {isSubmittingCorrection ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit Correction"
                )}
              </Button>
            </div>
          )}

          {/* ----------------------------------------------------------------
              FOUND — correction submitted
          ---------------------------------------------------------------- */}
          {scanResult.found && confirmState.step === "correction-submitted" && (
            <div className="bg-card rounded-2xl border border-border p-5 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
              <p className="text-sm font-medium">
                Thank you — your correction has been recorded.
              </p>
            </div>
          )}

          {/* Scan Another button always visible in results panel */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleScanAnother}
            >
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
