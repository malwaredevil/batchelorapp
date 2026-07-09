import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Camera, Search, ArrowRight, ScanLine } from "lucide-react";
import { useLookupOrnamentBarcode } from "@workspace/api-client-react";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/library";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageAssistantContext } from "@/lib/assistant-context";

export default function ScanPage() {
  const [_, setLocation] = useLocation();
  const lookupBarcode = useLookupOrnamentBarcode();

  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);

  usePageAssistantContext(
    "ornaments-scan",
    `Barcode scanning page to quickly add an ornament. Uses device camera or manual UPC entry.`,
  );

  useEffect(() => {
    codeReaderRef.current = new BrowserMultiFormatReader();

    // Check if camera is available
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        setHasCamera(videoDevices.length > 0);
        if (videoDevices.length > 0) {
          startScanning();
        }
      })
      .catch((err) => {
        console.error("Camera access error:", err);
        setHasCamera(false);
      });

    return () => {
      stopScanning();
    };
  }, []);

  const startScanning = async () => {
    if (!codeReaderRef.current || !videoRef.current) return;

    setIsScanning(true);
    try {
      await codeReaderRef.current.decodeFromConstraints(
        { video: { facingMode: "environment" } },
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
    } catch (err) {
      console.error("Failed to start scanner:", err);
      setIsScanning(false);
      setHasCamera(false);
    }
  };

  const stopScanning = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
    }
    setIsScanning(false);
  };

  const handleScannedCode = async (code: string) => {
    if (isLookingUp) return;
    stopScanning();
    setIsLookingUp(true);
    setManualCode(code);

    try {
      toast.loading(`Looking up ${code}...`, { id: "lookup" });
      const result = await lookupBarcode.mutateAsync({
        id: 0,
        data: { barcode: code },
      });
      toast.dismiss("lookup");

      if (result.found) {
        toast.success("Found match!");
        // Store prefilled data in session storage to pick up on the /add page
        sessionStorage.setItem(
          "ornaments-add-prefill",
          JSON.stringify({
            name: result.name,
            brand: result.brand || "Hallmark",
            seriesOrCollection: result.seriesOrCollection,
            year: result.year,
            barcodeValue: code,
          }),
        );
        setLocation("/add");
      } else {
        toast.error("Not found in database. Proceed to manual entry.");
        sessionStorage.setItem(
          "ornaments-add-prefill",
          JSON.stringify({
            barcodeValue: code,
            brand: "Hallmark",
          }),
        );
        setLocation("/add");
      }
    } catch (err) {
      toast.dismiss("lookup");
      toast.error("Lookup failed. Proceeding to manual entry.");
      sessionStorage.setItem(
        "ornaments-add-prefill",
        JSON.stringify({
          barcodeValue: code,
          brand: "Hallmark",
        }),
      );
      setLocation("/add");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleScannedCode(manualCode.trim());
  };

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
              {/* Corner markers */}
              <div className="absolute top-[-2px] left-[-2px] w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-xl" />
              <div className="absolute top-[-2px] right-[-2px] w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-xl" />
              <div className="absolute bottom-[-2px] left-[-2px] w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-xl" />
              <div className="absolute bottom-[-2px] right-[-2px] w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-xl" />

              {/* Scan line animation */}
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary shadow-[0_0_8px_2px_rgba(255,100,50,0.6)] animate-[scan_2s_ease-in-out_infinite]" />
            </div>
          </div>

          {!isScanning && !isLookingUp && (
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

          {isLookingUp && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm text-white space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="font-medium tracking-wide">Searching database...</p>
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
            barcode manually below.
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
                disabled={isLookingUp}
                className="bg-card font-mono text-base h-12"
              />
              <Button
                type="submit"
                disabled={!manualCode.trim() || isLookingUp}
                className="h-12 w-12 shrink-0 p-0"
              >
                {isLookingUp ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Search className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </form>

        <div className="mt-8 text-center">
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setLocation("/add")}
          >
            Skip to manual entry <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
