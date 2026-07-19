/**
 * Minimal TypeScript declarations for the BarcodeDetector Web API.
 * https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API
 *
 * BarcodeDetector is available natively in Chrome/Edge/Android WebView and
 * hardware-accelerated. Safari and Firefox fall back to ZXing instead.
 *
 * Named NativeBarcodeFormat (not BarcodeFormat) to avoid colliding with
 * ZXing's BarcodeFormat enum that is imported in consumer modules.
 */

type NativeBarcodeFormat =
  | "aztec"
  | "code_128"
  | "code_39"
  | "code_93"
  | "codabar"
  | "data_matrix"
  | "ean_13"
  | "ean_8"
  | "itf"
  | "pdf417"
  | "qr_code"
  | "upc_a"
  | "upc_e"
  | "unknown";

interface DetectedBarcode {
  rawValue: string;
  format: NativeBarcodeFormat;
  cornerPoints: ReadonlyArray<{ x: number; y: number }>;
  boundingBox: DOMRectReadOnly;
}

interface BarcodeDetectorOptions {
  formats?: NativeBarcodeFormat[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<NativeBarcodeFormat[]>;
  detect(
    image: ImageBitmapSource | HTMLVideoElement | HTMLCanvasElement,
  ): Promise<DetectedBarcode[]>;
}
