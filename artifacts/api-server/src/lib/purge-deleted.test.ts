import { describe, expect, it } from "vitest";
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
});
