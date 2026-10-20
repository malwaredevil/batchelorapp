import { describe, expect, it } from "vitest";
import {
  potterySizeLabel,
  potterySizeLabels,
  sizeCategoryKey,
} from "./size-label";

describe("saved pottery measurements to size categories", () => {
  it("uses separate, reusable values for each axis", () => {
    expect(potterySizeLabels("8″ (20 cm) × 6″ (15 cm) × 3″ (8 cm)")).toEqual([
      { name: "8″ (20 cm)", key: "in:8" },
      { name: "6″ (15 cm)", key: "in:6" },
      { name: "3″ (8 cm)", key: "in:3" },
    ]);
  });
  it("assigns an equal width and height only once", () => {
    expect(potterySizeLabels("4¼″ (11 cm) × 4.25″ (11 cm)")).toEqual([
      { name: "4.25″ (11 cm)", key: "in:4.25" },
    ]);
  });
  it("keeps a metric-only axis separate from an imperial axis", () => {
    expect(potterySizeLabels("8 inches × 20 cm").map((s) => s.name)).toEqual([
      "8″ (20 cm)",
      "20 cm",
    ]);
  });
  it.each([
    ['8" (20cm)', "8″ (20 cm)"],
    ['8\\" (20 cm)', "8″ (20 cm)"],
    ["approx 20 cm (8″ bowl) diameter", "8″ (20 cm)"],
    ["approx 25.4 cm (10″ dinner plate) diameter", "10″ (25 cm)"],
    ["7¼″ (18 cm)", "7.25″ (18 cm)"],
    ["3 1/2 inches", "3.5″ (9 cm)"],
    ["3½″ (9 cm)", "3.5″ (9 cm)"],
    ["8,5 inches", "8.5″ (22 cm)"],
    ["8″ (20 cm) × 6″ (15 cm)", "8″ (20 cm) × 6″ (15 cm)"],
    ["approx 8 cm × 10 cm (3″ × 4″ mug)", "3″ (8 cm) × 4″ (10 cm)"],
    ["approx 9 cm (3½″ mug) diameter × 9 cm height", "3.5″ (9 cm) × 9 cm"],
    [
      "12″ (30 cm) × 8″ (20 cm) × 3″ (8 cm)",
      "12″ (30 cm) × 8″ (20 cm) × 3″ (8 cm)",
    ],
    ["approx 10 cm diameter", "10 cm"],
    ["8 inches × 20 cm", "8″ (20 cm) × 20 cm"],
  ])("formats %s without changing the saved field", (raw, name) => {
    expect(potterySizeLabel(raw)?.name).toBe(name);
  });

  it.each([
    null,
    "",
    "unknown",
    "not measured",
    "not measured 8 inches",
    "8",
    "8 x 6 inches",
    "8-10 inches",
    "8 to 10 inches",
    "-8 inches",
    "0 inches",
    "1/0 inches",
    "2/0 inches",
    "9 inches or 10 inches",
    "999999 cm",
    "1″ × 2″ × 3″ × 4″",
  ])("skips ambiguous or missing measurements: %s", (raw) => {
    expect(potterySizeLabel(raw)).toBeNull();
  });

  it("reuses equivalent quote, fraction and whitespace spellings", () => {
    expect(sizeCategoryKey('3½" (9 cm)')).toBe(sizeCategoryKey("3.5″ (9cm)"));
    expect(sizeCategoryKey('8" (20cm)')).toBe(sizeCategoryKey("8″ (20 cm)"));
  });
  it("does not collapse distinct sizes that round to the same centimetre", () => {
    expect(sizeCategoryKey("7¾″ (20 cm)")).not.toBe(
      sizeCategoryKey("8″ (20 cm)"),
    );
  });
  it.each(["Blue", "8 inch bowls", "Small 8″", "1920", "Side"])(
    "does not mistake an ordinary category for a size: %s",
    (name) => {
      expect(sizeCategoryKey(name)).toBeNull();
    },
  );
});
