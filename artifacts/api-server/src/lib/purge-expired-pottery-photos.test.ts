import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  image: {
    id: 8,
    storagePath: "edit.jpg",
    originalImagePath: "original.jpg",
  } as {
    id: number;
    storagePath: string;
    originalImagePath: string | null;
  } | null,
  remove: vi.fn(),
  deleteRow: vi.fn(),
  tx: {} as Record<string, unknown>,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  mock.tx = {
    select: () => ({
      from: () => ({
        where: () => ({ for: async () => (mock.image ? [mock.image] : []) }),
      }),
    }),
    delete: () => ({ where: mock.deleteRow }),
  };
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ id: 8 }] }) }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) => fn(mock.tx),
    },
  };
});
vi.mock("./pottery/photo-originals", () => ({
  deleteUnreferencedPotteryPhoto: mock.remove,
}));
import { purgeExpiredPotteryPhotos } from "./purge-expired-pottery-photos";

beforeEach(() => {
  mock.image = {
    id: 8,
    storagePath: "edit.jpg",
    originalImagePath: "original.jpg",
  };
  mock.remove.mockReset().mockResolvedValue(undefined);
  mock.deleteRow.mockReset().mockResolvedValue(undefined);
});

describe("individual deleted pottery photo retention", () => {
  it("expires both files without waiting for the parent item to be deleted", async () => {
    expect(await purgeExpiredPotteryPhotos(new Date())).toBe(1);
    expect(mock.remove).toHaveBeenCalledWith("original.jpg", {
      reader: mock.tx,
      excludingImageIds: [8],
      strict: true,
    });
    expect(mock.remove).toHaveBeenCalledWith("edit.jpg", expect.any(Object));
    expect(mock.deleteRow).toHaveBeenCalledOnce();
  });
  it("keeps the row for retry when storage removal fails", async () => {
    mock.remove.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(purgeExpiredPotteryPhotos(new Date())).rejects.toThrow(
      "storage unavailable",
    );
    expect(mock.deleteRow).not.toHaveBeenCalled();
  });
  it("does not purge a row that no longer qualifies after locking", async () => {
    mock.image = null;
    expect(await purgeExpiredPotteryPhotos(new Date())).toBe(0);
    expect(mock.remove).not.toHaveBeenCalled();
    expect(mock.deleteRow).not.toHaveBeenCalled();
  });
  it("only deletes an aliased working/original object once", async () => {
    mock.image = {
      id: 8,
      storagePath: "original.jpg",
      originalImagePath: "original.jpg",
    };
    expect(await purgeExpiredPotteryPhotos(new Date())).toBe(1);
    expect(mock.remove).toHaveBeenCalledOnce();
  });
});
