import { describe, expect, it } from "vitest";
import {
  buildMissingOrnamentIdentityUpdate,
  mergeOrnamentIdentity,
} from "./identity";

describe("mergeOrnamentIdentity", () => {
  const existing = {
    name: "Untitled ornament",
    seriesOrCollection: null,
    year: null,
    barcodeValue: "661127022308",
  };

  it("fills only missing identity fields after a successful enrichment", () => {
    expect(
      mergeOrnamentIdentity(
        existing,
        {
          name: "Snow Day",
          seriesOrCollection: "Frosty Friends",
          year: 1998,
          barcodeValue: "other",
        },
        [],
      ),
    ).toEqual({
      name: "Snow Day",
      seriesOrCollection: "Frosty Friends",
      year: 1998,
      barcodeValue: "661127022308",
    });
  });

  it("keeps locked fields and unsupported enrichment results unchanged", () => {
    expect(
      mergeOrnamentIdentity(
        {
          name: "Saved name",
          seriesOrCollection: null,
          year: null,
          barcodeValue: null,
        },
        { seriesOrCollection: "Frosty Friends", year: null },
        ["seriesOrCollection", "year"],
      ),
    ).toEqual({
      name: "Saved name",
      seriesOrCollection: null,
      year: null,
      barcodeValue: null,
    });
  });

  it("does not replace a saved identity with a later analysis candidate", () => {
    expect(
      mergeOrnamentIdentity(
        {
          name: "Saved name",
          seriesOrCollection: "Saved series",
          year: 1995,
          barcodeValue: null,
        },
        {
          name: "Different name",
          seriesOrCollection: "Different series",
          year: 1996,
        },
        [],
      ),
    ).toMatchObject({
      name: "Saved name",
      seriesOrCollection: "Saved series",
      year: 1995,
    });
  });
});

describe("buildMissingOrnamentIdentityUpdate", () => {
  it("writes only fields that are missing and unlocked", () => {
    expect(
      buildMissingOrnamentIdentityUpdate(
        ["embedding", "seriesOrCollection", "year"],
        ["year"],
        { seriesOrCollection: "Frosty Friends", year: 1992 },
        [0.1, 0.2],
      ),
    ).toEqual({
      embedding: [0.1, 0.2],
      seriesOrCollection: "Frosty Friends",
    });
  });

  it("does not write established identity values when only an embedding is missing", () => {
    expect(
      buildMissingOrnamentIdentityUpdate(
        ["embedding"],
        [],
        { seriesOrCollection: "Frosty Friends", year: 1992 },
        [0.1, 0.2],
      ),
    ).toEqual({ embedding: [0.1, 0.2] });
  });
});
