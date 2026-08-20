import { describe, expect, it } from "vitest";
import { JOB_REGISTRY } from "./registry";

describe("job registry", () => {
  it("registers representative bulk AI and embedding jobs", () => {
    const types = JOB_REGISTRY.map((job) => job.type);
    expect(types).toContain("ai.bulk-reanalysis");
    expect(types).toContain("embedding.generate");
  });

  it("documents idempotency for every job type", () => {
    for (const job of JOB_REGISTRY) {
      expect(job.idempotencyStrategy.trim().length).toBeGreaterThan(20);
    }
  });
});
