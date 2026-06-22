import { ImageStorageService } from "./storage-core";
import { sniffImageType, toAiDataUrl, type SupportedImageType } from "./image";

const storage = new ImageStorageService("quilting");

export async function uploadImage(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<string> {
  return storage.uploadImage(buffer, contentType);
}

export async function downloadImageBuffer(
  path: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  return storage.downloadImageBuffer(path);
}

/**
 * Download an image from private storage and return a data URL bounded to the
 * AI dimension cap. Re-encoding here means even oversized originals stored
 * before resolution limits were enforced cannot bloat a vision-model request.
 */
export async function downloadImageAsDataUrl(path: string): Promise<string> {
  const { buffer } = await storage.downloadImageBuffer(path);
  const contentType = sniffImageType(buffer);
  if (!contentType) {
    throw new Error(`Stored object is not a supported image: ${path}`);
  }
  return toAiDataUrl(buffer, contentType);
}

export async function deleteImage(path: string): Promise<void> {
  return storage.deleteImage(path);
}
