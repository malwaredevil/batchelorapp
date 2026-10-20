import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  item: { id: 7, imagePath: "pottery/photo-a.jpg", thumbnail: null as unknown },
  missing: false,
  set: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const tx = {
    select: () => {
      const builder = {
        from: () => builder,
        where: () => builder,
        limit: () => builder,
        for: () => builder,
        then: (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(mocks.missing ? [] : [mocks.item]).then(resolve),
      };
      return builder;
    },
    update: (...args: unknown[]) => {
      mocks.update(...args);
      return {
        set: (value: unknown) => {
          mocks.set(value);
          return {
            where: () => ({
              returning: async () => [{ ...mocks.item, ...(value as object) }],
            }),
          };
        },
      };
    },
  };
  return {
    ...actual,
    db: {
      transaction: async (run: (tx: unknown) => unknown) => {
        mocks.transaction();
        return run(tx);
      },
    },
  };
});
import { savePotteryThumbnail } from "./thumbnail";
import { pathCacheBuster } from "../path-cache-buster";

const framing = { mode: "crop", x: 0.4, y: 0.2, zoom: 2 };
const version = pathCacheBuster("pottery/photo-a.jpg");

describe("optional pottery thumbnail saves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.missing = false;
    mocks.item.thumbnail = null;
  });
  it("only changes framing metadata and records the actual photo version", async () => {
    const result = await savePotteryThumbnail(7, {
      sourceVersion: version,
      thumbnail: framing,
    });
    expect(result.thumbnail).toEqual({ ...framing, sourceVersion: version });
    expect(mocks.set).toHaveBeenCalledWith({
      thumbnail: { ...framing, sourceVersion: version },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
  it("clears the custom setting without changing photo paths", async () => {
    await savePotteryThumbnail(7, { sourceVersion: version, thumbnail: null });
    expect(mocks.set).toHaveBeenCalledWith({ thumbnail: null });
  });
  it("refuses to save a selection for an old photo", async () => {
    await expect(
      savePotteryThumbnail(7, {
        sourceVersion: "previous-photo",
        thumbnail: framing,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("returns not found for missing or soft-deleted pieces", async () => {
    mocks.missing = true;
    await expect(
      savePotteryThumbnail(7, {
        sourceVersion: version,
        thumbnail: framing,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { sourceVersion: version },
    { sourceVersion: "", thumbnail: null },
    { sourceVersion: "a".repeat(33), thumbnail: framing },
    { sourceVersion: version, thumbnail: { ...framing, x: -0.1 } },
    { sourceVersion: version, thumbnail: { ...framing, y: 1.1 } },
    { sourceVersion: version, thumbnail: { ...framing, zoom: 0 } },
    { sourceVersion: version, thumbnail: { ...framing, zoom: 9 } },
    { sourceVersion: version, thumbnail: { ...framing, zoom: NaN } },
    { sourceVersion: version, thumbnail: { ...framing, zoom: Infinity } },
    { sourceVersion: version, thumbnail: { ...framing, mode: "arbitrary" } },
    { sourceVersion: version, thumbnail: framing, imagePath: "untrusted.jpg" },
  ])(
    "rejects invalid or unexpected input before any DB work (%#)",
    async (body) => {
      await expect(savePotteryThumbnail(7, body)).rejects.toThrow();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it("derives the stored version rather than accepting one inside framing", async () => {
    const result = await savePotteryThumbnail(7, {
      sourceVersion: version,
      thumbnail: { ...framing, sourceVersion: "forged" },
    });
    expect(result.thumbnail?.sourceVersion).toBe(version);
  });
});
