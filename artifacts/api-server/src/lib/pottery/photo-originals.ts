import { and, eq, isNull, or, sql, notInArray } from "drizzle-orm";
import { db, potteryItems, potteryImages } from "@workspace/db";
import { stripImageMetadata } from "../image";
import {
  sniffAndValidateMime,
  isImageMimeType,
} from "@workspace/upload-validation";
import { uploadImage, deleteImage, downloadImageBuffer } from "./storage";
import { logger } from "../logger";
import { createHash } from "node:crypto";

export type OriginalSource = "upload" | "existing";

export function getPotteryPhotoVersion(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

export function assertPotteryPhotoVersion(
  path: string,
  expected: unknown,
): void {
  if (
    typeof expected !== "string" ||
    expected !== getPotteryPhotoVersion(path)
  ) {
    throw Object.assign(
      new Error(
        "This photo changed or your editor is out of date. Reload the piece and start the edit again.",
      ),
      { status: 409 },
    );
  }
}

/** Keep originals private and remove GPS/EXIF, without resizing/sharpening. */
export async function storeUploadedOriginal(
  file: Express.Multer.File | undefined,
  workingPath: string,
): Promise<{ originalImagePath: string; originalImageSource: OriginalSource }> {
  if (!file) {
    // Older clients can only supply their first uploaded image.
    return { originalImagePath: workingPath, originalImageSource: "existing" };
  }
  const mime = sniffAndValidateMime(file.buffer, file.mimetype);
  if (!isImageMimeType(mime)) {
    throw Object.assign(new Error("Unsupported original photo format."), {
      status: 400,
    });
  }
  const clean = await stripImageMetadata(file.buffer, mime);
  const originalImagePath = await uploadImage(clean, mime);
  return { originalImagePath, originalImageSource: "upload" };
}

/** A retained original is still referenced even after its working copy changes. */
export async function deleteUnreferencedPotteryPhoto(
  path: string,
  options: {
    excludingImageIds?: number[];
    strict?: boolean;
    reader?: Pick<typeof db, "select">;
  } = {},
) {
  const reader = options.reader ?? db;
  const [item] = await reader
    .select({ id: potteryItems.id })
    .from(potteryItems)
    .where(
      or(
        eq(potteryItems.imagePath, path),
        eq(potteryItems.originalImagePath, path),
        eq(potteryItems.patternCropPath, path),
      ),
    )
    .limit(1);
  if (item) return;
  const [image] = await reader
    .select({ id: potteryImages.id })
    .from(potteryImages)
    .where(
      and(
        or(
          eq(potteryImages.storagePath, path),
          eq(potteryImages.originalImagePath, path),
        ),
        options.excludingImageIds?.length
          ? notInArray(potteryImages.id, options.excludingImageIds)
          : undefined,
      ),
    )
    .limit(1);
  if (image) return;
  try {
    await deleteImage(path);
  } catch (error) {
    if (options.strict) throw error;
    // Do not log private object paths or mask a committed photo save.
    logger.warn(
      { operation: "pottery-photo-cleanup" },
      "Unused photo cleanup failed",
    );
  }
}

export async function getPotteryPhotoTarget(
  itemId: number,
  imageId: number | null,
) {
  const [item] = await db
    .select({
      id: potteryItems.id,
      path: potteryItems.imagePath,
      originalImagePath: potteryItems.originalImagePath,
      originalImageSource: potteryItems.originalImageSource,
    })
    .from(potteryItems)
    .where(and(eq(potteryItems.id, itemId), isNull(potteryItems.deletedAt)))
    .limit(1);
  if (!item)
    throw Object.assign(new Error("Pottery piece not found."), { status: 404 });
  if (imageId === null) return item;
  const [image] = await db
    .select({
      id: potteryImages.id,
      path: potteryImages.storagePath,
      originalImagePath: potteryImages.originalImagePath,
      originalImageSource: potteryImages.originalImageSource,
    })
    .from(potteryImages)
    .where(
      and(
        eq(potteryImages.id, imageId),
        eq(potteryImages.itemId, itemId),
        isNull(potteryImages.deletedAt),
      ),
    )
    .limit(1);
  if (!image)
    throw Object.assign(new Error("Photo not found."), { status: 404 });
  return image;
}

/** CAS makes simultaneous edits fail safely instead of losing the first copy. */
export async function savePotteryPhotoPath(
  itemId: number,
  imageId: number | null,
  previousPath: string,
  newPath: string,
  expectedVersion: string,
) {
  assertPotteryPhotoVersion(previousPath, expectedVersion);
  const original = {
    originalImageSource: sql`coalesce(${imageId === null ? potteryItems.originalImageSource : potteryImages.originalImageSource}, 'existing')`,
    originalImagePath: sql`coalesce(${imageId === null ? potteryItems.originalImagePath : potteryImages.originalImagePath}, ${previousPath})`,
  };
  const rows =
    imageId === null
      ? await db
          .update(potteryItems)
          .set({ ...original, imagePath: newPath })
          .where(
            and(
              eq(potteryItems.id, itemId),
              eq(potteryItems.imagePath, previousPath),
              isNull(potteryItems.deletedAt),
            ),
          )
          .returning({ id: potteryItems.id })
      : await db
          .update(potteryImages)
          .set({ ...original, storagePath: newPath })
          .where(
            and(
              eq(potteryImages.id, imageId),
              eq(potteryImages.itemId, itemId),
              eq(potteryImages.storagePath, previousPath),
              isNull(potteryImages.deletedAt),
              sql`exists (select 1 from ${potteryItems} where ${potteryItems.id} = ${itemId} and ${potteryItems.deletedAt} is null)`,
            ),
          )
          .returning({ id: potteryImages.id });
  if (!rows.length)
    throw Object.assign(
      new Error(
        "This photo changed while you were editing. Reload and try again.",
      ),
      { status: 409 },
    );
}

export async function getPotteryPhotoOriginalInfo(
  itemId: number,
  imageId: number | null,
) {
  const target = await getPotteryPhotoTarget(itemId, imageId);
  return {
    version: getPotteryPhotoVersion(target.path),
    available: !!target.originalImagePath,
    source: target.originalImagePath
      ? ((target.originalImageSource === "upload"
          ? "upload"
          : "existing") as OriginalSource)
      : null,
    isCurrentOriginal:
      !!target.originalImagePath && target.path === target.originalImagePath,
    imageUrl: target.originalImagePath
      ? `/api/pottery/items/${itemId}/photos/${imageId ?? "primary"}/original`
      : null,
  };
}

export async function restorePotteryPhotoOriginal(
  itemId: number,
  imageId: number | null,
  expectedVersion: string,
) {
  const target = await getPotteryPhotoTarget(itemId, imageId);
  assertPotteryPhotoVersion(target.path, expectedVersion);
  if (!target.originalImagePath)
    throw Object.assign(
      new Error("No earlier copy was retained for this photo."),
      { status: 404 },
    );
  if (target.path !== target.originalImagePath) {
    // Never replace a usable working photo with a broken storage reference.
    await downloadImageBuffer(target.originalImagePath);
    await savePotteryPhotoPath(
      itemId,
      imageId,
      target.path,
      target.originalImagePath,
      expectedVersion,
    );
    await deleteUnreferencedPotteryPhoto(target.path);
  }
  return getPotteryPhotoOriginalInfo(itemId, imageId);
}

/** Promotion must move the original together with its photo, atomically. */
export async function swapPotteryPhotos(itemId: number, imageId: number) {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(potteryItems)
      .where(and(eq(potteryItems.id, itemId), isNull(potteryItems.deletedAt)))
      .for("update");
    const [image] = await tx
      .select()
      .from(potteryImages)
      .where(
        and(
          eq(potteryImages.id, imageId),
          eq(potteryImages.itemId, itemId),
          isNull(potteryImages.deletedAt),
        ),
      )
      .for("update");
    if (!item || !image)
      throw Object.assign(new Error("Photo not found."), { status: 404 });
    await tx
      .update(potteryItems)
      .set({
        imagePath: image.storagePath,
        originalImagePath: image.originalImagePath,
        originalImageSource: image.originalImageSource,
      })
      .where(eq(potteryItems.id, itemId));
    await tx
      .update(potteryImages)
      .set({
        storagePath: item.imagePath,
        originalImagePath: item.originalImagePath,
        originalImageSource: item.originalImageSource,
      })
      .where(eq(potteryImages.id, imageId));
  });
}
