import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import {
  ensureBucketWithPolicy,
  RICH_TEXT_BUCKET_POLICY,
} from "./storage-core";

const BUCKET = "rich-text";
// Signed URLs are embedded directly in saved HTML (reminder descriptions /
// Office notes), so they need a long lifetime — a week is generous enough
// that a note written today still renders next time it's opened, without
// being effectively permanent.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

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
      RICH_TEXT_BUCKET_POLICY,
    ).catch((err) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

/**
 * Upload an image embedded via the shared RichTextEditor and return a signed
 * URL to embed directly in the saved HTML's <img src>. Unlike the
 * collection-item image buckets, rich-text images have no owning record to
 * re-sign URLs against on read, so we hand back a long-lived signed URL
 * up front instead of a bare storage path.
 */
export async function uploadRichTextImage(
  buffer: Buffer,
  contentType: string,
  originalFilename: string,
): Promise<string> {
  await ensureBucket();
  const supabase = getSupabase();

  const ext = originalFilename.split(".").pop()?.toLowerCase() || "bin";
  const storagePath = `${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !data) throw signError ?? new Error("failed to sign URL");

  return data.signedUrl;
}
