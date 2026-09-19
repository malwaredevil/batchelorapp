/**
 * Geometry shared by the on-screen layout SVG and exported layout SVGs.
 *
 * Fabric patterns are intentionally smaller than a layout cell: the preview
 * repeats the source fabric across each cell, and exports must use the same
 * user-space pattern size (including when a pattern is used by a block
 * subcell or by trim).
 */
export const DEFAULT_FABRIC_TILE_REPEATS = 4;

export function getFabricPatternSize(
  cellPx: number,
  repeats = DEFAULT_FABRIC_TILE_REPEATS,
) {
  return cellPx / repeats;
}

export type LayoutSvgGeometryInput = {
  rows: number;
  cols: number;
  sashingWidthInches?: number | null;
  borderWidthInches?: number | null;
};

export function getLayoutSvgGeometry(
  layout: LayoutSvgGeometryInput,
  size: number,
) {
  const sashW = layout.sashingWidthInches ?? 0;
  const bordW = layout.borderWidthInches ?? 0;
  const unitW = layout.cols + sashW * (layout.cols - 1) + bordW * 2;
  const unitH = layout.rows + sashW * (layout.rows - 1) + bordW * 2;
  const scale = size / Math.max(unitW, unitH);
  const cellPx = scale;
  const sashPx = sashW * scale;
  const borderPx = bordW * scale;

  return {
    unitW,
    unitH,
    scale,
    cellPx,
    sashPx,
    borderPx,
    width: unitW * scale,
    height: unitH * scale,
    fabricPatternPx: getFabricPatternSize(cellPx),
  };
}
