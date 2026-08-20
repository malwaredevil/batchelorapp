export interface PrimaryImagePromotionAdapter<TResult> {
  itemNotFoundMessage: string;
  getItem: (itemId: number) => Promise<{ imagePath: string } | undefined>;
  getImage: (
    imageId: number,
  ) => Promise<{ itemId: number; storagePath: string } | undefined>;
  updateImagePath: (imageId: number, path: string) => Promise<void>;
  updateItemPath: (itemId: number, path: string) => Promise<void>;
  rerunAnalysis: (itemId: number) => Promise<TResult>;
}

/**
 * Promotes a supplemental collection image to primary and re-runs analysis.
 * The adapter keeps each collection's Drizzle tables and analysis pipeline
 * local while this shared workflow enforces the same ownership checks.
 */
export function createPrimaryImagePromoter<TResult>(
  adapter: PrimaryImagePromotionAdapter<TResult>,
): (itemId: number, imageId: number) => Promise<TResult> {
  return async (itemId, imageId) => {
    const item = await adapter.getItem(itemId);
    if (!item) {
      throw Object.assign(new Error(adapter.itemNotFoundMessage), {
        status: 404,
      });
    }

    const supplementalImage = await adapter.getImage(imageId);
    if (!supplementalImage || supplementalImage.itemId !== itemId) {
      throw Object.assign(new Error("Image not found."), { status: 404 });
    }

    await adapter.updateImagePath(imageId, item.imagePath);
    await adapter.updateItemPath(itemId, supplementalImage.storagePath);
    return adapter.rerunAnalysis(itemId);
  };
}
