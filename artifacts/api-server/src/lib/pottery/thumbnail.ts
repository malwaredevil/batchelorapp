import { and, eq, isNull } from "drizzle-orm";
import { db, potteryItems } from "@workspace/db";
import { SetPotteryThumbnailBody } from "@workspace/api-zod";
import { pathCacheBuster } from "../path-cache-buster";

export const potteryThumbnailBody = SetPotteryThumbnailBody.strict();

/** Household-shared metadata only; never reads, writes or re-encodes photo bytes. */
export async function savePotteryThumbnail(itemId: number, input: unknown) {
  const body = potteryThumbnailBody.parse(input);
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(potteryItems)
      .where(and(eq(potteryItems.id, itemId), isNull(potteryItems.deletedAt)))
      .limit(1)
      .for("update");
    if (!item)
      throw Object.assign(new Error("Pottery piece not found."), {
        status: 404,
      });
    if (pathCacheBuster(item.imagePath) !== body.sourceVersion)
      throw Object.assign(
        new Error(
          "The main photo changed. Reopen the thumbnail editor to use the current photo.",
        ),
        { status: 409 },
      );
    const [updated] = await tx
      .update(potteryItems)
      .set({
        thumbnail:
          body.thumbnail === null
            ? null
            : { ...body.thumbnail, sourceVersion: body.sourceVersion },
      })
      .where(eq(potteryItems.id, itemId))
      .returning();
    if (!updated) throw new Error("Could not save thumbnail framing.");
    return updated;
  });
}
