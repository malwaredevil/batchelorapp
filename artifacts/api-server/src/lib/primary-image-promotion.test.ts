import { describe, expect, it, vi } from "vitest";
import { createPrimaryImagePromoter } from "./primary-image-promotion";

function makeAdapter() {
  return {
    itemNotFoundMessage: "Item not found.",
    getItem: vi.fn().mockResolvedValue({ imagePath: "old-primary.jpg" }),
    getImage: vi
      .fn()
      .mockResolvedValue({ itemId: 4, storagePath: "new-primary.jpg" }),
    updateImagePath: vi.fn().mockResolvedValue(undefined),
    updateItemPath: vi.fn().mockResolvedValue(undefined),
    rerunAnalysis: vi.fn().mockResolvedValue({ analyzed: true }),
  };
}

describe("createPrimaryImagePromoter", () => {
  it("swaps the paths and runs analysis when the image belongs to the item", async () => {
    const adapter = makeAdapter();
    const promote = createPrimaryImagePromoter(adapter);

    await expect(promote(4, 9)).resolves.toEqual({ analyzed: true });
    expect(adapter.updateImagePath).toHaveBeenCalledWith(9, "old-primary.jpg");
    expect(adapter.updateItemPath).toHaveBeenCalledWith(4, "new-primary.jpg");
    expect(adapter.rerunAnalysis).toHaveBeenCalledWith(4);
  });

  it("rejects a missing item without changing image paths", async () => {
    const adapter = makeAdapter();
    adapter.getItem.mockResolvedValue(undefined);

    await expect(
      createPrimaryImagePromoter(adapter)(4, 9),
    ).rejects.toMatchObject({ message: "Item not found.", status: 404 });
    expect(adapter.updateImagePath).not.toHaveBeenCalled();
  });

  it("rejects an image that belongs to another item without changing paths", async () => {
    const adapter = makeAdapter();
    adapter.getImage.mockResolvedValue({
      itemId: 99,
      storagePath: "other-item.jpg",
    });

    await expect(
      createPrimaryImagePromoter(adapter)(4, 9),
    ).rejects.toMatchObject({ message: "Image not found.", status: 404 });
    expect(adapter.updateImagePath).not.toHaveBeenCalled();
    expect(adapter.updateItemPath).not.toHaveBeenCalled();
  });
});
