import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../env";

const BUCKET = "messenger";
const SIGNED_URL_EXPIRES_SECS = 3600;

function getClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
}

export async function ensureBucket(): Promise<void> {
  const supabase = getClient();
  const { data: existing } = await supabase.storage.getBucket(BUCKET);
  if (existing) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
  });
  if (error && !error.message.includes("already exists")) {
    throw new Error(`Failed to create messenger bucket: ${error.message}`);
  }
}

export async function uploadFile(
  buffer: Buffer,
  mimeType: string,
  originalFileName: string,
): Promise<string> {
  const supabase = getClient();
  const ext = originalFileName.split(".").pop() ?? "bin";
  const path = `${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

export async function getSignedUrls(
  paths: string[],
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRES_SECS);
  const map = new Map<string, string>();
  if (error || !data) return map;
  for (const item of data) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  }
  return map;
}

export async function deleteFile(path: string): Promise<void> {
  const supabase = getClient();
  await supabase.storage.from(BUCKET).remove([path]);
}
