import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const indexSource = readFileSync(
  fileURLToPath(new URL("../index.ts", import.meta.url)),
  "utf8",
);

describe("startup readiness ordering", () => {
  it("starts workers only after migration, buckets, and ready transition", () => {
    expect(indexSource.indexOf("await runStartupMigration()")).toBeLessThan(
      indexSource.indexOf('startJobWorker("slack")'),
    );
    expect(indexSource.indexOf("await provisionAllBuckets()")).toBeLessThan(
      indexSource.indexOf('startJobWorker("slack")'),
    );
    expect(indexSource.indexOf("markStartupReady()")).toBeLessThan(
      indexSource.indexOf('startJobWorker("slack")'),
    );
    expect(indexSource.indexOf("markStartupReady()")).toBeLessThan(
      indexSource.indexOf('startJobWorker("ai")'),
    );
  });
});
