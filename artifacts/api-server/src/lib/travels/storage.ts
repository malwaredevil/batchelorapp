import { ImageStorageService, TRAVELS_BUCKET_POLICY } from "../storage-core";

const storage = new ImageStorageService("travels", TRAVELS_BUCKET_POLICY);

export async function uploadTripPhoto(
  buffer: Buffer,
  contentType: "image/jpeg" | "image/png" | "image/webp",
): Promise<string> {
  return storage.uploadImage(buffer, contentType);
}

export async function downloadTripPhoto(
  path: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  return storage.downloadImageBuffer(path);
}

export async function deleteTripPhoto(path: string): Promise<void> {
  return storage.deleteImage(path);
}
