import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import {
  withCachedDownload,
  invalidateCachedDownload,
  ensureBucketWithPolicy,
  TRAVELS_BUCKET_POLICY,
} from "./storage-core";

const BUCKET = "travels";

function getSupabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = ensureBucketWithPolicy(
      getSupabase().storage,
      BUCKET,
      TRAVELS_BUCKET_POLICY,
    ).catch((err) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

export async function uploadDocument(
  buffer: Buffer,
  contentType: string,
  originalFilename: string,
): Promise<string> {
  await ensureBucket();
  const supabase = getSupabase();

  const ext = originalFilename.split(".").pop()?.toLowerCase() ?? "bin";
  const storagePath = `${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: false });

  if (error) throw error;
  return storagePath;
}

export async function downloadDocument(
  storagePath: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  return withCachedDownload(`${BUCKET}:${storagePath}`, async () => {
    await ensureBucket();
    const supabase = getSupabase();

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(storagePath);

    if (error) throw error;
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = storagePath.split(".").pop()?.toLowerCase();
    const contentTypeMap: Record<string, string> = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
    };
    const contentType = contentTypeMap[ext ?? ""] ?? "application/octet-stream";

    return { buffer, contentType };
  });
}

export async function deleteDocument(storagePath: string): Promise<void> {
  await ensureBucket();
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
  invalidateCachedDownload(`${BUCKET}:${storagePath}`);
}
