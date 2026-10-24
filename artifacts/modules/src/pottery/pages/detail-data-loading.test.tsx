import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("pottery detail data loading", () => {
  it("loads lightweight maker options instead of hundreds of complete pieces", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/pottery/pages/detail.tsx"),
      "utf8",
    );
    expect(source).toContain("useGetPotteryFieldOptions()");
    expect(source).toContain("fieldOptions?.makers");
    expect(source).not.toMatch(/\buseListPottery\b/);
    expect(source).not.toMatch(/pageSize:\s*200/);
  });
});
