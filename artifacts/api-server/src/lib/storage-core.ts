import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { LRUCache } from "lru-cache";
import { env } from "./env";
import type { SupportedImageType } from "./image";
import {
  STANDARD_IMAGE_BUCKET_FILE_BYTES,
  SUPABASE_BUCKET_FILE_BYTES,
} from "./upload-limits";

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

// Bucket-partitioned byte-capped caches prevent a burst in one domain from
// evicting hot objects belonging to every other domain.
const PER_BUCKET_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES_PER_BUCKET = 250;
const downloadCaches = new Map<
  string,
  LRUCache<string, { buffer: Buffer; contentType: string }>
>();

function cacheScope(key: string): string {
  const separator = key.indexOf(":");
  return separator > 0 ? key.slice(0, separator) : "shared";
}

function cacheFor(key: string) {
  const scope = cacheScope(key);
  let cache = downloadCaches.get(scope);
  if (!cache) {
    cache = new LRUCache({
      max: MAX_CACHE_ENTRIES_PER_BUCKET,
      maxSize: PER_BUCKET_CACHE_BYTES,
      sizeCalculation: (value) => value.buffer.length,
      ttl: 5 * 60 * 1000,
      allowStale: false,
      updateAgeOnGet: true,
    });
    downloadCaches.set(scope, cache);
  }
  return cache;
}

function cacheGet(
  key: string,
): { buffer: Buffer; contentType: string } | undefined {
  return cacheFor(key).get(key);
}

function cacheSet(
  key: string,
  value: { buffer: Buffer; contentType: string },
): void {
  cacheFor(key).set(key, value);
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
  cacheFor(key).delete(key);
}

// ---------------------------------------------------------------------------
// Bucket policy helpers
// ---------------------------------------------------------------------------

export interface BucketPolicy {
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

/**
 * Minimal structural interface for the Supabase storage admin methods we need.
 * Using a structural type avoids the generic-parameter mismatch that arises
 * when passing `SupabaseClient<any, "public", ...>` to a signature that
 * expects a different generic instantiation.  Callers pass `supabase.storage`
 * directly.
 *
 * The parameter types use `any` intentionally so that the actual
 * `StorageClient` (which has more specific option shapes) is assignable here
 * — TypeScript's contravariant parameter checks would reject a narrower
 * `object` type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface StorageAdmin {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getBucket(id: string): Promise<{ data: any; error: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createBucket(id: string, options?: any): Promise<{ error: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBucket(id: string, options: any): Promise<{ error: any }>;
}

/**
 * Create a Supabase storage bucket with an explicit policy (size limit +
 * MIME-type allow-list) and always call `updateBucket` to patch any
 * already-existing bucket that was provisioned without those settings.
 *
 * Calling this on every server start is intentional: the `updateBucket` call
 * is idempotent and ensures live buckets that pre-date this feature are
 * brought up to the correct policy without a destructive recreate.
 *
 * @param storage — pass `supabase.storage` from your Supabase client.
 */
export async function ensureBucketWithPolicy(
  storage: StorageAdmin,
  bucket: string,
  policy: BucketPolicy,
): Promise<void> {
  const { data } = await storage.getBucket(bucket);
  if (!data) {
    const { error } = await storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: policy.fileSizeLimit,
      allowedMimeTypes: policy.allowedMimeTypes,
    });
    if (error && !/already exists/i.test(error.message)) {
      throw error;
    }
  }
  // Always patch the policy on already-existing buckets so pre-policy buckets
  // are brought up to spec on the next server start without manual intervention.
  const { error: updateError } = await storage.updateBucket(bucket, {
    public: false,
    fileSizeLimit: policy.fileSizeLimit,
    allowedMimeTypes: policy.allowedMimeTypes,
  });
  if (updateError) {
    throw updateError;
  }
}

// ---------------------------------------------------------------------------
// Per-bucket policies
// ---------------------------------------------------------------------------

export const IMAGE_ONLY_POLICY: BucketPolicy = {
  // Image-only buckets match the standard 25 MB inbound ceiling. The image
  // pipeline normalizes accepted images before persistence, so storage never
  // needs a broader limit than the request path that feeds it.
  fileSizeLimit: STANDARD_IMAGE_BUCKET_FILE_BYTES,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

export const TRAVELS_BUCKET_POLICY: BucketPolicy = {
  // Same 50 MB Supabase-side cap as above; travels accepts PDFs and plain-text
  // files (email body extractions stored as .txt for search/display).
  fileSizeLimit: SUPABASE_BUCKET_FILE_BYTES,
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
  ],
};

export const MESSENGER_BUCKET_POLICY: BucketPolicy = {
  // Same 50 MB Supabase-side cap; messenger accepts plain text too.
  // image/gif is stored raw (never re-encoded via stripMetadata, see
  // upload-validation) so animated GIFs — manual uploads and GIF-picker
  // sends alike — survive intact.
  fileSizeLimit: SUPABASE_BUCKET_FILE_BYTES,
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
  ],
};

export const RICH_TEXT_BUCKET_POLICY: BucketPolicy = {
  // Images embedded via the shared RichTextEditor (Travels reminder
  // descriptions, Office notes) — image-only, same 25 MB ceiling as the
  // other collection image buckets since these are inline content images,
  // not document attachments.
  fileSizeLimit: STANDARD_IMAGE_BUCKET_FILE_BYTES,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

export const ELAINE_ATTACHMENTS_BUCKET_POLICY: BucketPolicy = {
  // Same 50 MB Supabase-side cap. Elaine attachments cover images, PDFs, and
  // the office document formats she can both read and generate (CSV, DOCX,
  // XLSX) — see lib/document-parsing.ts and lib/document-generation.ts.
  fileSizeLimit: SUPABASE_BUCKET_FILE_BYTES,
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
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

  constructor(
    private readonly bucket: string,
    private readonly policy: BucketPolicy = IMAGE_ONLY_POLICY,
  ) {}

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = ensureBucketWithPolicy(
        this.supabase.storage,
        this.bucket,
        this.policy,
      ).catch((err) => {
        this.bucketReady = null;
        throw err;
      });
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

export function buildStorageAdapter(
  bucket: string,
  policy: BucketPolicy = IMAGE_ONLY_POLICY,
) {
  const svc = new ImageStorageService(bucket, policy);
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
