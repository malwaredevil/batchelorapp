/**
 * purge-deleted.ts — permanently removes soft-deleted items older than 30 days.
 *
 * Called by the /api/operations/purge-deleted route (admin / scheduled deployment).
 * Deletes storage objects first, then hard-deletes the DB rows to keep storage
 * and DB in sync. If storage deletion fails for a row, that row is skipped and
 * logged — it will be retried on the next purge run.
 */
import { and, eq, isNotNull, lt, inArray } from "drizzle-orm";
import {
  db,
  potteryItems,
  potteryImages,
  fabrics,
  quiltingImages,
  quiltPatterns,
  finishedQuilts,
  travelsTrips,
  travelsTripPhotos,
  travelsTripDocuments,
  reminders,
  ornamentsItems,
  ornamentsImages,
} from "@workspace/db";
import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import { env } from "./env";

const PURGE_DAYS = 30;

function purgeThreshold(): Date {
  const d = new Date();
  d.setDate(d.getDate() - PURGE_DAYS);
  return d;
}

// Uses env.supabaseUrl / env.supabaseServiceRoleKey so the dev/prod split in
// env.ts (devOrRequired) applies here too — in editor mode with DEV_SUPABASE_*
// set, storage deletions target the dev project, matching the pg pool target.
function supabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
}

async function removeStoragePaths(
  bucket: string,
  paths: (string | null)[],
): Promise<void> {
  const valid = paths.filter((p): p is string => !!p);
  if (valid.length === 0) return;
  const client = supabase();
  const { error } = await client.storage.from(bucket).remove(valid);
  if (error) {
    logger.warn(
      { bucket, paths: valid, error },
      "Storage removal failed; retaining database rows for retry",
    );
    throw new Error(
      `Storage removal failed for ${bucket}: ${error.message ?? String(error)}`,
    );
  }
}

type QuiltingEntityType = "fabric" | "pattern" | "quilt";

/**
 * Polymorphic quilting images are identified by BOTH entity type and entity ID.
 * Never query or delete these rows using entityId alone because independent
 * sequences allow the same numeric ID to exist for a fabric, pattern, and quilt.
 */
function quiltingImagesWhere(
  entityType: QuiltingEntityType,
  entityIds: number[],
) {
  return and(
    eq(quiltingImages.entityType, entityType),
    inArray(quiltingImages.entityId, entityIds),
  );
}

export type PurgeSummary = {
  potteryItems: number;
  fabrics: number;
  quiltPatterns: number;
  finishedQuilts: number;
  travelsTrips: number;
  tripPhotos: number;
  tripDocuments: number;
  reminders: number;
  ornaments: number;
  errors: string[];
};

export async function purgeDeletedItems(): Promise<PurgeSummary> {
  const cutoff = purgeThreshold();
  const summary: PurgeSummary = {
    potteryItems: 0,
    fabrics: 0,
    quiltPatterns: 0,
    finishedQuilts: 0,
    travelsTrips: 0,
    tripPhotos: 0,
    tripDocuments: 0,
    reminders: 0,
    ornaments: 0,
    errors: [],
  };

  // --- Pottery ---
  try {
    const rows = await db
      .select({
        id: potteryItems.id,
        imagePath: potteryItems.imagePath,
        patternCropPath: potteryItems.patternCropPath,
      })
      .from(potteryItems)
      .where(
        and(
          isNotNull(potteryItems.deletedAt),
          lt(potteryItems.deletedAt, cutoff),
        ),
      );
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const suppImages = await db
        .select({ storagePath: potteryImages.storagePath })
        .from(potteryImages)
        .where(inArray(potteryImages.itemId, ids));
      const paths = [
        ...rows.flatMap((r) => [r.imagePath, r.patternCropPath]),
        ...suppImages.map((i) => i.storagePath),
      ];
      await removeStoragePaths("pottery", paths);
      await db.delete(potteryImages).where(inArray(potteryImages.itemId, ids));
      await db.delete(potteryItems).where(inArray(potteryItems.id, ids));
      summary.potteryItems = rows.length;
    }
  } catch (err) {
    summary.errors.push(`pottery_items: ${String(err)}`);
    logger.error({ err }, "purge: pottery_items failed");
  }

  // --- Fabrics ---
  try {
    const rows = await db
      .select({ id: fabrics.id, imagePath: fabrics.imagePath })
      .from(fabrics)
      .where(and(isNotNull(fabrics.deletedAt), lt(fabrics.deletedAt, cutoff)));
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const suppImages = await db
        .select({ storagePath: quiltingImages.storagePath })
        .from(quiltingImages)
        .where(quiltingImagesWhere("fabric", ids));
      await removeStoragePaths("quilting", [
        ...rows.map((r) => r.imagePath),
        ...suppImages.map((i) => i.storagePath),
      ]);
      await db.delete(quiltingImages).where(quiltingImagesWhere("fabric", ids));
      await db.delete(fabrics).where(inArray(fabrics.id, ids));
      summary.fabrics = rows.length;
    }
  } catch (err) {
    summary.errors.push(`fabrics: ${String(err)}`);
    logger.error({ err }, "purge: fabrics failed");
  }

  // --- Quilt Patterns ---
  try {
    const rows = await db
      .select({ id: quiltPatterns.id, imagePath: quiltPatterns.imagePath })
      .from(quiltPatterns)
      .where(
        and(
          isNotNull(quiltPatterns.deletedAt),
          lt(quiltPatterns.deletedAt, cutoff),
        ),
      );
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const suppImages = await db
        .select({ storagePath: quiltingImages.storagePath })
        .from(quiltingImages)
        .where(quiltingImagesWhere("pattern", ids));
      await removeStoragePaths("quilting", [
        ...rows.map((r) => r.imagePath),
        ...suppImages.map((i) => i.storagePath),
      ]);
      await db
        .delete(quiltingImages)
        .where(quiltingImagesWhere("pattern", ids));
      await db.delete(quiltPatterns).where(inArray(quiltPatterns.id, ids));
      summary.quiltPatterns = rows.length;
    }
  } catch (err) {
    summary.errors.push(`quilt_patterns: ${String(err)}`);
    logger.error({ err }, "purge: quilt_patterns failed");
  }

  // --- Finished Quilts ---
  try {
    const rows = await db
      .select({ id: finishedQuilts.id, imagePath: finishedQuilts.imagePath })
      .from(finishedQuilts)
      .where(
        and(
          isNotNull(finishedQuilts.deletedAt),
          lt(finishedQuilts.deletedAt, cutoff),
        ),
      );
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const suppImages = await db
        .select({ storagePath: quiltingImages.storagePath })
        .from(quiltingImages)
        .where(quiltingImagesWhere("quilt", ids));
      await removeStoragePaths("quilting", [
        ...rows.map((r) => r.imagePath),
        ...suppImages.map((i) => i.storagePath),
      ]);
      await db.delete(quiltingImages).where(quiltingImagesWhere("quilt", ids));
      await db.delete(finishedQuilts).where(inArray(finishedQuilts.id, ids));
      summary.finishedQuilts = rows.length;
    }
  } catch (err) {
    summary.errors.push(`finished_quilts: ${String(err)}`);
    logger.error({ err }, "purge: finished_quilts failed");
  }

  // --- Travels: trips (cascade) ---
  try {
    const rows = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(
        and(
          isNotNull(travelsTrips.deletedAt),
          lt(travelsTrips.deletedAt, cutoff),
        ),
      );
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const photos = await db
        .select({ storagePath: travelsTripPhotos.storagePath })
        .from(travelsTripPhotos)
        .where(inArray(travelsTripPhotos.tripId, ids));
      const docs = await db
        .select({ storagePath: travelsTripDocuments.storagePath })
        .from(travelsTripDocuments)
        .where(inArray(travelsTripDocuments.tripId, ids));
      await removeStoragePaths("travels", [
        ...photos.map((p) => p.storagePath),
        ...docs.map((d) => d.storagePath),
      ]);
      await db
        .delete(travelsTripPhotos)
        .where(inArray(travelsTripPhotos.tripId, ids));
      await db
        .delete(travelsTripDocuments)
        .where(inArray(travelsTripDocuments.tripId, ids));
      await db
        .delete(reminders)
        .where(
          and(
            eq(reminders.entityType, "travels_trip"),
            inArray(reminders.entityId, ids),
          ),
        );
      await db.delete(travelsTrips).where(inArray(travelsTrips.id, ids));
      summary.travelsTrips = rows.length;
    }
  } catch (err) {
    summary.errors.push(`travels_trips: ${String(err)}`);
    logger.error({ err }, "purge: travels_trips failed");
  }

  // --- Trip Photos (standalone, not trip-cascade) ---
  try {
    const rows = await db
      .select({
        id: travelsTripPhotos.id,
        storagePath: travelsTripPhotos.storagePath,
        tripId: travelsTripPhotos.tripId,
      })
      .from(travelsTripPhotos)
      .where(
        and(
          isNotNull(travelsTripPhotos.deletedAt),
          lt(travelsTripPhotos.deletedAt, cutoff),
        ),
      );
    // Skip photos whose parent trip is also soft-deleted — those are already handled above.
    const orphanPhotos = rows.filter((r) => r.tripId != null);
    if (orphanPhotos.length > 0) {
      await removeStoragePaths(
        "travels",
        orphanPhotos.map((r) => r.storagePath),
      );
      await db.delete(travelsTripPhotos).where(
        inArray(
          travelsTripPhotos.id,
          orphanPhotos.map((r) => r.id),
        ),
      );
      summary.tripPhotos = orphanPhotos.length;
    }
  } catch (err) {
    summary.errors.push(`trip_photos: ${String(err)}`);
    logger.error({ err }, "purge: trip_photos failed");
  }

  // --- Trip Documents (standalone) ---
  try {
    const rows = await db
      .select({
        id: travelsTripDocuments.id,
        storagePath: travelsTripDocuments.storagePath,
      })
      .from(travelsTripDocuments)
      .where(
        and(
          isNotNull(travelsTripDocuments.deletedAt),
          lt(travelsTripDocuments.deletedAt, cutoff),
        ),
      );
    if (rows.length > 0) {
      await removeStoragePaths(
        "travels",
        rows.map((r) => r.storagePath),
      );
      await db.delete(travelsTripDocuments).where(
        inArray(
          travelsTripDocuments.id,
          rows.map((r) => r.id),
        ),
      );
      summary.tripDocuments = rows.length;
    }
  } catch (err) {
    summary.errors.push(`trip_documents: ${String(err)}`);
    logger.error({ err }, "purge: trip_documents failed");
  }

  // --- Reminders (standalone) ---
  try {
    const rows = await db
      .select({ id: reminders.id })
      .from(reminders)
      .where(
        and(
          eq(reminders.entityType, "travels_trip"),
          isNotNull(reminders.deletedAt),
          lt(reminders.deletedAt, cutoff),
        ),
      );
    if (rows.length > 0) {
      await db.delete(reminders).where(
        inArray(
          reminders.id,
          rows.map((r) => r.id),
        ),
      );
      summary.reminders = rows.length;
    }
  } catch (err) {
    summary.errors.push(`reminders: ${String(err)}`);
    logger.error({ err }, "purge: reminders failed");
  }

  // --- Ornaments ---
  try {
    const rows = await db
      .select({ id: ornamentsItems.id, imagePath: ornamentsItems.imagePath })
      .from(ornamentsItems)
      .where(
        and(
          isNotNull(ornamentsItems.deletedAt),
          lt(ornamentsItems.deletedAt, cutoff),
        ),
      );
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const suppImages = await db
        .select({ storagePath: ornamentsImages.storagePath })
        .from(ornamentsImages)
        .where(inArray(ornamentsImages.itemId, ids));
      await removeStoragePaths("ornaments", [
        ...rows.map((r) => r.imagePath),
        ...suppImages.map((i) => i.storagePath),
      ]);
      await db
        .delete(ornamentsImages)
        .where(inArray(ornamentsImages.itemId, ids));
      await db.delete(ornamentsItems).where(inArray(ornamentsItems.id, ids));
      summary.ornaments = rows.length;
    }
  } catch (err) {
    summary.errors.push(`ornaments: ${String(err)}`);
    logger.error({ err }, "purge: ornaments failed");
  }

  logger.info({ summary }, "purge-deleted: completed");
  return summary;
}
