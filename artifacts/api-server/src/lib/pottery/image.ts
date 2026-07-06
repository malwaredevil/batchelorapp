import sharp from "sharp";
import { getThresholds } from "../ai-client";

// Shared, hardened image primitives (strict pixel ceiling, EXIF orientation
// baked in, metadata stripped, storage-dimension cap) live in ../image. Pottery
// re-exports them so its upload/compare paths get the same decompression-bomb
// and EXIF protections as quilting, while keeping the historical pottery import
// surface (shrinkForAi / AI_IMAGE_CONTENT_TYPE) unchanged.
export {
  sniffImageType,
  toDataUrl,
  stripImageMetadata,
  type SupportedImageType,
} from "../image";

/**
 * Hard ceiling on the number of pixels Sharp will decode from any input — guards
 * against decompression-bomb uploads (a tiny file that expands to a huge raster).
 * 50 MP covers any real phone/camera photo while blocking pathological inputs.
 */
const MAX_INPUT_PIXELS = 50_000_000;

const AI_MAX_DIMENSION = 1024;
// Fallback used only if the global config can't be loaded — see
// thresholds.aiJpegQuality in lib/elaine-config.ts for the admin-editable
// value normally used.
const AI_JPEG_QUALITY_FALLBACK = 82;

/**
 * Downscale and re-encode a stored image before sending it to the AI.
 *
 * Decode under a strict pixel ceiling, bake in EXIF orientation, resize to at
 * most AI_MAX_DIMENSION × AI_MAX_DIMENSION (preserving aspect ratio), strip all
 * metadata, and encode as JPEG. This bounds each image to roughly 50–300 KB
 * regardless of the original upload size, preventing a high image-count compare
 * request from exhausting memory.
 */
export async function shrinkForAi(buffer: Buffer): Promise<Buffer> {
  let quality = AI_JPEG_QUALITY_FALLBACK;
  try {
    quality = (await getThresholds()).aiJpegQuality;
  } catch {
    // fall back to the hardcoded default above
  }
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(AI_MAX_DIMENSION, AI_MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality })
    .toBuffer();
}

export const AI_IMAGE_CONTENT_TYPE = "image/jpeg" as const;
