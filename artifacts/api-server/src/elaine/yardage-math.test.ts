/**
 * Unit tests for the calculate_yardage backing/binding arithmetic.
 *
 * Each test asserts exact backing yards and binding yards against
 * independently hand-calculated values for the three canonical quilt sizes,
 * all using the default 40" fabric bolt width and 2.5" binding strip width.
 *
 * Hand-calculation method (used to derive expected values):
 *
 *   backingWidthNeeded  = quiltWidth + 8
 *   backingHeightNeeded = quiltHeight + 8
 *   backingPanels       = max(1, ceil(backingWidthNeeded / fabricWidth))
 *   backingLengthInches = backingHeightNeeded × backingPanels
 *   backingYards        = ceil((backingLengthInches / 36) × 8) / 8
 *
 *   bindingPerimeterInches = 2 × (quiltWidth + quiltHeight) + 15
 *   bindingStrips          = max(1, ceil(bindingPerimeterInches / fabricWidth))
 *   bindingYards           = ceil((bindingStrips × bindingStripWidth / 36) × 8) / 8
 */

import { describe, it, expect } from "vitest";
import { calculateYardage } from "./yardage-math";

describe('calculateYardage — canonical quilt sizes (40" bolt, 2.5" binding)', () => {
  // -------------------------------------------------------------------------
  // Twin  60 × 80 "
  // -------------------------------------------------------------------------
  // backingWidthNeeded  = 68   → panels = ceil(68/40) = 2
  // backingHeightNeeded = 88   → total inches = 176
  // backingYards        = ceil((176/36) × 8) / 8 = ceil(39.11) / 8 = 40/8 = 5.000
  //
  // bindingPerimeter    = 2×(60+80)+15 = 295
  // bindingStrips       = ceil(295/40) = 8
  // bindingYards        = ceil((8×2.5/36)×8) / 8 = ceil(4.44) / 8 = 5/8 = 0.625
  // -------------------------------------------------------------------------
  it("twin 60×80: backing = 5 yards from 2 panels, binding = 0.625 yards from 8 strips", () => {
    const result = calculateYardage({
      quiltWidthInches: 60,
      quiltHeightInches: 80,
    });

    expect(result.backingYards).toBe(5);
    expect(result.backingPanels).toBe(2);
    expect(result.bindingYards).toBe(0.625);
    expect(result.bindingStrips).toBe(8);
  });

  // -------------------------------------------------------------------------
  // Queen  90 × 108 "
  // -------------------------------------------------------------------------
  // backingWidthNeeded  = 98   → panels = ceil(98/40) = 3
  // backingHeightNeeded = 116  → total inches = 348
  // backingYards        = ceil((348/36) × 8) / 8 = ceil(77.33) / 8 = 78/8 = 9.750
  //
  // bindingPerimeter    = 2×(90+108)+15 = 411
  // bindingStrips       = ceil(411/40) = 11
  // bindingYards        = ceil((11×2.5/36)×8) / 8 = ceil(6.11) / 8 = 7/8 = 0.875
  // -------------------------------------------------------------------------
  it("queen 90×108: backing = 9.75 yards from 3 panels, binding = 0.875 yards from 11 strips", () => {
    const result = calculateYardage({
      quiltWidthInches: 90,
      quiltHeightInches: 108,
    });

    expect(result.backingYards).toBe(9.75);
    expect(result.backingPanels).toBe(3);
    expect(result.bindingYards).toBe(0.875);
    expect(result.bindingStrips).toBe(11);
  });

  // -------------------------------------------------------------------------
  // King  108 × 108 "
  // -------------------------------------------------------------------------
  // backingWidthNeeded  = 116  → panels = ceil(116/40) = 3
  // backingHeightNeeded = 116  → total inches = 348
  // backingYards        = ceil((348/36) × 8) / 8 = 78/8 = 9.750
  //
  // bindingPerimeter    = 2×(108+108)+15 = 447
  // bindingStrips       = ceil(447/40) = 12
  // bindingYards        = ceil((12×2.5/36)×8) / 8 = ceil(6.67) / 8 = 7/8 = 0.875
  // -------------------------------------------------------------------------
  it("king 108×108: backing = 9.75 yards from 3 panels, binding = 0.875 yards from 12 strips", () => {
    const result = calculateYardage({
      quiltWidthInches: 108,
      quiltHeightInches: 108,
    });

    expect(result.backingYards).toBe(9.75);
    expect(result.backingPanels).toBe(3);
    expect(result.bindingYards).toBe(0.875);
    expect(result.bindingStrips).toBe(12);
  });
});

describe("calculateYardage — edge cases", () => {
  // A small quilt that fits within the default 40" bolt width (no piecing).
  // 30 × 40 "
  // backingWidthNeeded  = 38   → panels = ceil(38/40) = 1
  // backingHeightNeeded = 48   → total inches = 48
  // backingYards        = ceil((48/36) × 8) / 8 = ceil(10.67) / 8 = 11/8 = 1.375
  //
  // bindingPerimeter    = 2×(30+40)+15 = 155
  // bindingStrips       = ceil(155/40) = 4
  // bindingYards        = ceil((4×2.5/36)×8) / 8 = ceil(2.22) / 8 = 3/8 = 0.375
  it("small lap quilt 30×40: single backing panel, no piecing", () => {
    const result = calculateYardage({
      quiltWidthInches: 30,
      quiltHeightInches: 40,
    });

    expect(result.backingPanels).toBe(1);
    expect(result.backingYards).toBe(1.375);
    expect(result.bindingStrips).toBe(4);
    expect(result.bindingYards).toBe(0.375);
  });

  // Custom fabric width (44") and binding strip width (2.25") — common values
  // for a double-fold binding cut from standard quilting cotton.
  // Queen 90×108 with 44" bolt:
  // backingWidthNeeded  = 98   → panels = ceil(98/44) = ceil(2.23) = 3
  // backingHeightNeeded = 116  → total inches = 348
  // backingYards        = ceil((348/36) × 8) / 8 = ceil(77.33) / 8 = 78/8 = 9.75
  //
  // bindingPerimeter    = 411
  // bindingStrips       = ceil(411/44) = ceil(9.34) = 10
  // bindingYards        = ceil((10×2.25/36)×8) / 8 = ceil(5.00) / 8 = 5/8 = 0.625
  it('queen 90×108 with 44" bolt and 2.25" binding: respects custom fabric/strip widths', () => {
    const result = calculateYardage({
      quiltWidthInches: 90,
      quiltHeightInches: 108,
      fabricWidthInches: 44,
      bindingStripWidthInches: 2.25,
    });

    expect(result.backingPanels).toBe(3);
    expect(result.backingYards).toBe(9.75);
    expect(result.bindingStrips).toBe(10);
    expect(result.bindingYards).toBe(0.625);
  });
});
