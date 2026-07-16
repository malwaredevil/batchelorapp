import { buildStorageAdapter } from "./storage-core";
import { sniffImageType, toAiDataUrl, type SupportedImageType } from "./image";

const adapter = buildStorageAdapter("quilting");

export const uploadImage = adapter.uploadImage;
export const downloadImageBuffer = adapter.downloadImageBuffer;
export const deleteImage = adapter.deleteImage;
export type { SupportedImageType };

/**
 * Download an image from private storage and return a data URL bounded to the
 * AI dimension cap. Re-encoding here means even oversized originals stored
 * before resolution limits were enforced cannot bloat a vision-model request.
 */
export async function downloadImageAsDataUrl(path: string): Promise<string> {
  const { buffer } = await adapter.downloadImageBuffer(path);
  const contentType = sniffImageType(buffer);
  if (!contentType) {
    throw new Error(`Stored object is not a supported image: ${path}`);
  }
  return toAiDataUrl(buffer, contentType);
}
