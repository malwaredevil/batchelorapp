/**
 * Tests for camera-add ornament flow — queue and navigation logic.
 *
 * These tests import directly from camera-add-logic.ts (the same module that
 * camera-add.tsx uses at runtime), so any change to the production code that
 * breaks the duplicate-prevention invariant or the navigation contract will
 * cause these tests to fail.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createOrnamentFromEditedPhoto,
  createOrnamentPhotoQueue,
  deriveCreatedOrnamentRoute,
  deriveHandleDoneRoute,
  shouldEditFirstCameraCapture,
} from "./camera-add-logic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name = "ornament.jpg"): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

/**
 * Schedules `count` photos on `queue` and returns a Promise that resolves once
 * all callbacks have fired (via an oncomplete counter).  Callbacks are shared so
 * we can assert totals across photos.
 */
function drainQueue(
  queue: ReturnType<typeof createOrnamentPhotoQueue>,
  count: number,
  overrides: {
    create?: ReturnType<typeof vi.fn>;
    upload?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onCreate = vi.fn();
  const onUpload = vi.fn();
  const onError = vi.fn();
  const onProcessingStart = vi.fn();

  let done = 0;
  let resolveAll!: () => void;
  const allDone = new Promise<void>((r) => {
    resolveAll = r;
  });

  function tick() {
    if (++done === count) resolveAll();
  }

  const callbacks = {
    onProcessingStart,
    onCreate: vi.fn((...args: Parameters<typeof onCreate>) => {
      onCreate(...args);
      tick();
    }),
    onUpload: vi.fn(() => {
      onUpload();
      tick();
    }),
    onError: vi.fn((...args: Parameters<typeof onError>) => {
      onError(...args);
      tick();
    }),
  };

  for (let i = 0; i < count; i++) {
    queue.schedulePhoto(makeFile(`photo${i}.jpg`), callbacks);
  }

  return { allDone, onCreate, onUpload, onError, onProcessingStart };
}

// ─── Serial photo queue ───────────────────────────────────────────────────────

describe("createOrnamentPhotoQueue — duplicate prevention", () => {
  it("calls create exactly once for the first photo", async () => {
    const create = vi.fn().mockResolvedValue({ id: 7, name: "Frosty" });
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = createOrnamentPhotoQueue(create, upload);

    const { allDone, onCreate } = drainQueue(queue, 1);
    await allDone;

    expect(create).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(0);
    expect(onCreate).toHaveBeenCalledWith(7, "Frosty");
  });

  it("calls create once then upload for all subsequent photos (3 total)", async () => {
    const create = vi.fn().mockResolvedValue({ id: 42, name: "Santa" });
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = createOrnamentPhotoQueue(create, upload);

    const { allDone, onCreate, onUpload } = drainQueue(queue, 3);
    await allDone;

    expect(create).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledWith(42, expect.any(FormData));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledTimes(2);
  });

  it("calls create once for 5 photos scheduled simultaneously", async () => {
    const create = vi.fn().mockResolvedValue({ id: 99, name: "Snowman" });
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = createOrnamentPhotoQueue(create, upload);

    const { allDone } = drainQueue(queue, 5);
    await allDone;

    expect(create).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it("getOrnamentId returns null before any photo and the new id after", async () => {
    const create = vi.fn().mockResolvedValue({ id: 55, name: "Bell" });
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = createOrnamentPhotoQueue(create, upload);

    expect(queue.getOrnamentId()).toBeNull();

    const { allDone } = drainQueue(queue, 1);
    await allDone;

    expect(queue.getOrnamentId()).toBe(55);
  });

  it("upload receives the same id that create returned", async () => {
    const create = vi.fn().mockResolvedValue({ id: 123, name: "Angel" });
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = createOrnamentPhotoQueue(create, upload);

    const { allDone } = drainQueue(queue, 3);
    await allDone;

    for (const call of upload.mock.calls) {
      expect(call[0]).toBe(123);
    }
  });

  it("onProcessingStart fires once per photo, before any async work", () => {
    const create = vi.fn().mockResolvedValue({ id: 1, name: null });
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = createOrnamentPhotoQueue(create, upload);

    // Schedule 3 photos synchronously — processing starts are synchronous
    const onProcessingStart = vi.fn();
    const noop = {
      onProcessingStart,
      onCreate: vi.fn(),
      onUpload: vi.fn(),
      onError: vi.fn(),
    };

    queue.schedulePhoto(makeFile("a.jpg"), noop);
    // First photo: processing starts immediately (synchronous, before first await).
    expect(onProcessingStart).toHaveBeenCalledTimes(1);
  });

  it("processes photos serially: second does not start until first completes", async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const create = vi.fn().mockImplementation(async () => {
      // Slow first upload
      await firstDone;
      order.push("create-done");
      return { id: 10, name: null };
    });
    const upload = vi.fn().mockImplementation(async () => {
      order.push("upload-done");
    });

    const queue = createOrnamentPhotoQueue(create, upload);

    let p2Done = false;
    const cb1 = {
      onProcessingStart: vi.fn(),
      onCreate: vi.fn(),
      onUpload: vi.fn(),
      onError: vi.fn(),
    };
    const cb2 = {
      onProcessingStart: vi.fn(),
      onCreate: vi.fn(),
      onUpload: vi.fn().mockImplementation(() => {
        p2Done = true;
      }),
      onError: vi.fn(),
    };

    queue.schedulePhoto(makeFile("1.jpg"), cb1);
    queue.schedulePhoto(makeFile("2.jpg"), cb2);

    // Second photo's processing hasn't started yet — it's in the waitlist.
    expect(cb2.onProcessingStart).not.toHaveBeenCalled();
    expect(p2Done).toBe(false);

    // Unblock the first.
    resolveFirst();
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(order).toEqual(["create-done", "upload-done"]);
    expect(p2Done).toBe(true);
  });

  it("error in first photo still allows subsequent photos to run", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network error"));
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = createOrnamentPhotoQueue(create, upload);

    // Schedule 2 photos; first will error, second also goes through create
    // (ornamentId never got set from the failed first).
    let doneCount = 0;
    let resolveAll!: () => void;
    const allDone = new Promise<void>((r) => {
      resolveAll = r;
    });
    const tick = () => {
      if (++doneCount === 2) resolveAll();
    };

    const callbacks = {
      onProcessingStart: vi.fn(),
      onCreate: vi.fn().mockImplementation(tick),
      onUpload: vi.fn().mockImplementation(tick),
      onError: vi.fn().mockImplementation(tick),
    };

    queue.schedulePhoto(makeFile("x.jpg"), callbacks);
    queue.schedulePhoto(makeFile("y.jpg"), callbacks);

    await allDone;
    // Both photos called create (ornamentId was never set after the first error),
    // both failed → onError fires twice. The key invariant: upload is never called
    // and no ornament record is created from a partial failure.
    expect(callbacks.onError).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
    expect(queue.getOrnamentId()).toBeNull(); // no ornament id was set
  });
});

// ─── handleDone navigation (deriveHandleDoneRoute) ────────────────────────────

describe("first camera capture editing", () => {
  it("opens the editor only when no ornament photo exists yet", () => {
    expect(shouldEditFirstCameraCapture(null, false)).toBe(true);
    expect(shouldEditFirstCameraCapture(null, true)).toBe(false);
    expect(shouldEditFirstCameraCapture(42, false)).toBe(false);
  });

  it("routes a successfully created edited photo to ornament edit mode", () => {
    expect(deriveCreatedOrnamentRoute(42)).toBe(
      "/ornaments/ornament/42?edit=1",
    );
  });

  it("creates from the editor's file and returns the new ornament edit route", async () => {
    const edited = makeFile("edited-photo.jpg");
    const create = vi.fn().mockResolvedValue({ id: 42, name: "Snowflake" });

    await expect(
      createOrnamentFromEditedPhoto(create, edited),
    ).resolves.toEqual({
      id: 42,
      to: "/ornaments/ornament/42?edit=1",
    });

    const formData = create.mock.calls[0][0] as FormData;
    expect(formData.get("image")).toBe(edited);
  });

  it("leaves an editor save failure for the caller to handle", async () => {
    const create = vi.fn().mockRejectedValue(new Error("AI unavailable"));

    await expect(
      createOrnamentFromEditedPhoto(create, makeFile("edited-photo.jpg")),
    ).rejects.toThrow("AI unavailable");
  });
});

describe("deriveHandleDoneRoute", () => {
  it("returns blocked when photos are still processing", () => {
    const r = deriveHandleDoneRoute(null, true, true);
    expect(r.kind).toBe("blocked");
  });

  it("navigates to ornament detail when id is set", () => {
    const r = deriveHandleDoneRoute(42, true, false);
    expect(r).toEqual({
      kind: "navigate",
      to: "/ornaments/ornament/42?edit=1",
    });
  });

  it("navigates to /ornaments/add for a barcode-only session", () => {
    const r = deriveHandleDoneRoute(null, false, false);
    expect(r).toEqual({ kind: "navigate", to: "/ornaments/add" });
  });

  it("navigates to /ornaments when photos were added but all failed (id never set)", () => {
    const r = deriveHandleDoneRoute(null, true, false);
    expect(r).toEqual({ kind: "navigate", to: "/ornaments" });
    // Regression guard: the old code produced '/ornaments/ornament/null?edit=1'
    expect(r.kind === "navigate" && r.to).not.toContain("null");
  });

  it("never produces a URL containing the literal string 'null'", () => {
    const cases: Parameters<typeof deriveHandleDoneRoute>[] = [
      [null, false, false],
      [null, true, false],
      [null, false, true],
      [5, true, false],
    ];
    for (const args of cases) {
      const r = deriveHandleDoneRoute(...args);
      if (r.kind === "navigate") {
        expect(r.to).not.toContain("null");
      }
    }
  });
});
