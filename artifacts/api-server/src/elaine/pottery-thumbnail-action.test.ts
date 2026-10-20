import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  save: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@workspace/db", async (original) => ({
  ...(await original<typeof import("@workspace/db")>()),
  db: { select: mocks.select },
}));
vi.mock("../lib/pottery/thumbnail", async (original) => ({
  ...(await original<typeof import("../lib/pottery/thumbnail")>()),
  savePotteryThumbnail: mocks.save,
}));
vi.mock("../lib/pottery/size-categories", async (original) => ({
  ...(await original<typeof import("../lib/pottery/size-categories")>()),
  syncPotterySizeCategory: mocks.sync,
}));
import {
  potteryActionExecutors,
  UpdatePotteryItemActionPayload,
} from "./pottery-actions";

const framing = { mode: "crop" as const, x: 0.5, y: 0.3, zoom: 1.2 };
describe("Elaine thumbnail proposal photo version", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const rows = [{ id: 10, imagePath: "new-photo.jpg" }];
    const query = {
      from: () => query,
      where: () => query,
      limit: () => Promise.resolve(rows),
      then: (resolve: (value: typeof rows) => unknown) =>
        Promise.resolve(rows).then(resolve),
    };
    mocks.select.mockReturnValue(query);
  });
  it("requires a proposal-time version for custom framing", () => {
    expect(
      UpdatePotteryItemActionPayload.safeParse({
        itemId: 10,
        thumbnail: framing,
      }).success,
    ).toBe(false);
  });
  it("allows a default reset without visual coordinates or a version", () => {
    expect(
      UpdatePotteryItemActionPayload.safeParse({
        itemId: 10,
        thumbnail: null,
      }).success,
    ).toBe(true);
  });
  it("keeps existing metadata-only edits working across Zod major versions", () => {
    expect(
      UpdatePotteryItemActionPayload.parse({
        itemId: 10,
        name: "Updated name",
      }),
    ).toEqual({ itemId: 10, name: "Updated name" });
  });
  it("enforces the canonical framing bounds through the Zod bridge", () => {
    expect(
      UpdatePotteryItemActionPayload.safeParse({
        itemId: 10,
        thumbnail: { ...framing, x: 2 },
        thumbnailSourceVersion: "old-photo",
      }).success,
    ).toBe(false);
  });
  it("does not treat a version alone as an edit", () => {
    expect(
      UpdatePotteryItemActionPayload.safeParse({
        itemId: 10,
        thumbnailSourceVersion: "old-photo",
      }).success,
    ).toBe(false);
  });
  it("forwards the original version and propagates a stale-photo conflict", async () => {
    mocks.save.mockRejectedValue(
      Object.assign(new Error("The main photo changed"), { status: 409 }),
    );
    const payload = UpdatePotteryItemActionPayload.parse({
      itemId: 10,
      thumbnail: framing,
      thumbnailSourceVersion: "old-photo",
    });
    await expect(
      potteryActionExecutors.update_pottery_item(payload as never, 2),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.save).toHaveBeenCalledWith(10, {
      thumbnail: framing,
      sourceVersion: "old-photo",
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
