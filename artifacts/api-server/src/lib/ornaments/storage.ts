import { ImageStorageService } from "../storage-core";
import { shrinkForAi, toDataUrl, AI_IMAGE_CONTENT_TYPE } from "./image";
import type { SupportedImageType } from "./image";

const storage = new ImageStorageService("ornaments");

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
