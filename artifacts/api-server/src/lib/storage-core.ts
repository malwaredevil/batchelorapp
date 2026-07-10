import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
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

const DOWNLOAD_CACHE_MAX_ENTRIES = 500;
const downloadCache = new Map<
  string,
  { buffer: Buffer; contentType: string }
>();

function cacheGet(
  key: string,
): { buffer: Buffer; contentType: string } | undefined {
  const hit = downloadCache.get(key);
  if (hit === undefined) return undefined;
  downloadCache.delete(key);
  downloadCache.set(key, hit);
  return hit;
}

function cacheSet(
  key: string,
  value: { buffer: Buffer; contentType: string },
): void {
  downloadCache.delete(key);
  downloadCache.set(key, value);
  if (downloadCache.size > DOWNLOAD_CACHE_MAX_ENTRIES) {
    const oldestKey = downloadCache.keys().next().value;
    if (oldestKey !== undefined) downloadCache.delete(oldestKey);
  }
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
    await this.supabase.storage.from(this.bucket).remove([path]);
    this.invalidateImageCache(path);
  }
}
