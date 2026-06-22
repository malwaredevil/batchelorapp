import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import type { SupportedImageType } from "./image";

const EXT_BY_TYPE: Record<SupportedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Bucket-scoped wrapper around Supabase private object storage. Both apps store
 * uploaded images identically — the only difference is the bucket name — so the
 * shared upload/download/delete plumbing lives here once. App-specific data-URL
 * helpers (AI shrinking, bounded re-encode) are layered on top in each app's
 * own storage module using {@link downloadImageBuffer}.
 */
export class ImageStorageService {
  private readonly supabase = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  private bucketReady: Promise<void> | null = null;

  constructor(private readonly bucket: string) {}

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const { data } = await this.supabase.storage.getBucket(this.bucket);
        if (!data) {
          const { error } = await this.supabase.storage.createBucket(
            this.bucket,
            { public: false },
          );
          if (error && !/already exists/i.test(error.message)) {
            throw error;
          }
        }
      })();
    }
    return this.bucketReady;
  }

  async uploadImage(
    buffer: Buffer,
    contentType: SupportedImageType,
  ): Promise<string> {
    await this.ensureBucket();
    const ext = EXT_BY_TYPE[contentType];
    const path = `items/${randomUUID()}.${ext}`;
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType, upsert: false });
    if (error) throw error;
    return path;
  }

  /**
   * Download an image from private storage and return its raw bytes with
   * content-type. Used internally to serve images through authenticated API
   * routes and to build data-URLs for AI calls. Never used to produce
   * shareable bearer URLs.
   */
  async downloadImageBuffer(
    path: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .download(path);
    if (error || !data) {
      throw error ?? new Error("Failed to download image");
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    return { buffer, contentType: data.type || "image/jpeg" };
  }

  async deleteImage(path: string): Promise<void> {
    await this.supabase.storage.from(this.bucket).remove([path]);
  }
}
