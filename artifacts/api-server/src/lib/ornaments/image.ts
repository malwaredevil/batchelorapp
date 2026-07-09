import sharp from "sharp";
import { getThresholds } from "../ai-client";

export {
  sniffImageType,
  toDataUrl,
  stripImageMetadata,
  type SupportedImageType,
} from "../image";

const MAX_INPUT_PIXELS = 50_000_000;
const AI_MAX_DIMENSION = 1024;
const AI_JPEG_QUALITY_FALLBACK = 82;

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
