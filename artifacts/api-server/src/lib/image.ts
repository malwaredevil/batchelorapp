import sharp from "sharp";

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Hard ceiling on the number of pixels Sharp will decode from any input. This
 * rejects "decompression bomb" uploads — a tiny file that expands to a huge
 * raster — before they can exhaust CPU/memory. 50 MP comfortably covers any
 * real phone/camera photo while blocking pathological inputs.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Longest-edge cap for images we persist. Keeps stored originals at a sane size
 * for display without letting a single upload balloon storage or later AI
 * payloads. A 2048px JPEG is well under ~1 MB.
 */
const MAX_STORAGE_DIMENSION = 2048;

/**
 * Longest-edge cap for images handed to the vision model. Vision models tile
 * images at ~512px, so 1024px is plenty of detail while keeping each base64
 * payload small. This is the key bound that stops the compare fan-out from
 * turning a handful of stored images into hundreds of megabytes of request body.
 */
const MAX_AI_DIMENSION = 1024;

/**
 * Sniff the real image type from the file's magic bytes. Returns null for any
 * content that is not a supported image, regardless of the declared MIME type.
 */
export function sniffImageType(buffer: Buffer): SupportedImageType | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function toDataUrl(buffer: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * Decode `buffer` with a strict pixel ceiling, bake in EXIF orientation, strip
 * all embedded metadata (EXIF, ICC, XMP, GPS, etc.), downscale so the longest
 * edge is at most `maxDimension`, and re-encode in the same container format.
 *
 * Centralising decode here means every untrusted image — whether it is stored
 * or sent to a third party — passes through the same bounded pipeline.
 */
async function processImage(
  buffer: Buffer,
  contentType: SupportedImageType,
  maxDimension: number,
): Promise<Buffer> {
  const pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  switch (contentType) {
    case "image/jpeg":
      return pipeline.jpeg().toBuffer();
    case "image/png":
      return pipeline.png().toBuffer();
    case "image/webp":
      return pipeline.webp().toBuffer();
  }
}

/**
 * Normalise an uploaded image for persistence: metadata stripped and bounded to
 * {@link MAX_STORAGE_DIMENSION}. Output uses the same container format as the
 * input so callers can keep using the original `contentType`.
 */
export async function stripImageMetadata(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  return processImage(buffer, contentType, MAX_STORAGE_DIMENSION);
}

/**
 * Produce a data URL for a vision-model request, bounded to
 * {@link MAX_AI_DIMENSION}. Used for both freshly uploaded candidates and
 * images pulled from storage, so legacy oversized originals are also capped
 * before they reach the AI request body.
 */
export async function toAiDataUrl(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<string> {
  const bounded = await processImage(buffer, contentType, MAX_AI_DIMENSION);
  return toDataUrl(bounded, contentType);
}
