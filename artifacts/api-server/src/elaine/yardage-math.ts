/**
 * Pure yardage-calculation logic extracted from the calculate_yardage tool so
 * it can be unit-tested without importing the full index.ts module.
 *
 * All inputs are in inches; all outputs are in yards, rounded up to the
 * nearest ⅛ yard.
 */

export interface YardageInput {
  /** Finished quilt width in inches. */
  quiltWidthInches: number;
  /** Finished quilt height in inches. */
  quiltHeightInches: number;
  /** Usable fabric width off the bolt (default: 40"). */
  fabricWidthInches?: number;
  /** WOF binding strip width when cut (default: 2.5"). */
  bindingStripWidthInches?: number;
}

export interface YardageResult {
  /** Yards of backing fabric needed (rounded up to nearest ⅛ yd). */
  backingYards: number;
  /**
   * Number of fabric-width panels the backing must be pieced from.
   * 1 means the quilt fits within a single bolt width.
   */
  backingPanels: number;
  /** Yards of binding fabric needed (rounded up to nearest ⅛ yd). */
  bindingYards: number;
  /** Number of WOF strips needed to yield enough binding. */
  bindingStrips: number;
}

/** Round a fractional yard value up to the nearest ⅛ yard. */
function roundUpToEighth(yards: number): number {
  return Math.ceil(yards * 8) / 8;
}

/**
 * Compute backing and binding yardage estimates for a finished quilt.
 *
 * Backing: adds 8" overhang on each dimension (standard longarm margin),
 * then pieces into panels when the quilt is wider than the fabric bolt.
 *
 * Binding: uses `2 × (width + height) + 15"` for mitered corners and join
 * slack, then cuts WOF strips from the fabric bolt.
 */
export function calculateYardage(input: YardageInput): YardageResult {
  const {
    quiltWidthInches: w,
    quiltHeightInches: h,
    fabricWidthInches: fabricWidth = 40,
    bindingStripWidthInches: bindingStripWidth = 2.5,
  } = input;

  // Backing — 8" overhang on each side, pieced if wider than the bolt.
  const backingWidthNeeded = w + 8;
  const backingHeightNeeded = h + 8;
  const backingPanels = Math.max(
    1,
    Math.ceil(backingWidthNeeded / fabricWidth),
  );
  const backingLengthInches = backingHeightNeeded * backingPanels;
  const backingYards = roundUpToEighth(backingLengthInches / 36);

  // Binding — perimeter + 15" slack, cut into WOF strips.
  const bindingPerimeterInches = 2 * (w + h) + 15;
  const bindingStrips = Math.max(
    1,
    Math.ceil(bindingPerimeterInches / fabricWidth),
  );
  const bindingYards = roundUpToEighth(
    (bindingStrips * bindingStripWidth) / 36,
  );

  return { backingYards, backingPanels, bindingYards, bindingStrips };
}
