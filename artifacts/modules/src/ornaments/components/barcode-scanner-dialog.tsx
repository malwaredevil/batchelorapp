import { useRef, useState } from "react";
import { Camera, ImageUp, Loader2, ScanBarcode } from "lucide-react";
import { useExtractOrnamentBarcodePhoto } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBarcodeCamera } from "./use-barcode-camera";

export function BarcodeScannerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanned: (barcode: string) => void;
}) {
  const [manualCode, setManualCode] = useState("");
  const [isPhotoExtracting, setIsPhotoExtracting] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const extractBarcodePhoto = useExtractOrnamentBarcodePhoto();

  const acceptBarcode = (barcode: string) => {
    const normalized = barcode.trim();
    if (!normalized) return;
    props.onScanned(normalized);
    props.onOpenChange(false);
    setManualCode("");
  };
  const camera = useBarcodeCamera({
    enabled: props.open,
    onDetected: acceptBarcode,
  });

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isPhotoExtracting) return;
    setIsPhotoExtracting(true);
    camera.stopScanning();
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const result = await extractBarcodePhoto.mutateAsync({
        data: { imageDataUrl },
      });
      if (result.barcode) {
        toast.success(`Barcode found: ${result.barcode}`);
        acceptBarcode(result.barcode);
      } else {
        toast.error("No readable barcode was found in that photo.");
      }
    } catch {
      toast.error("Could not read the barcode photo.");
    } finally {
      setIsPhotoExtracting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" />
            Scan ornament barcode
          </DialogTitle>
          <DialogDescription>
            Scan the UPC on the ornament or its box. You can also enter it
            manually.
          </DialogDescription>
        </DialogHeader>

        {camera.hasCamera ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video
              ref={camera.videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />
            <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-primary" />
            {!camera.isScanning && !isPhotoExtracting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <Button onClick={() => void camera.startScanning()}>
                  <Camera className="mr-2 h-4 w-4" />
                  Start camera
                </Button>
              </div>
            )}
            {isPhotoExtracting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Reading photo…
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            Camera access is unavailable. Enter the barcode manually or take a
            photo instead.
          </p>
        )}

        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            void handlePhoto(event);
          }}
          aria-label="Take a barcode photo"
        />
        <Button
          variant="outline"
          disabled={isPhotoExtracting}
          onClick={() => photoInputRef.current?.click()}
        >
          <ImageUp className="mr-2 h-4 w-4" />
          Read barcode from photo
        </Button>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            acceptBarcode(manualCode);
          }}
        >
          <Input
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="Enter UPC / barcode"
            className="font-mono"
          />
          <Button type="submit" disabled={!manualCode.trim()}>
            Use
          </Button>
        </form>
      </DialogContent>
    </Dialog>
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
