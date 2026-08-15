import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./purge-deleted.ts", import.meta.url)),
  "utf8",
);

describe("permanent purge safety invariants", () => {
  it("never filters polymorphic quilting images by entityId alone", () => {
    expect(source).not.toContain(
      ".where(inArray(quiltingImages.entityId, ids))",
    );
    expect(source).toContain('quiltingImagesWhere("fabric", ids)');
    expect(source).toContain('quiltingImagesWhere("pattern", ids)');
    expect(source).toContain('quiltingImagesWhere("quilt", ids)');
  });

  it("preserves database references when storage deletion fails", () => {
    expect(source).toContain(
      "Storage removal failed; retaining database rows for retry",
    );
    expect(source).toMatch(/if \(error\)[\s\S]*throw new Error/);
  });

  // ── Document → itinerary cross-reference guard ────────────────────────────
  //
  // Trip documents are referenced by itinerary activities via `sourceDocumentId`.
  // The purge job must clear those references before hard-deleting document rows,
  // because not every soft-delete route does early clearing (DELETE /documents/:docId
  // did not do so before this guard was added).  The purge is the universal
  // safety net.
  //
  // If this assertion ever fails, it means the clearing call was removed from
  // the purge — a regression that would leave dangling sourceDocumentId
  // references in itinerary activities after a hard delete.

  it("document purge section calls clearActivityDocumentReferences before hard-deleting rows", () => {
    expect(source).toContain("clearActivityDocumentReferences");
    // The purge must also fetch tripId so it knows which trips to update.
    expect(source).toContain("tripId: travelsTripDocuments.tripId");
  });
});

// ============================================================================
// Behavioral tests: trip photo & document purge clear activity references
// ============================================================================
//
// These tests mock the DB and verify that purgeDeletedItems() clears
// activity references before hard-deleting photo or document rows so that
// itinerary activities never hold a dangling reference.
//
// A unified `callLog` records every update and delete in the order they
// occur so tests can assert that the reference-clearing update always
// precedes the hard-deletion of the target row.
// ============================================================================

// ---------------------------------------------------------------------------
// Hoisted mock infrastructure (must be created before any vi.mock() factory)
// ---------------------------------------------------------------------------

type CallLogEntry =
  | { kind: "update"; data: Record<string, unknown> }
  | { kind: "delete" };

const { dbMock, supabaseMock, callLog, selectQueue } = vi.hoisted(() => {
  const callLog: CallLogEntry[] = [];
  // Queue of result arrays, consumed in call order by db.select()…where()
  const selectQueue: Array<unknown[]> = [];

  const makeSelectChain = (rows: unknown[]) => ({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  });

  const dbMock = {
    select: vi.fn(() => {
      const rows = selectQueue.shift() ?? [];
      return makeSelectChain(rows);
    }),
    delete: vi.fn(() => ({
      where: () => {
        callLog.push({ kind: "delete" });
        return Promise.resolve();
      },
    })),
    update: vi.fn(() => ({
      set: (data: Record<string, unknown>) => ({
        where: () => {
          callLog.push({ kind: "update", data });
          return Promise.resolve();
        },
      }),
    })),
  };

  const supabaseMock = {
    storage: {
      from: () => ({
        remove: () => Promise.resolve({ data: null, error: null }),
      }),
    },
  };

  return { dbMock, supabaseMock, callLog, selectQueue };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./env", () => ({
  env: {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => supabaseMock),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

import { purgeDeletedItems } from "./purge-deleted";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A deletedAt timestamp well beyond the 30-day purge threshold. */
const OLD_DATE = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

/**
 * Populate selectQueue with the select calls made by purgeDeletedItems() in
 * order.  Each section only issues sub-selects when the primary query returns
 * rows, so pass empty arrays for sections the test isn't exercising.
 *
 * Full call order:
 *   1.  potteryItems          (cascade primary)
 *   2.  fabrics               (cascade primary)
 *   3.  quiltPatterns         (cascade primary)
 *   4.  finishedQuilts        (cascade primary)
 *   5.  travelsTrips          (cascade primary — soft-deleted trips)
 *   6.  travelsTripPhotos     (standalone primary)
 *   7.  travelsTrips by id    (only when step 6 returns rows)
 *   8.  travelsTripDocuments  (standalone primary)
 *   9.  travelsTrips by id    (only when step 8 returns rows with tripIds)
 *  10.  reminders             (standalone primary)
 *  11.  ornamentsItems        (cascade primary)
 */
function seedSelectQueue(opts: {
  photoRows?: unknown[];
  photoTripRows?: unknown[];
  docRows?: unknown[];
  docTripRows?: unknown[];
}): void {
  const {
    photoRows = [],
    photoTripRows = [],
    docRows = [],
    docTripRows = [],
  } = opts;

  selectQueue.length = 0;
  selectQueue.push(
    [], // 1. potteryItems
    [], // 2. fabrics
    [], // 3. quiltPatterns
    [], // 4. finishedQuilts
    [], // 5. travelsTrips (cascade)
    photoRows, // 6. travelsTripPhotos
  );
  if (photoRows.length > 0) {
    selectQueue.push(photoTripRows); // 7. travelsTrips (by photo trip ids)
  }
  selectQueue.push(docRows); // 8. travelsTripDocuments
  if (docRows.length > 0) {
    selectQueue.push(docTripRows); // 9. travelsTrips (by doc trip ids)
  }
  selectQueue.push(
    [], // 10. reminders
    [], // 11. ornamentsItems
  );
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  callLog.length = 0;
  selectQueue.length = 0;
  // Restore the default select mock behaviour (reads from the queue)
  dbMock.select.mockImplementation(() => {
    const rows = selectQueue.shift() ?? [];
    return {
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    };
  });
  dbMock.delete.mockImplementation(() => ({
    where: () => {
      callLog.push({ kind: "delete" });
      return Promise.resolve();
    },
  }));
  dbMock.update.mockImplementation(() => ({
    set: (data: Record<string, unknown>) => ({
      where: () => {
        callLog.push({ kind: "update", data });
        return Promise.resolve();
      },
    }),
  }));
});

// ===========================================================================
// Trip photo reference clearing
// ===========================================================================

describe("purgeDeletedItems — trip photo activity reference clearing", () => {
  it("removes a scalar photoId from an itinerary activity when the photo is purged", async () => {
    const PHOTO_ID = 10;
    const TRIP_ID = 1;

    const itinerary = {
      days: [
        {
          date: "2025-06-01",
          activities: [
            { name: "Museum visit", photoId: PHOTO_ID },
            { name: "Lunch", photoId: 99 }, // a different photo — must stay
          ],
        },
      ],
    };

    seedSelectQueue({
      photoRows: [
        {
          id: PHOTO_ID,
          storagePath: "travels/photo10.jpg",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      photoTripRows: [{ id: TRIP_ID, iconPhotoId: null, itinerary }],
    });

    const summary = await purgeDeletedItems();

    // The purge should have succeeded with no errors.
    expect(summary.errors).toHaveLength(0);
    expect(summary.tripPhotos).toBe(1);

    // There must be exactly one update (clearing the reference).
    const updates = callLog.filter((e) => e.kind === "update") as Extract<
      CallLogEntry,
      { kind: "update" }
    >[];
    expect(updates).toHaveLength(1);

    const updatedItinerary = updates[0]!.data.itinerary as typeof itinerary;
    const activities = updatedItinerary.days[0]!.activities;

    // The purged photo's scalar reference is gone.
    const purgedActivity = activities.find(
      (a) => "photoId" in a && a.photoId === PHOTO_ID,
    );
    expect(purgedActivity).toBeUndefined();

    // The other activity's photoId is untouched.
    const otherActivity = activities.find(
      (a) => "photoId" in a && (a as { photoId: number }).photoId === 99,
    );
    expect(otherActivity).toBeDefined();

    // ── Ordering: the reference-clearing update must precede the photo deletion ──
    const firstUpdateIdx = callLog.findIndex((e) => e.kind === "update");
    const firstDeleteIdx = callLog.findIndex((e) => e.kind === "delete");
    expect(firstUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(firstUpdateIdx);
  });

  it("clears iconPhotoId when the purged photo is the trip's cover image", async () => {
    const PHOTO_ID = 20;
    const TRIP_ID = 2;

    const itinerary = { days: [{ date: "2025-07-01", activities: [] }] };

    seedSelectQueue({
      photoRows: [
        {
          id: PHOTO_ID,
          storagePath: "travels/cover20.jpg",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      photoTripRows: [{ id: TRIP_ID, iconPhotoId: PHOTO_ID, itinerary }],
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);
    expect(summary.tripPhotos).toBe(1);

    const updates = callLog.filter((e) => e.kind === "update") as Extract<
      CallLogEntry,
      { kind: "update" }
    >[];
    expect(updates).toHaveLength(1);

    // iconPhotoId must be nulled out.
    expect(updates[0]!.data.iconPhotoId).toBeNull();

    // Ordering: update before delete.
    const firstUpdateIdx = callLog.findIndex((e) => e.kind === "update");
    const firstDeleteIdx = callLog.findIndex((e) => e.kind === "delete");
    expect(firstUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(firstUpdateIdx);
  });

  it("clears both iconPhotoId and itinerary photoId in a single update when they reference the same photo", async () => {
    const PHOTO_ID = 30;
    const TRIP_ID = 3;

    const itinerary = {
      days: [
        {
          date: "2025-08-01",
          activities: [{ name: "Hike", photoId: PHOTO_ID }],
        },
      ],
    };

    seedSelectQueue({
      photoRows: [
        {
          id: PHOTO_ID,
          storagePath: "travels/hero30.jpg",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      photoTripRows: [{ id: TRIP_ID, iconPhotoId: PHOTO_ID, itinerary }],
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);
    expect(summary.tripPhotos).toBe(1);

    const updates = callLog.filter((e) => e.kind === "update") as Extract<
      CallLogEntry,
      { kind: "update" }
    >[];
    // One update covers both fields.
    expect(updates).toHaveLength(1);
    const { data } = updates[0]!;

    // Cover cleared.
    expect(data.iconPhotoId).toBeNull();

    // Activity reference cleared.
    const updatedItinerary = data.itinerary as typeof itinerary;
    const activities = updatedItinerary.days[0]!.activities;
    const purgedActivity = activities.find(
      (a) => "photoId" in a && a.photoId === PHOTO_ID,
    );
    expect(purgedActivity).toBeUndefined();

    // Ordering: update before delete.
    const firstUpdateIdx = callLog.findIndex((e) => e.kind === "update");
    const firstDeleteIdx = callLog.findIndex((e) => e.kind === "delete");
    expect(firstUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(firstUpdateIdx);
  });

  it("does NOT update the trip when the photo is not referenced anywhere in the itinerary", async () => {
    const PHOTO_ID = 40;
    const TRIP_ID = 4;

    // The itinerary references a different photo.
    const itinerary = {
      days: [
        { date: "2025-09-01", activities: [{ name: "Dinner", photoId: 999 }] },
      ],
    };

    seedSelectQueue({
      photoRows: [
        {
          id: PHOTO_ID,
          storagePath: "travels/unreferenced40.jpg",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      photoTripRows: [{ id: TRIP_ID, iconPhotoId: null, itinerary }],
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);
    // No update should be issued — nothing referenced this photo.
    const updates = callLog.filter((e) => e.kind === "update");
    expect(updates).toHaveLength(0);
  });

  it("filters a photoId out of a photoIds array without removing other ids in the same activity", async () => {
    const PHOTO_ID = 50;
    const KEEP_ID = 51;
    const TRIP_ID = 5;

    const itinerary = {
      days: [
        {
          date: "2025-10-01",
          activities: [{ name: "Gallery", photoIds: [KEEP_ID, PHOTO_ID] }],
        },
      ],
    };

    seedSelectQueue({
      photoRows: [
        {
          id: PHOTO_ID,
          storagePath: "travels/gallery50.jpg",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      photoTripRows: [{ id: TRIP_ID, iconPhotoId: null, itinerary }],
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);

    const updates = callLog.filter((e) => e.kind === "update") as Extract<
      CallLogEntry,
      { kind: "update" }
    >[];
    expect(updates).toHaveLength(1);

    const updatedItinerary = updates[0]!.data.itinerary as typeof itinerary;
    const activity = updatedItinerary.days[0]!.activities[0] as {
      photoIds?: number[];
    };

    // The purged id is gone from the array.
    expect(activity.photoIds).not.toContain(PHOTO_ID);
    // The surviving id is still present.
    expect(activity.photoIds).toContain(KEEP_ID);

    // Ordering: update before delete.
    const firstUpdateIdx = callLog.findIndex((e) => e.kind === "update");
    const firstDeleteIdx = callLog.findIndex((e) => e.kind === "delete");
    expect(firstUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(firstUpdateIdx);
  });
});

// ===========================================================================
// Trip document reference clearing
// ===========================================================================

describe("purgeDeletedItems — trip document activity reference clearing", () => {
  it("clears sourceDocumentId from an itinerary activity before the document is hard-deleted", async () => {
    const DOC_ID = 100;
    const TRIP_ID = 10;

    const itinerary = {
      days: [
        {
          date: "2025-06-01",
          activities: [
            {
              name: "Flight to Paris",
              sourceDocumentId: DOC_ID,
              sourceField: "departureDate",
            },
            {
              name: "Hotel check-in",
              sourceDocumentId: 999, // different doc — must stay
              sourceField: "checkIn",
            },
          ],
        },
      ],
    };

    seedSelectQueue({
      docRows: [
        {
          id: DOC_ID,
          storagePath: "travels/doc100.pdf",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      docTripRows: [{ id: TRIP_ID, itinerary }],
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);
    expect(summary.tripDocuments).toBe(1);

    const updates = callLog.filter((e) => e.kind === "update") as Extract<
      CallLogEntry,
      { kind: "update" }
    >[];
    expect(updates).toHaveLength(1);

    const updatedItinerary = updates[0]!.data.itinerary as typeof itinerary;
    const activities = updatedItinerary.days[0]!.activities;

    // The purged document's reference is gone.
    const purgedActivity = activities.find(
      (a) =>
        "sourceDocumentId" in a &&
        (a as { sourceDocumentId: number }).sourceDocumentId === DOC_ID,
    );
    expect(purgedActivity).toBeUndefined();

    // The other activity's sourceDocumentId is untouched.
    const otherActivity = activities.find(
      (a) =>
        "sourceDocumentId" in a &&
        (a as { sourceDocumentId: number }).sourceDocumentId === 999,
    );
    expect(otherActivity).toBeDefined();

    // ── Ordering: the reference-clearing update must precede the document deletion ──
    const firstUpdateIdx = callLog.findIndex((e) => e.kind === "update");
    const firstDeleteIdx = callLog.findIndex((e) => e.kind === "delete");
    expect(firstUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(firstUpdateIdx);
  });

  it("also clears the paired sourceField when sourceDocumentId is removed", async () => {
    const DOC_ID = 101;
    const TRIP_ID = 11;

    const itinerary = {
      days: [
        {
          date: "2025-07-01",
          activities: [
            {
              name: "Car rental",
              sourceDocumentId: DOC_ID,
              sourceField: "pickupDate",
              confirmed: true,
            },
          ],
        },
      ],
    };

    seedSelectQueue({
      docRows: [
        {
          id: DOC_ID,
          storagePath: "travels/doc101.pdf",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      docTripRows: [{ id: TRIP_ID, itinerary }],
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);

    const updates = callLog.filter((e) => e.kind === "update") as Extract<
      CallLogEntry,
      { kind: "update" }
    >[];
    expect(updates).toHaveLength(1);

    const updatedItinerary = updates[0]!.data.itinerary as typeof itinerary;
    const activity = updatedItinerary.days[0]!.activities[0] as Record<
      string,
      unknown
    >;

    // Both foreign-key fields are removed.
    expect("sourceDocumentId" in activity).toBe(false);
    expect("sourceField" in activity).toBe(false);
    // User-authored fields survive.
    expect(activity.name).toBe("Car rental");
    expect(activity.confirmed).toBe(true);
  });

  it("does NOT update the trip when no activity references the purged document", async () => {
    const DOC_ID = 102;
    const TRIP_ID = 12;

    const itinerary = {
      days: [
        {
          date: "2025-08-01",
          activities: [{ name: "Museum", sourceDocumentId: 888 }],
        },
      ],
    };

    seedSelectQueue({
      docRows: [
        {
          id: DOC_ID,
          storagePath: "travels/doc102.pdf",
          tripId: TRIP_ID,
          deletedAt: OLD_DATE,
        },
      ],
      docTripRows: [{ id: TRIP_ID, itinerary }],
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);
    // No update — nothing referenced this document.
    const updates = callLog.filter((e) => e.kind === "update");
    expect(updates).toHaveLength(0);
  });

  it("handles a document with no tripId without crashing", async () => {
    const DOC_ID = 103;

    // A document row where tripId is null (orphaned or unlinked).
    seedSelectQueue({
      docRows: [
        {
          id: DOC_ID,
          storagePath: "travels/doc103.pdf",
          tripId: null,
          deletedAt: OLD_DATE,
        },
      ],
      // docTripRows is unused because affectedTripIds is empty.
    });

    const summary = await purgeDeletedItems();

    expect(summary.errors).toHaveLength(0);
    expect(summary.tripDocuments).toBe(1);

    // No trip update should occur.
    const updates = callLog.filter((e) => e.kind === "update");
    expect(updates).toHaveLength(0);
  });
});
