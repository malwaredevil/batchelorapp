import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, potteryImages } from "@workspace/db";
import { deleteUnreferencedPotteryPhoto } from "./pottery/photo-originals";

/** Individually deleted photos must expire even while their parent stays active. */
export async function purgeExpiredPotteryPhotos(cutoff: Date): Promise<number> {
  const candidates = await db
    .select({ id: potteryImages.id })
    .from(potteryImages)
    .where(
      and(
        isNotNull(potteryImages.deletedAt),
        lt(potteryImages.deletedAt, cutoff),
      ),
    )
    .limit(25);
  let purged = 0;
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const [image] = await tx
        .select()
        .from(potteryImages)
        .where(
          and(
            eq(potteryImages.id, candidate.id),
            isNotNull(potteryImages.deletedAt),
            lt(potteryImages.deletedAt, cutoff),
          ),
        )
        .for("update");
      if (!image) return;
      // Keep the row locked until storage deletion succeeds. Failed deletions
      // leave its references intact for the next scheduled retry.
      for (const path of new Set([
        image.storagePath,
        image.originalImagePath,
      ])) {
        if (path)
          await deleteUnreferencedPotteryPhoto(path, {
            reader: tx,
            excludingImageIds: [image.id],
            strict: true,
          });
      }
      await tx.delete(potteryImages).where(eq(potteryImages.id, image.id));
      purged += 1;
    });
  }
  return purged;
}
