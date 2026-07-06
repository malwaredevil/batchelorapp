import sharp from "sharp";
import { getThresholds } from "./ai-client";

/**
 * Crop a region from an image buffer using a normalised bounding box
 * [x, y, width, height] where each value is a fraction 0-1 of the image
 * dimensions. Returns a JPEG buffer, or null if the crop is invalid / too small.
 */
export async function cropPatternRegion(
  imageBuffer: Buffer,
  box: [number, number, number, number],
): Promise<Buffer | null> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const iw = metadata.width ?? 0;
    const ih = metadata.height ?? 0;
    if (!iw || !ih) return null;

    const [fx, fy, fw, fh] = box;
    const left = Math.max(0, Math.round(fx * iw));
    const top = Math.max(0, Math.round(fy * ih));
    const width = Math.min(Math.round(fw * iw), iw - left);
    const height = Math.min(Math.round(fh * ih), ih - top);

    if (width < 20 || height < 20) return null;

    const thresholds = await getThresholds();
    return await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: thresholds.aiJpegQuality })
      .toBuffer();
  } catch {
    return null;
  }
}
