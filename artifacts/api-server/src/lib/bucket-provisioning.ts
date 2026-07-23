import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { logger } from "./logger";
import {
  ensureBucketWithPolicy,
  IMAGE_ONLY_POLICY,
  TRAVELS_BUCKET_POLICY,
  MESSENGER_BUCKET_POLICY,
  ELAINE_ATTACHMENTS_BUCKET_POLICY,
} from "./storage-core";

interface BucketSpec {
  name: string;
  policy: Parameters<typeof ensureBucketWithPolicy>[2];
}

const BUCKET_SPECS: BucketSpec[] = [
  { name: "pottery", policy: IMAGE_ONLY_POLICY },
  { name: "quilting", policy: IMAGE_ONLY_POLICY },
  { name: "ornaments", policy: IMAGE_ONLY_POLICY },
  { name: "travels", policy: TRAVELS_BUCKET_POLICY },
  { name: "messenger", policy: MESSENGER_BUCKET_POLICY },
  { name: "elaine-attachments", policy: ELAINE_ATTACHMENTS_BUCKET_POLICY },
];

/**
 * Idempotent bootstrap: ensure all six storage buckets exist in Supabase with
 * the correct `fileSizeLimit` and `allowedMimeTypes` policies. Calling
 * `updateBucket` on each one means pre-existing buckets created without
 * policies are brought up to spec on the next server start without a
 * destructive recreate.
 *
 * Called once from `index.ts` during startup so a fresh environment is
 * policy-correct from the first request, not only after the first upload.
 */
export async function provisionAllBuckets(): Promise<void> {
  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results = await Promise.allSettled(
    BUCKET_SPECS.map(({ name, policy }) =>
      ensureBucketWithPolicy(supabase.storage, name, policy),
    ),
  );

  let allOk = true;
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const bucket = BUCKET_SPECS[i]!.name;
    if (result.status === "rejected") {
      allOk = false;
      logger.error(
        { bucket, err: result.reason },
        "bucket-provisioning: failed to provision bucket",
      );
    } else {
      logger.info({ bucket }, "bucket-provisioning: bucket provisioned ok");
    }
  }

  if (!allOk) {
    logger.warn(
      "bucket-provisioning: one or more buckets could not be provisioned — uploads may fail",
    );
  }
}
