import { describe, expect, it } from "vitest";
import { BUCKET_DB_SQL } from "../storage-reconcile";

describe("storage reconciliation protects pottery originals", () => {
  it("counts both primary and supplemental original references", () => {
    expect(BUCKET_DB_SQL.pottery).toMatch(
      /SELECT original_image_path AS path FROM pottery_items WHERE original_image_path IS NOT NULL/,
    );
    expect(BUCKET_DB_SQL.pottery).toMatch(
      /SELECT original_image_path AS path FROM pottery_images WHERE original_image_path IS NOT NULL/,
    );
    // Deleted rows still protect files throughout their existing grace period.
    expect(BUCKET_DB_SQL.pottery).not.toMatch(/deleted_at\s+IS\s+NULL/i);
  });
});
