import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  mutations: [] as Record<string, unknown>[],
  updates: [] as unknown[][],
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => {
        const rows = state.selects.shift() ?? [];
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: async () => rows,
          for: async () => rows,
          then: (resolve: (value: unknown[]) => unknown) =>
            Promise.resolve(rows).then(resolve),
        };
        return chain;
      }),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          state.mutations.push(values);
          return {
            where: () => ({
              returning: async () => state.updates.shift() ?? [{ id: 7 }],
            }),
          };
        },
      })),
    },
  };
});
vi.mock("./storage", () => ({
  uploadImage: vi.fn(async () => "items/retained.png"),
  deleteImage: vi.fn(async () => {}),
  downloadImageBuffer: vi.fn(async () => ({
    buffer: Buffer.from("fixture"),
    contentType: "image/jpeg",
  })),
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

import { uploadImage, deleteImage, downloadImageBuffer } from "./storage";
import {
  getPotteryPhotoOriginalInfo,
  getPotteryPhotoVersion,
  getPotteryPhotoTarget,
  restorePotteryPhotoOriginal,
  savePotteryPhotoPath,
  storeUploadedOriginal,
  deleteUnreferencedPotteryPhoto,
} from "./photo-originals";

const target = (
  path = "items/edit.jpg",
  originalImagePath: string | null = "items/original.jpg",
) => ({
  id: 7,
  path,
  originalImagePath,
  originalImageSource: originalImagePath ? "upload" : null,
});

beforeEach(() => {
  state.selects.length = 0;
  state.mutations.length = 0;
  state.updates.length = 0;
  vi.clearAllMocks();
});

describe("protected pottery originals", () => {
  it("rejects an old editor even after the server has read a newer path", async () => {
    await expect(
      savePotteryPhotoPath(
        7,
        null,
        "items/newer.jpg",
        "items/stale-edit.jpg",
        getPotteryPhotoVersion("items/old.jpg"),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.mutations).toHaveLength(0);
  });
  it("retains full dimensions and removes embedded identifying metadata", async () => {
    const buffer = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#aabbcc" },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Artist: "Example fixture" } } })
      .toBuffer();
    const original = await storeUploadedOriginal(
      { buffer, mimetype: "image/png" } as Express.Multer.File,
      "items/edit.png",
    );
    expect(original).toEqual({
      originalImagePath: "items/retained.png",
      originalImageSource: "upload",
    });
    const bytes = vi.mocked(uploadImage).mock.calls[0][0];
    const metadata = await sharp(bytes).metadata();
    expect(metadata.width).toBe(120);
    expect(metadata.height).toBe(80);
    expect(metadata.exif).toBeUndefined();
  });

  it("honestly labels a legacy client's first saved copy", async () => {
    expect(await storeUploadedOriginal(undefined, "items/first.jpg")).toEqual({
      originalImagePath: "items/first.jpg",
      originalImageSource: "existing",
    });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("rejects a disguised non-image instead of protecting arbitrary bytes", async () => {
    await expect(
      storeUploadedOriginal(
        {
          buffer: Buffer.from("not a photo"),
          mimetype: "image/jpeg",
        } as Express.Multer.File,
        "items/edit.jpg",
      ),
    ).rejects.toThrow();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("returns unavailable rather than inventing an original", async () => {
    state.selects.push([target("items/current.jpg", null)]);
    expect(await getPotteryPhotoOriginalInfo(7, null)).toMatchObject({
      available: false,
      source: null,
      imageUrl: null,
      isCurrentOriginal: false,
    });
  });

  it("checks both the active parent and the supplemental photo's membership", async () => {
    state.selects.push([target()], []);
    await expect(getPotteryPhotoTarget(7, 99)).rejects.toMatchObject({
      status: 404,
    });
    expect(state.mutations).toHaveLength(0);
  });

  it("refuses to restore a copy that was never retained", async () => {
    state.selects.push([target("items/current.jpg", null)]);
    await expect(
      restorePotteryPhotoOriginal(
        7,
        null,
        getPotteryPhotoVersion("items/current.jpg"),
      ),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(state.mutations).toHaveLength(0);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("protects the first working path atomically and rejects stale edits", async () => {
    await savePotteryPhotoPath(
      7,
      null,
      "items/before.jpg",
      "items/after.jpg",
      getPotteryPhotoVersion("items/before.jpg"),
    );
    expect(state.mutations[0]).toMatchObject({ imagePath: "items/after.jpg" });
    expect(state.mutations[0].originalImagePath).toBeDefined();
    state.updates.push([]);
    await expect(
      savePotteryPhotoPath(
        7,
        8,
        "stale.jpg",
        "new.jpg",
        getPotteryPhotoVersion("stale.jpg"),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("never deletes an original still referenced by a primary photo", async () => {
    state.selects.push([{ id: 7 }]);
    await deleteUnreferencedPotteryPhoto("items/original.jpg");
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("never deletes an original still referenced by a supplemental photo", async () => {
    state.selects.push([], [{ id: 8 }]);
    await deleteUnreferencedPotteryPhoto("items/original.jpg");
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("restores the immutable original and only cleans up the unreferenced edit", async () => {
    state.selects.push([target()], [], [], [target("items/original.jpg")]);
    const result = await restorePotteryPhotoOriginal(
      7,
      null,
      getPotteryPhotoVersion("items/edit.jpg"),
    );
    expect(state.mutations[0].imagePath).toBe("items/original.jpg");
    expect(deleteImage).toHaveBeenCalledExactlyOnceWith("items/edit.jpg");
    expect(result.isCurrentOriginal).toBe(true);
  });

  it("does nothing destructive when the photo is already its original", async () => {
    state.selects.push(
      [target("items/original.jpg")],
      [target("items/original.jpg")],
    );
    expect(
      (
        await restorePotteryPhotoOriginal(
          7,
          null,
          getPotteryPhotoVersion("items/original.jpg"),
        )
      ).isCurrentOriginal,
    ).toBe(true);
    expect(state.mutations).toHaveLength(0);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("leaves the working photo intact if the retained file cannot be read", async () => {
    state.selects.push([target()]);
    vi.mocked(downloadImageBuffer).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(
      restorePotteryPhotoOriginal(
        7,
        null,
        getPotteryPhotoVersion("items/edit.jpg"),
      ),
    ).rejects.toThrow("storage unavailable");
    expect(state.mutations).toHaveLength(0);
    expect(deleteImage).not.toHaveBeenCalled();
  });
});
