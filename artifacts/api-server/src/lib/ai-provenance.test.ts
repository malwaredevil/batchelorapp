import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query } }));

import {
  assignGenerationRunTarget,
  buildAnalysisCandidates,
} from "./ai-provenance";

describe("buildAnalysisCandidates", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("turns each structured analysis field into a traceable candidate", () => {
    expect(
      buildAnalysisCandidates({
        name: "Blue Bowl",
        motifs: ["speckles"],
        maker: null,
      }),
    ).toEqual([
      {
        fieldPath: "name",
        value: "Blue Bowl",
        confidenceMethod: "vision_inference",
        authorityClass: "vision",
      },
      {
        fieldPath: "motifs",
        value: ["speckles"],
        confidenceMethod: "vision_inference",
        authorityClass: "vision",
      },
      {
        fieldPath: "maker",
        value: null,
        confidenceMethod: "vision_inference",
        authorityClass: "vision",
      },
    ]);
  });

  it("supports workflow-specific evidence metadata", () => {
    expect(
      buildAnalysisCandidates(
        { barcode: "123" },
        {
          authorityClass: "barcode",
          confidenceMethod: "exact_identifier_match",
        },
      )[0],
    ).toMatchObject({
      authorityClass: "barcode",
      confidenceMethod: "exact_identifier_match",
    });
  });

  it("atomically links pre-insert runs and candidates to the created item", async () => {
    query.mockResolvedValue({ rows: [] });

    await assignGenerationRunTarget(41, 73);

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain("WITH updated_run AS");
    expect(query.mock.calls[0][0]).toContain("UPDATE ai_field_candidates");
    expect(query.mock.calls[0][1]).toEqual([41, 73]);
  });
});
