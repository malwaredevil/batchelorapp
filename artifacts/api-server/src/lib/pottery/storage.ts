import { ImageStorageService } from "../storage-core";
import { shrinkForAi, toDataUrl, AI_IMAGE_CONTENT_TYPE } from "./image";
import type { SupportedImageType } from "./image";

const storage = new ImageStorageService("pottery");

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

export async function downloadImageAsDataUrl(path: string): Promise<string> {
  const { buffer, contentType } = await storage.downloadImageBuffer(path);
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * Download a stored image and return a shrunk JPEG data URL suitable for AI
 * calls.  Resize to at most 1024×1024 (preserving aspect ratio) and re-encode
 * as JPEG — this bounds each image to roughly 50–300 KB regardless of upload
 * size, so a high-count compare request cannot exhaust server memory.
 */
export async function downloadAndShrinkImageForAi(
  path: string,
): Promise<string> {
  const { buffer } = await storage.downloadImageBuffer(path);
  const shrunk = await shrinkForAi(buffer);
  return toDataUrl(shrunk, AI_IMAGE_CONTENT_TYPE);
}

export async function deleteImage(path: string): Promise<void> {
  return storage.deleteImage(path);
}
