import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  DecodeHintType,
  NotFoundException,
} from "@zxing/library";

interface NativeBarcodeResult {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(image: HTMLVideoElement): Promise<NativeBarcodeResult[]>;
}

interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
}

const BARCODE_FORMATS_NATIVE = [
  "upc_a",
  "upc_e",
  "ean_13",
  "ean_8",
  "code_128",
  "code_39",
];

const BARCODE_FORMATS_ZXING = [
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
];

export const DEFAULT_CONFIRMATION_FRAMES = 3;

/**
 * Requires a barcode to be decoded identically several times before the UI
 * accepts it. A one-frame read on a glossy, curved, or moving label can be
 * wrong while still passing a barcode format's own checksum.
 */
export function createBarcodeConfirmation(
  requiredFrames = DEFAULT_CONFIRMATION_FRAMES,
) {
  let pendingCode: string | null = null;
  let consecutiveFrames = 0;

  return {
    register(code: string) {
      const normalized = code.trim();
      if (!normalized) {
        return { accepted: false, progress: 0 };
      }
      if (normalized === pendingCode) {
        consecutiveFrames += 1;
      } else {
        pendingCode = normalized;
        consecutiveFrames = 1;
      }

      if (consecutiveFrames >= requiredFrames) {
        pendingCode = null;
        consecutiveFrames = 0;
        return { accepted: true, progress: requiredFrames };
      }
      return { accepted: false, progress: consecutiveFrames };
    },
    reset() {
      pendingCode = null;
      consecutiveFrames = 0;
    },
  };
}

export function useBarcodeCamera(input: {
  enabled: boolean;
  onDetected: (barcode: string) => void;
  confirmationFrames?: number;
}) {
  const requiredFrames =
    input.confirmationFrames ?? DEFAULT_CONFIRMATION_FRAMES;
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const onDetectedRef = useRef(input.onDetected);
  const confirmationRef = useRef(createBarcodeConfirmation(requiredFrames));
  const [isScanning, setIsScanning] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);
  const [confirmationProgress, setConfirmationProgress] = useState(0);

  useEffect(() => {
    onDetectedRef.current = input.onDetected;
  }, [input.onDetected]);

  useEffect(() => {
    confirmationRef.current = createBarcodeConfirmation(requiredFrames);
  }, [requiredFrames]);

  const stopScanning = useCallback(() => {
    scanningRef.current = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (codeReaderRef.current) {
      try {
        codeReaderRef.current.reset();
      } catch {
        // The reader may already have been reset by an unmounting video node.
      }
      codeReaderRef.current = null;
    }
    confirmationRef.current.reset();
    setConfirmationProgress(0);
    setIsScanning(false);
  }, []);

  const registerDetection = useCallback(
    (barcode: string) => {
      const result = confirmationRef.current.register(barcode);
      setConfirmationProgress(result.progress);
      if (!result.accepted) return;
      stopScanning();
      onDetectedRef.current(barcode.trim());
    },
    [stopScanning],
  );

  const startScanning = useCallback(async () => {
    if (scanningRef.current || !videoRef.current || !navigator.mediaDevices) {
      if (!navigator.mediaDevices) setHasCamera(false);
      return;
    }

    confirmationRef.current.reset();
    setConfirmationProgress(0);
    setHasCamera(true);
    scanningRef.current = true;
    setIsScanning(true);

    const nativeConstructor = (
      window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }
    ).BarcodeDetector;

    if (nativeConstructor) {
      try {
        detectorRef.current = new nativeConstructor({
          formats: BARCODE_FORMATS_NATIVE,
        });
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

        const detectFrame = async () => {
          if (
            !scanningRef.current ||
            !detectorRef.current ||
            !videoRef.current
          ) {
            return;
          }
          if (videoRef.current.readyState >= 2) {
            try {
              const barcodes = await detectorRef.current.detect(
                videoRef.current,
              );
              const barcode = barcodes[0]?.rawValue;
              if (barcode && scanningRef.current) registerDetection(barcode);
            } catch {
              // A frame can be unavailable while the camera is warming up.
            }
          }
          if (scanningRef.current) {
            animationFrameRef.current = requestAnimationFrame(() => {
              void detectFrame();
            });
          }
        };

        animationFrameRef.current = requestAnimationFrame(() => {
          void detectFrame();
        });
        return;
      } catch (error) {
        // BarcodeDetector can be unsupported or fail to initialize even where
        // getUserMedia is supported, so try ZXing before giving up.
        console.warn(
          "Barcode scanner: native detector failed; falling back to ZXing",
          error,
        );
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        detectorRef.current = null;
      }
    }

    try {
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS_ZXING);
      const reader = new BrowserMultiFormatReader(hints, 150);
      codeReaderRef.current = reader;
      await reader.decodeFromConstraints(
        {
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current,
        (result, error) => {
          if (result && scanningRef.current) {
            registerDetection(result.getText());
          } else if (error && !(error instanceof NotFoundException)) {
            console.warn("Barcode scanner: ZXing decode error", error);
          }
        },
      );
    } catch (error) {
      console.warn("Barcode scanner: camera unavailable", error);
      stopScanning();
      setHasCamera(false);
    }
  }, [registerDetection, stopScanning]);

  useEffect(() => {
    if (!input.enabled) {
      stopScanning();
      return;
    }
    void startScanning();
    return stopScanning;
  }, [input.enabled, startScanning, stopScanning]);

  return {
    videoRef,
    isScanning,
    hasCamera,
    confirmationProgress,
    startScanning,
    stopScanning,
  };
}
