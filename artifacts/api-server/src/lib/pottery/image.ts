import sharp from "sharp";

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

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
 * Re-encode an image through sharp to strip all embedded metadata (EXIF, ICC
 * profiles, XMP, GPS, etc.) without altering the visible pixels.  The output
 * uses the same container format as the input so callers can continue using
 * the original `contentType`.
 */
export async function stripImageMetadata(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  const pipeline = sharp(buffer);
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
 * Downscale and re-encode a stored image before sending it to the AI.
 *
 * Resize to at most AI_MAX_DIMENSION × AI_MAX_DIMENSION (preserving aspect
 * ratio), strip all metadata, and encode as JPEG at AI_JPEG_QUALITY.  This
 * bounds each image to roughly 50–300 KB regardless of the original upload
 * size, preventing a high image-count compare request from exhausting memory.
 *
 * Always outputs JPEG so the returned content-type is predictable.
 */
const AI_MAX_DIMENSION = 1024;
const AI_JPEG_QUALITY = 82;

export async function shrinkForAi(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(AI_MAX_DIMENSION, AI_MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: AI_JPEG_QUALITY })
    .toBuffer();
}

export const AI_IMAGE_CONTENT_TYPE = "image/jpeg" as const;
