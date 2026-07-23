import { buildStorageAdapter, IMAGE_ONLY_POLICY } from "../storage-core";
import { shrinkForAi, toDataUrl, AI_IMAGE_CONTENT_TYPE } from "./image";

const adapter = buildStorageAdapter("pottery", IMAGE_ONLY_POLICY);

export const uploadImage = adapter.uploadImage;
export const downloadImageBuffer = adapter.downloadImageBuffer;
export const deleteImage = adapter.deleteImage;
export const invalidateImageCache = adapter.invalidateImageCache;

export async function downloadImageAsDataUrl(path: string): Promise<string> {
  const { buffer, contentType } = await adapter.downloadImageBuffer(path);
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * Download a stored image and return a shrunk JPEG data URL suitable for AI
 * calls. Resize to at most 1024×1024 (preserving aspect ratio) and re-encode
 * as JPEG — this bounds each image to roughly 50–300 KB regardless of upload
 * size, so a high-count compare request cannot exhaust server memory.
 */
export async function downloadAndShrinkImageForAi(
  path: string,
): Promise<string> {
  const { buffer } = await adapter.downloadImageBuffer(path);
  const shrunk = await shrinkForAi(buffer);
  return toDataUrl(shrunk, AI_IMAGE_CONTENT_TYPE);
}
