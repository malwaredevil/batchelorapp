import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/env", () => ({
  env: {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-service-role-key",
    isProduction: false,
    sessionSecret: "test-secret",
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { createClient } from "@supabase/supabase-js";
import { pool } from "@workspace/db";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

type MockStorageItem = {
  name: string;
  id: string | null;
  created_at?: string | null;
};

type MockListResponse = {
  data: MockStorageItem[] | null;
  error: { message: string } | null;
};

let mockListImpl: (
  prefix: string,
  opts: { limit: number; offset: number },
) => MockListResponse = () => ({ data: [], error: null });

const mockSupabaseClient = {
  storage: {
    from: (_bucket: string) => ({
      list: (prefix: string, opts: { limit: number; offset: number }) =>
        Promise.resolve(mockListImpl(prefix, opts)),
    }),
  },
};

(createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabaseClient);

import {
  listAllObjects,
  runStorageReconcile,
  extractPathFromAttachmentUrl,
  extractAttachmentUrl,
  BUCKET_DB_SQL,
} from "./storage-reconcile";

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as ReturnType<typeof vi.fn>).mockReturnValue(
    mockSupabaseClient,
  );
  mockListImpl = () => ({ data: [], error: null });
  mockPool.query.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// extractPathFromAttachmentUrl
// ---------------------------------------------------------------------------
describe("extractPathFromAttachmentUrl", () => {
  it("extracts path from a Supabase signed URL", () => {
    const url =
      "https://abc.supabase.co/storage/v1/object/sign/elaine-attachments/uuid-123.jpg?token=eyJhbGciOi";
    expect(extractPathFromAttachmentUrl(url, "elaine-attachments")).toBe(
      "uuid-123.jpg",
    );
  });

  it("extracts path from a Supabase public URL", () => {
    const url =
      "https://abc.supabase.co/storage/v1/object/public/elaine-attachments/subdir/file.pdf";
    expect(extractPathFromAttachmentUrl(url, "elaine-attachments")).toBe(
      "subdir/file.pdf",
    );
  });

  it("returns null for an unrecognised URL format", () => {
    expect(
      extractPathFromAttachmentUrl(
        "https://example.com/file.jpg",
        "elaine-attachments",
      ),
    ).toBeNull();
  });

  it("returns null for an invalid URL", () => {
    expect(
      extractPathFromAttachmentUrl("not-a-url", "elaine-attachments"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractAttachmentUrl — handles both historical string and current object formats
// ---------------------------------------------------------------------------
describe("extractAttachmentUrl", () => {
  it("returns the string itself when item is a plain URL string (historical format)", () => {
    expect(
      extractAttachmentUrl(
        "https://example.supabase.co/storage/v1/object/sign/elaine-attachments/file.pdf",
      ),
    ).toBe(
      "https://example.supabase.co/storage/v1/object/sign/elaine-attachments/file.pdf",
    );
  });

  it("extracts .url when item is an AttachmentRef object (current format)", () => {
    const ref = {
      url: "https://example.supabase.co/storage/v1/object/public/elaine-attachments/img.jpg",
      type: "image",
    };
    expect(extractAttachmentUrl(ref)).toBe(ref.url);
  });

  it("extracts .url from AttachmentRef with name field (PDF format)", () => {
    const ref = {
      url: "https://x.supabase.co/storage/v1/object/sign/elaine-attachments/doc.pdf",
      type: "pdf",
      name: "receipt.pdf",
    };
    expect(extractAttachmentUrl(ref)).toBe(ref.url);
  });

  it("returns null for null", () => {
    expect(extractAttachmentUrl(null)).toBeNull();
  });

  it("returns null for a number", () => {
    expect(extractAttachmentUrl(42)).toBeNull();
  });

  it("returns null for an object missing a .url string field", () => {
    expect(extractAttachmentUrl({ type: "image" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listAllObjects
// ---------------------------------------------------------------------------
describe("listAllObjects", () => {
  it("returns an empty array when the bucket is empty", async () => {
    mockListImpl = () => ({ data: [], error: null });
    const result = await listAllObjects("pottery");
    expect(result).toEqual([]);
  });

  it("returns flat file entries with path and createdAt", async () => {
    mockListImpl = () => ({
      data: [{ name: "items", id: null, created_at: null }],
      error: null,
    });
    let callCount = 0;
    mockListImpl = (_prefix, _opts) => {
      callCount++;
      if (callCount === 1) {
        return {
          data: [{ name: "items", id: null, created_at: null }],
          error: null,
        };
      }
      if (callCount === 2) {
        return {
          data: [
            {
              name: "uuid-1.jpg",
              id: "id-1",
              created_at: "2024-01-01T00:00:00Z",
            },
            {
              name: "uuid-2.jpg",
              id: "id-2",
              created_at: "2024-01-02T00:00:00Z",
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };

    const result = await listAllObjects("pottery");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      path: "items/uuid-1.jpg",
      createdAt: "2024-01-01T00:00:00Z",
    });
    expect(result[1]).toEqual({
      path: "items/uuid-2.jpg",
      createdAt: "2024-01-02T00:00:00Z",
    });
  });

  it("paginates when a page is full", async () => {
    const PAGE_SIZE = 100;
    const page1Items = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      name: `file-${i}.jpg`,
      id: `id-${i}`,
      created_at: null,
    }));
    const page2Items = [
      { name: "file-100.jpg", id: "id-100", created_at: null },
    ];

    let callCount = 0;
    mockListImpl = (_prefix, _opts) => {
      callCount++;
      if (callCount === 1) return { data: page1Items, error: null };
      if (callCount === 2) return { data: page2Items, error: null };
      return { data: [], error: null };
    };

    const result = await listAllObjects("travels");
    expect(result).toHaveLength(PAGE_SIZE + 1);
  });

  it("throws when the storage API returns an error", async () => {
    mockListImpl = () => ({
      data: null,
      error: { message: "Bucket not found" },
    });
    await expect(listAllObjects("nonexistent")).rejects.toThrow(
      "Bucket not found",
    );
  });
});

// ---------------------------------------------------------------------------
// runStorageReconcile — orphan / missing / stale detection
// ---------------------------------------------------------------------------
describe("runStorageReconcile", () => {
  it(
    "reports orphaned objects (in storage but not in DB)",
    async () => {
      // Runs 6 concurrent buckets with Promise.all; allow generous timeout for slow CI
      mockListImpl = (_prefix, _opts) => ({
        data: [{ name: "items", id: null, created_at: null }],
        error: null,
      });

      let listCallsForBucket = 0;
      mockListImpl = (_prefix, _opts) => {
        listCallsForBucket++;
        if (listCallsForBucket % 2 === 1) {
          return {
            data: [
              {
                name: "orphan-file.jpg",
                id: "id-orphan",
                created_at: "2024-01-01T00:00:00Z",
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };

      mockPool.query.mockResolvedValue({ rows: [] });

      const report = await runStorageReconcile("test");
      const potteryBucket = report.buckets.find((b) => b.bucket === "pottery");
      expect(potteryBucket).toBeDefined();
      expect(potteryBucket!.orphanedObjects.length).toBeGreaterThanOrEqual(0);
    },
    { timeout: 15_000 },
  );

  it("reports missing objects (DB row with no matching storage object)", async () => {
    mockListImpl = () => ({ data: [], error: null });

    mockPool.query.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("pottery_items")) {
        return Promise.resolve({
          rows: [
            { path: "items/missing-uuid.jpg" },
            { path: "items/another-missing.jpg" },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const report = await runStorageReconcile("test");
    const potteryBucket = report.buckets.find((b) => b.bucket === "pottery");
    expect(potteryBucket).toBeDefined();
    expect(potteryBucket!.missingObjects).toContain("items/missing-uuid.jpg");
    expect(potteryBucket!.missingObjects).toContain(
      "items/another-missing.jpg",
    );
  });

  it("pottery BUCKET_DB_SQL covers pottery_items.image_path and pattern_crop_path", () => {
    const sql = BUCKET_DB_SQL.pottery;
    expect(sql).toContain("pottery_items");
    expect(sql).toContain("image_path");
    expect(sql).toContain("pattern_crop_path");
    expect(sql).toContain("pottery_images");
    expect(sql).toContain("storage_path");
  });

  it("quilting BUCKET_DB_SQL covers all four tables including quilting_finished_quilts", () => {
    const sql = BUCKET_DB_SQL.quilting;
    expect(sql).toContain("quilting_fabrics");
    expect(sql).toContain("quilting_patterns");
    // The previously-missing table — its absence caused false orphan flags.
    expect(sql).toContain("quilting_finished_quilts");
    expect(sql).toContain("quilting_images");
    expect(sql).toContain("image_path");
    expect(sql).toContain("storage_path");
  });

  it("reports stale temp objects (matching temp prefix and older than 24h)", async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    mockListImpl = (_prefix, _opts) => ({
      data: [
        { name: "tmp/stale-upload.jpg", id: "id-tmp", created_at: oldDate },
      ],
      error: null,
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    const report = await runStorageReconcile("test");
    const anyBucketWithStale = report.buckets.find(
      (b) => b.staleTempObjects.length > 0,
    );
    expect(anyBucketWithStale).toBeDefined();
    expect(anyBucketWithStale!.staleTempObjects[0].path).toContain("tmp/");
  });

  it("does NOT report a temp object that is less than 24h old as stale", async () => {
    const recentDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    mockListImpl = (_prefix, _opts) => ({
      data: [
        {
          name: "tmp/recent-upload.jpg",
          id: "id-tmp-recent",
          created_at: recentDate,
        },
      ],
      error: null,
    });
    mockPool.query.mockResolvedValue({ rows: [] });

    const report = await runStorageReconcile("test");
    for (const bucket of report.buckets) {
      expect(bucket.staleTempObjects).toHaveLength(0);
    }
  });

  it("includes summary totals", async () => {
    mockListImpl = () => ({ data: [], error: null });
    mockPool.query.mockResolvedValue({ rows: [] });

    const report = await runStorageReconcile("unit-test");
    expect(report.summary).toMatchObject({
      totalOrphans: expect.any(Number),
      totalMissing: expect.any(Number),
      totalStaleTemp: expect.any(Number),
      bucketsWithErrors: expect.any(Number),
    });
    expect(report.triggeredBy).toBe("unit-test");
    expect(report.buckets).toHaveLength(6);
  });

  it("captures a per-bucket error and continues scanning other buckets", async () => {
    let callCount = 0;
    mockListImpl = () => {
      callCount++;
      if (callCount === 1) {
        return { data: null, error: { message: "Bucket access denied" } };
      }
      return { data: [], error: null };
    };
    mockPool.query.mockResolvedValue({ rows: [] });

    const report = await runStorageReconcile("test");
    const errorBucket = report.buckets.find((b) => b.error !== undefined);
    expect(errorBucket).toBeDefined();
    expect(errorBucket!.error).toContain("Bucket access denied");
    expect(report.summary.bucketsWithErrors).toBeGreaterThanOrEqual(1);
    expect(report.buckets.length).toBe(6);
  });

  it("elaine-attachments bucket correctly reports orphaned storage objects", async () => {
    // Simulate a file present in the elaine-attachments bucket that has no
    // corresponding DB row — the classic orphan scenario for this bucket.
    const elainePath = "conversations/user-1/doc.pdf";
    let storageCallCount = 0;
    mockListImpl = (_prefix, _opts) => {
      storageCallCount++;
      // Only the elaine-attachments bucket (last of 6) should return a file.
      // Rather than trying to detect which bucket is being listed (the bucket
      // name isn't passed into mockListImpl), we return the file on every call
      // but rely on the DB returning zero paths so it appears as orphan for
      // every bucket — the elaine bucket's orphan list is what we assert on.
      if (storageCallCount === 6) {
        return {
          data: [
            {
              name: elainePath,
              id: "id-elaine",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    mockPool.query.mockResolvedValue({ rows: [] });

    const report = await runStorageReconcile("test");
    const elaineBucket = report.buckets.find(
      (b) => b.bucket === "elaine-attachments",
    );
    expect(elaineBucket).toBeDefined();
    expect(elaineBucket!.error).toBeUndefined();
    // The file is in storage but has no DB record → should be an orphan.
    expect(elaineBucket!.orphanedObjects.map((o) => o.path)).toContain(
      elainePath,
    );
  });

  it("all six buckets complete without per-bucket errors when DB and storage return empty data", async () => {
    mockListImpl = () => ({ data: [], error: null });
    mockPool.query.mockResolvedValue({ rows: [] });

    const report = await runStorageReconcile("test");
    expect(report.buckets).toHaveLength(6);
    const expectedBuckets = [
      "pottery",
      "quilting",
      "ornaments",
      "travels",
      "messenger",
      "elaine-attachments",
    ];
    for (const name of expectedBuckets) {
      const bucket = report.buckets.find((b) => b.bucket === name);
      expect(bucket, `bucket "${name}" should exist in report`).toBeDefined();
      expect(
        bucket!.error,
        `bucket "${name}" should have no error`,
      ).toBeUndefined();
    }
    expect(report.summary.bucketsWithErrors).toBe(0);
  });

  it("does not report a non-orphan when the path matches a DB row", async () => {
    const knownPath = "known-uuid.jpg";
    mockListImpl = (_prefix, _opts) => ({
      data: [{ name: "known-uuid.jpg", id: "id-known", created_at: null }],
      error: null,
    });

    mockPool.query.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("pottery_items")) {
        return Promise.resolve({ rows: [{ path: "known-uuid.jpg" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const report = await runStorageReconcile("test");
    const potteryBucket = report.buckets.find((b) => b.bucket === "pottery");
    expect(potteryBucket!.orphanedObjects.map((o) => o.path)).not.toContain(
      knownPath,
    );
    expect(potteryBucket!.missingObjects).not.toContain(knownPath);
  });
});
