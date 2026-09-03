/**
 * Browser-side image normalization for camera captures.
 *
 * Camera photos commonly carry their rotation in EXIF metadata instead of
 * storing upright pixels. This module turns those photos into ordinary JPEG
 * pixels before they reach a preview, AI service, or upload endpoint.
 */

export class ImageCaptureDecodeError extends Error {
  constructor(
    message = "Could not read this image. Please try another photo.",
  ) {
    super(message);
    this.name = "ImageCaptureDecodeError";
  }
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  orientationApplied: boolean;
  close?: () => void;
};

function readExifOrientation(buffer: ArrayBuffer): number {
  const bytes = new DataView(buffer);
  if (bytes.byteLength < 4 || bytes.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes.getUint8(offset) !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = bytes.getUint16(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.byteLength) {
      break;
    }

    if (marker === 0xe1 && segmentLength >= 8) {
      const exifStart = offset + 4;
      if (
        bytes.getUint8(exifStart) === 0x45 &&
        bytes.getUint8(exifStart + 1) === 0x78 &&
        bytes.getUint8(exifStart + 2) === 0x69 &&
        bytes.getUint8(exifStart + 3) === 0x66 &&
        bytes.getUint8(exifStart + 4) === 0x00 &&
        bytes.getUint8(exifStart + 5) === 0x00
      ) {
        const tiffStart = exifStart + 6;
        if (tiffStart + 8 > bytes.byteLength) return 1;
        const littleEndian = bytes.getUint16(tiffStart) === 0x4949;
        if (bytes.getUint16(tiffStart + 2, littleEndian) !== 42) return 1;
        const ifdOffset = bytes.getUint32(tiffStart + 4, littleEndian);
        const ifdStart = tiffStart + ifdOffset;
        if (ifdStart + 2 > bytes.byteLength) return 1;
        const entryCount = bytes.getUint16(ifdStart, littleEndian);
        for (let i = 0; i < entryCount; i++) {
          const entry = ifdStart + 2 + i * 12;
          if (entry + 12 > bytes.byteLength) break;
          if (bytes.getUint16(entry, littleEndian) !== 0x0112) continue;
          if (bytes.getUint16(entry + 2, littleEndian) !== 3) return 1;
          const value = bytes.getUint16(entry + 8, littleEndian);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
    }
    offset += 2 + segmentLength;
  }
  return 1;
}

function drawWithOrientation(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  orientation: number,
) {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }
  ctx.drawImage(source, 0, 0);
}

async function decodeImage(file: File): Promise<DecodedImage> {
  const createBitmap = globalThis.createImageBitmap;
  if (createBitmap) {
    try {
      const bitmap = await createBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientationApplied: true,
        close: () => bitmap.close(),
      };
    } catch {
      // Try a manual EXIF transform below.
    }

    try {
      const bitmap = await createBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientationApplied: false,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement for Safari and older browsers.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new ImageCaptureDecodeError());
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      orientationApplied: false,
    };
  } catch {
    throw new ImageCaptureDecodeError();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new ImageCaptureDecodeError("Could not prepare this image."),
            ),
      "image/jpeg",
      0.95,
    );
  });
}

async function uprightCanvas(file: File): Promise<HTMLCanvasElement> {
  const decoded = await decodeImage(file);
  try {
    // Camera inputs have occasionally reported an empty or nonstandard MIME
    // label even though the bytes are JPEG. The EXIF parser already verifies
    // the JPEG signature, so use the bytes as the source of truth here.
    const orientation = decoded.orientationApplied
      ? 1
      : readExifOrientation(await file.arrayBuffer());
    const orientedWidth =
      orientation >= 5 && orientation <= 8 ? decoded.height : decoded.width;
    const orientedHeight =
      orientation >= 5 && orientation <= 8 ? decoded.width : decoded.height;
    const canvas = document.createElement("canvas");
    canvas.width = orientedWidth;
    canvas.height = orientedHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new ImageCaptureDecodeError("Could not prepare this image.");
    drawWithOrientation(
      ctx,
      decoded.source,
      decoded.width,
      decoded.height,
      orientation,
    );
    return canvas;
  } finally {
    decoded.close?.();
  }
}

async function canvasFile(
  canvas: HTMLCanvasElement,
  sourceName: string,
  suffix = "",
): Promise<File> {
  const blob = await canvasBlob(canvas);
  const base = sourceName.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}${suffix}.jpg`, { type: "image/jpeg" });
}

/** Bake EXIF orientation into pixels while preserving the photo's aspect ratio. */
export async function normalizeCapturedImage(file: File): Promise<File> {
  return canvasFile(await uprightCanvas(file), file.name);
}

async function rotateImage(
  file: File,
  direction: "clockwise" | "counterclockwise",
): Promise<File> {
  const upright = await uprightCanvas(file);
  const rotated = document.createElement("canvas");
  rotated.width = upright.height;
  rotated.height = upright.width;
  const ctx = rotated.getContext("2d");
  if (!ctx) throw new ImageCaptureDecodeError("Could not prepare this image.");
  if (direction === "clockwise") {
    ctx.translate(rotated.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, rotated.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(upright, 0, 0);
  return canvasFile(rotated, file.name, "-rotated");
}

/** Rotate an already-normalized image clockwise and return the new upload file. */
export async function rotateImageClockwise(file: File): Promise<File> {
  return rotateImage(file, "clockwise");
}

/** Rotate an already-normalized image counterclockwise and return the new upload file. */
export async function rotateImageCounterClockwise(file: File): Promise<File> {
  return rotateImage(file, "counterclockwise");
}
