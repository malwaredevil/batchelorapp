import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StorageObjectEntry = {
  path: string;
  createdAt: string | null;
};

export type BucketReport = {
  bucket: string;
  scannedAt: string;
  totalStorageObjects: number;
  totalDbPaths: number;
  orphanedObjects: StorageObjectEntry[];
  missingObjects: string[];
  staleTempObjects: StorageObjectEntry[];
  error?: string;
};

export type ReconcileReport = {
  generatedAt: string;
  durationMs: number;
  triggeredBy: string;
  buckets: BucketReport[];
  summary: {
    totalOrphans: number;
    totalMissing: number;
    totalStaleTemp: number;
    bucketsWithErrors: number;
  };
};

// ---------------------------------------------------------------------------
// Supabase storage helpers
// ---------------------------------------------------------------------------

type StorageItem = {
  name: string;
  id: string | null;
  created_at?: string | null;
};

function getSupabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Recursively list all objects in a bucket, returning their full paths.
 * Supabase Storage's list() call returns folders (id === null) that must be
 * descended into, and files (id !== null) that are leaf objects.
 */
export async function listAllObjects(
  bucket: string,
  prefix: string = "",
): Promise<StorageObjectEntry[]> {
  const supabase = getSupabase();
  const PAGE_SIZE = 100;
  const all: StorageObjectEntry[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(
        `Failed to list objects in bucket "${bucket}" prefix "${prefix}": ${error.message}`,
      );
    }
    if (!data || data.length === 0) break;

    for (const item of data as StorageItem[]) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        const nested = await listAllObjects(bucket, fullPath);
        all.push(...nested);
      } else {
        all.push({
          path: fullPath,
          createdAt: item.created_at ?? null,
        });
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

// ---------------------------------------------------------------------------
// DB path fetching (raw SQL to avoid ORM column coupling)
// ---------------------------------------------------------------------------

type DbRow = { path: string };

async function fetchDbPaths(query: string): Promise<Set<string>> {
  const { pool } = await import("@workspace/db");
  const result = await pool.query<DbRow>(query);
  const paths = new Set<string>();
  for (const row of result.rows) {
    if (row.path) paths.add(row.path);
  }
  return paths;
}

/**
 * For the elaine-attachments bucket: attachment_urls are stored as a JSONB
 * array of Supabase Storage signed/public URLs in elaine_conversations. Extract
 * the storage path from each URL so we can cross-reference against real objects.
 *
 * Signed URL format:  https://<project>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
 * Public URL format:  https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 */
export function extractPathFromAttachmentUrl(
  url: string,
  bucket: string,
): string | null {
  try {
    const parsed = new URL(url);
    for (const segment of [
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/public/${bucket}/`,
    ]) {
      const idx = parsed.pathname.indexOf(segment);
      if (idx !== -1) {
        return decodeURIComponent(parsed.pathname.slice(idx + segment.length));
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract a URL string from an elaine attachment entry.
 * Historical rows stored plain strings; current rows store AttachmentRef
 * objects ({ url, type, name? }).  Both shapes are supported.
 * Exported for unit testing.
 */
export function extractAttachmentUrl(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (
    item !== null &&
    typeof item === "object" &&
    typeof (item as Record<string, unknown>).url === "string"
  ) {
    return (item as Record<string, unknown>).url as string;
  }
  return null;
}

async function fetchElaineAttachmentPaths(): Promise<Set<string>> {
  const { pool } = await import("@workspace/db");
  const result = await pool.query<{ attachment_urls: unknown }>(
    `SELECT attachment_urls FROM elaine_history_messages
     WHERE attachment_urls IS NOT NULL AND jsonb_array_length(attachment_urls::jsonb) > 0`,
  );
  const paths = new Set<string>();
  const bucket = "elaine-attachments";
  for (const row of result.rows) {
    const urls = row.attachment_urls;
    if (!Array.isArray(urls)) continue;
    for (const item of urls) {
      const url = extractAttachmentUrl(item);
      if (!url) continue;
      const path = extractPathFromAttachmentUrl(url, bucket);
      if (path) paths.add(path);
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Stale temp object detection
// ---------------------------------------------------------------------------

const TEMP_PATTERNS = [/^tmp\//i, /^temp\//i, /^uploading\//i, /\.tmp$/i];
const STALE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function isStaleTempObject(obj: StorageObjectEntry): boolean {
  const matchesTempPattern = TEMP_PATTERNS.some((re) => re.test(obj.path));
  if (!matchesTempPattern) return false;
  if (!obj.createdAt) return true;
  const age = Date.now() - new Date(obj.createdAt).getTime();
  return age > STALE_AGE_MS;
}

// ---------------------------------------------------------------------------
// Per-bucket reconcile configuration
// ---------------------------------------------------------------------------

type BucketConfig = {
  bucket: string;
  getDbPaths: () => Promise<Set<string>>;
};

/**
 * SQL queries used to build the DB-path set for each bucket.
 * Exported so unit tests can directly assert coverage (tables + columns)
 * without going through the full reconcile run.
 */
export const BUCKET_DB_SQL: Record<string, string> = {
  pottery: `
        SELECT image_path AS path FROM pottery_items WHERE image_path IS NOT NULL
        UNION ALL
        SELECT pattern_crop_path AS path FROM pottery_items WHERE pattern_crop_path IS NOT NULL
        UNION ALL
        SELECT storage_path AS path FROM pottery_images WHERE storage_path IS NOT NULL
      `,
  quilting: `
        SELECT image_path AS path FROM quilting_fabrics WHERE image_path IS NOT NULL
        UNION ALL
        SELECT image_path AS path FROM quilting_patterns WHERE image_path IS NOT NULL
        UNION ALL
        SELECT image_path AS path FROM quilting_finished_quilts WHERE image_path IS NOT NULL
        UNION ALL
        SELECT storage_path AS path FROM quilting_images WHERE storage_path IS NOT NULL
      `,
  ornaments: `
        SELECT image_path AS path FROM ornaments_items WHERE image_path IS NOT NULL
        UNION ALL
        SELECT storage_path AS path FROM ornaments_images WHERE storage_path IS NOT NULL
      `,
  travels: `
        SELECT storage_path AS path FROM travels_trip_documents WHERE storage_path IS NOT NULL
        UNION ALL
        SELECT storage_path AS path FROM travels_trip_photos WHERE storage_path IS NOT NULL
      `,
  messenger: `
        SELECT storage_path AS path FROM messenger_attachments WHERE storage_path IS NOT NULL
      `,
};

const BUCKET_CONFIGS: BucketConfig[] = [
  {
    bucket: "pottery",
    getDbPaths: () => fetchDbPaths(BUCKET_DB_SQL.pottery),
  },
  {
    bucket: "quilting",
    getDbPaths: () => fetchDbPaths(BUCKET_DB_SQL.quilting),
  },
  {
    bucket: "ornaments",
    getDbPaths: () => fetchDbPaths(BUCKET_DB_SQL.ornaments),
  },
  {
    bucket: "travels",
    getDbPaths: () => fetchDbPaths(BUCKET_DB_SQL.travels),
  },
  {
    bucket: "messenger",
    getDbPaths: () => fetchDbPaths(BUCKET_DB_SQL.messenger),
  },
  {
    bucket: "elaine-attachments",
    getDbPaths: fetchElaineAttachmentPaths,
  },
];

// ---------------------------------------------------------------------------
// Core reconcile function
// ---------------------------------------------------------------------------

async function reconcileBucket(config: BucketConfig): Promise<BucketReport> {
  const scannedAt = new Date().toISOString();

  let storageObjects: StorageObjectEntry[];
  let dbPaths: Set<string>;

  try {
    [storageObjects, dbPaths] = await Promise.all([
      listAllObjects(config.bucket),
      config.getDbPaths(),
    ]);
  } catch (err) {
    return {
      bucket: config.bucket,
      scannedAt,
      totalStorageObjects: 0,
      totalDbPaths: 0,
      orphanedObjects: [],
      missingObjects: [],
      staleTempObjects: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const storagePathSet = new Set(storageObjects.map((o) => o.path));
  const storageByPath = new Map(storageObjects.map((o) => [o.path, o]));

  const orphanedObjects: StorageObjectEntry[] = [];
  const staleTempObjects: StorageObjectEntry[] = [];

  for (const obj of storageObjects) {
    if (isStaleTempObject(obj)) {
      staleTempObjects.push(obj);
    } else if (!dbPaths.has(obj.path)) {
      orphanedObjects.push(obj);
    }
  }

  const missingObjects: string[] = [];
  for (const dbPath of dbPaths) {
    if (!storagePathSet.has(dbPath)) {
      missingObjects.push(dbPath);
    }
  }

  return {
    bucket: config.bucket,
    scannedAt,
    totalStorageObjects: storageObjects.length,
    totalDbPaths: dbPaths.size,
    orphanedObjects,
    missingObjects,
    staleTempObjects,
  };
}

export async function runStorageReconcile(
  triggeredBy: string,
): Promise<ReconcileReport> {
  const startMs = Date.now();
  const generatedAt = new Date().toISOString();

  const buckets = await Promise.all(
    BUCKET_CONFIGS.map((config) => reconcileBucket(config)),
  );

  const summary = {
    totalOrphans: buckets.reduce((n, b) => n + b.orphanedObjects.length, 0),
    totalMissing: buckets.reduce((n, b) => n + b.missingObjects.length, 0),
    totalStaleTemp: buckets.reduce((n, b) => n + b.staleTempObjects.length, 0),
    bucketsWithErrors: buckets.filter((b) => b.error !== undefined).length,
  };

  return {
    generatedAt,
    durationMs: Date.now() - startMs,
    triggeredBy,
    buckets,
    summary,
  };
}
