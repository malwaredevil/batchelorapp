import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { LRUCache } from "lru-cache";
import { env } from "./env";
import type { SupportedImageType } from "./image";

const EXT_BY_TYPE: Record<SupportedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// ---------------------------------------------------------------------------
// Shared download cache + concurrency limiter
//
// Every image-serving GET route (pottery/quilting/ornaments item images,
// supplemental images, fabric/quilt/pattern images) re-downloaded from
// Supabase Storage on every single request with no caching anywhere. List
// and gallery pages routinely render many images at once, so a page load
// bursts many simultaneous Storage downloads; under load this produced
// `ConnectTimeoutError`s from Supabase Storage (see the fabric tile-image
// incident this fixed), which surface to users as broken-image icons.
// Caching raw bytes here (keyed by bucket+path, which changes whenever an
// image is replaced) and bounding concurrency fixes this for every bucket
// at once, not just quilting fabrics.
// ---------------------------------------------------------------------------

// Byte-capped LRU image cache: max 256 MB or 500 entries, whichever is reached
// first. sizeCalculation charges each entry the actual buffer byte length, so
// one 10 MB TIFF doesn't silently crowd out hundreds of thumbnails. The built-in
// TTL (5 min) and updateAgeOnGet (LRU promotion) replace the manual Map-delete-
// reinsert pattern that was previously used to simulate LRU ordering.
const downloadCache = new LRUCache<
  string,
  { buffer: Buffer; contentType: string }
>({
  max: 500,
  maxSize: 256 * 1024 * 1024, // 256 MB hard ceiling
  sizeCalculation: (v) => v.buffer.length,
  ttl: 5 * 60 * 1000, // 5 minutes
  allowStale: false,
  updateAgeOnGet: true,
});

function cacheGet(
  key: string,
): { buffer: Buffer; contentType: string } | undefined {
  return downloadCache.get(key);
}

function cacheSet(
  key: string,
  value: { buffer: Buffer; contentType: string },
): void {
  downloadCache.set(key, value);
}

const DOWNLOAD_CONCURRENCY = 8;
let activeDownloads = 0;
const downloadQueue: Array<() => void> = [];

async function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeDownloads >= DOWNLOAD_CONCURRENCY) {
    await new Promise<void>((resolve) => downloadQueue.push(resolve));
  }
  activeDownloads++;
  try {
    return await fn();
  } finally {
    activeDownloads--;
    const next = downloadQueue.shift();
    if (next) next();
  }
}

const inFlightDownloads = new Map<
  string,
  Promise<{ buffer: Buffer; contentType: string }>
>();

/**
 * Generic cached/concurrency-limited/de-duplicated download wrapper, shared
 * by every storage module in the app (not just {@link ImageStorageService}).
 * `key` must be globally unique (e.g. `${bucket}:${path}`).
 */
export async function withCachedDownload(
  key: string,
  fetcher: () => Promise<{ buffer: Buffer; contentType: string }>,
): Promise<{ buffer: Buffer; contentType: string }> {
  const cached = cacheGet(key);
  if (cached) return cached;

  const inFlight = inFlightDownloads.get(key);
  if (inFlight) return inFlight;

  const promise = withDownloadSlot(async () => {
    const result = await fetcher();
    cacheSet(key, result);
    return result;
  }).finally(() => {
    inFlightDownloads.delete(key);
  });
  inFlightDownloads.set(key, promise);
  return promise;
}

export function invalidateCachedDownload(key: string): void {
  downloadCache.delete(key);
}

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
            { public: false, fileSizeLimit: 20 * 1024 * 1024 },
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
    return withCachedDownload(`${this.bucket}:${path}`, async () => {
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        .download(path);
      if (error || !data) {
        throw error ?? new Error("Failed to download image");
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      return { buffer, contentType: data.type || "image/jpeg" };
    });
  }

  /** Invalidate the cached bytes for a path — call after replacing/deleting an image. */
  invalidateImageCache(path: string): void {
    invalidateCachedDownload(`${this.bucket}:${path}`);
  }

  async deleteImage(path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([path]);
    if (error) throw error;
    this.invalidateImageCache(path);
  }
}

// ---------------------------------------------------------------------------
// buildStorageAdapter
//
// Factory that wraps ImageStorageService into a plain named-export object so
// domain storage modules can be reduced to a single call instead of hand-writing
// the same three forwarding functions for every new bucket. Specialised helpers
// (downloadAndShrinkImageForAi, downloadImageAsDataUrl) that require domain-
// specific image-processing utilities are not included here — each domain adds
// them on top of the three base exports.
//
// Usage:
//   const adapter = buildStorageAdapter("pottery");
//   export const { uploadImage, downloadImageBuffer, deleteImage } = adapter;
// ---------------------------------------------------------------------------

export function buildStorageAdapter(bucket: string) {
  const svc = new ImageStorageService(bucket);
  return {
    uploadImage: (
      buffer: Buffer,
      contentType: SupportedImageType,
    ): Promise<string> => svc.uploadImage(buffer, contentType),
    downloadImageBuffer: (
      path: string,
    ): Promise<{ buffer: Buffer; contentType: string }> =>
      svc.downloadImageBuffer(path),
    deleteImage: (path: string): Promise<void> => svc.deleteImage(path),
    invalidateImageCache: (path: string): void =>
      svc.invalidateImageCache(path),
  };
}
