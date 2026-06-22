import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../env";
import { shrinkForAi, toDataUrl, AI_IMAGE_CONTENT_TYPE } from "./image";
import type { SupportedImageType } from "./image";

const BUCKET = "pottery";

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EXT_BY_TYPE: Record<SupportedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

let bucketReady: Promise<void> | null = null;

async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data } = await supabase.storage.getBucket(BUCKET);
      if (!data) {
        const { error } = await supabase.storage.createBucket(BUCKET, {
          public: false,
        });
        if (error && !/already exists/i.test(error.message)) {
          throw error;
        }
      }
    })();
  }
  return bucketReady;
}

export async function uploadImage(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<string> {
  await ensureBucket();
  const ext = EXT_BY_TYPE[contentType];
  const path = `items/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Download an image from private storage and return its raw bytes with
 * content-type.  Used internally to serve images through authenticated API
 * routes and to build data-URLs for AI calls.  Never used to produce
 * shareable bearer URLs.
 */
export async function downloadImageBuffer(
  path: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw error ?? new Error("Failed to download image");
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, contentType: data.type || "image/jpeg" };
}

export async function downloadImageAsDataUrl(path: string): Promise<string> {
  const { buffer, contentType } = await downloadImageBuffer(path);
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
  const { buffer } = await downloadImageBuffer(path);
  const shrunk = await shrinkForAi(buffer);
  return toDataUrl(shrunk, AI_IMAGE_CONTENT_TYPE);
}

export async function deleteImage(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}
