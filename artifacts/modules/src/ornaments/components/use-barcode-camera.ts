import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  DecodeHintType,
  NotFoundException,
} from "@zxing/library";

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

export function useBarcodeCamera(input: {
  enabled: boolean;
  onDetected: (barcode: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const onDetectedRef = useRef(input.onDetected);
  const [isScanning, setIsScanning] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);

  useEffect(() => {
    onDetectedRef.current = input.onDetected;
  }, [input.onDetected]);

  const stopScanning = useCallback(() => {
    scanningRef.current = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    codeReaderRef.current?.reset();
    setIsScanning(false);
  }, []);

  const barcodeDetectorLoop = useCallback(
    async function detectFrame() {
      if (!scanningRef.current || !detectorRef.current || !videoRef.current) {
        return;
      }
      if (videoRef.current.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(() => {
          void detectFrame();
        });
        return;
      }
      try {
        const barcodes = await detectorRef.current.detect(videoRef.current);
        if (!scanningRef.current) return;
        const barcode = barcodes[0]?.rawValue?.trim();
        if (barcode) {
          stopScanning();
          onDetectedRef.current(barcode);
          return;
        }
      } catch {
        // A frame can be unavailable while the camera is warming up.
      }
      if (scanningRef.current) {
        animationFrameRef.current = requestAnimationFrame(() => {
          void detectFrame();
        });
      }
    },
    [stopScanning],
  );

  const startScanning = useCallback(async () => {
    if (!videoRef.current || scanningRef.current) return;
    scanningRef.current = true;
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
        animationFrameRef.current = requestAnimationFrame(() => {
          void barcodeDetectorLoop();
        });
        return;
      } catch {
        stopScanning();
        setHasCamera(false);
        return;
      }
    }

    if (codeReaderRef.current) {
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
          (result, error) => {
            if (result) {
              stopScanning();
              onDetectedRef.current(result.getText());
            } else if (error && !(error instanceof NotFoundException)) {
              console.error(error);
            }
          },
        );
      } catch {
        stopScanning();
        setHasCamera(false);
      }
    }
  }, [barcodeDetectorLoop, stopScanning]);

  useEffect(() => {
    if (!input.enabled) {
      stopScanning();
      return;
    }
    if (!navigator.mediaDevices) {
      setHasCamera(false);
      return;
    }

    let nativeDetectorReady = false;
    if ("BarcodeDetector" in window) {
      try {
        detectorRef.current = new BarcodeDetector({
          formats: BARCODE_FORMATS_NATIVE,
        });
        nativeDetectorReady = true;
      } catch {
        detectorRef.current = null;
      }
    }
    if (!nativeDetectorReady) {
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS_ZXING);
      codeReaderRef.current = new BrowserMultiFormatReader(hints, 150);
    }

    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const available = devices.some(
          (device) => device.kind === "videoinput",
        );
        setHasCamera(available);
        if (available) void startScanning();
      })
      .catch(() => setHasCamera(false));

    return stopScanning;
  }, [input.enabled, startScanning, stopScanning]);

  return {
    videoRef,
    isScanning,
    hasCamera,
    startScanning,
    stopScanning,
  };
}
