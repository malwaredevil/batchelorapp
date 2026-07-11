/**
 * DEV-ONLY — /quilting/dev/fabric-size
 *
 * Three comparison views of what "block size" means for fabric texture density:
 *   Section A — Swatch-size demo: pick any block size, see computed repeat count.
 *   Section B — 3″ vs 5″ physical tiling: same pixel canvas, physically-correct density.
 *   Section C — Scale-to-fill: 3″ (swatch fills cell 1:1) vs 5″ (swatch scaled ×1.67).
 *
 * ALL panels use blob-URL-authenticated tile-image.png (no raw /api/ URLs in SVG patterns).
 */

import { useState } from "react";
import {
  SWATCH_WIDTH_IN,
  DevNav,
  TilesStatus,
  BlockPanel,
  LayoutPanel,
  FabricPhotoStrip,
  useDevData,
} from "./_shared";

export default function FabricSizeDevPage() {
  const [selectedBlockInches, setSelectedBlockInches] = useState(9);
  const {
    demoBlock,
    demoLayout,
    layoutBlocks,
    blobFabricUrlMap,
    tilesLoading,
    demoFabricIds,
    fabricsList,
  } = useDevData();

  const demoGridSize = demoBlock?.gridSize ?? 1;
  const swatchRepeats = selectedBlockInches / demoGridSize / SWATCH_WIDTH_IN;
  const tilesCount = Object.keys(blobFabricUrlMap).length;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold">Block size vs fabric density</h1>
          <p className="text-sm text-muted-foreground">
            DEV-ONLY. Three views showing how finished block size affects how
            densely the fabric swatch tiles. All panels use{" "}
            <code>/tile-image.png</code> via blob URLs (production pipeline).
          </p>
        </div>
        <DevNav current="size" />
      </div>

      <FabricPhotoStrip fabricIds={demoFabricIds} fabricsList={fabricsList} />

      <div className="flex items-center gap-2 text-sm">
        <TilesStatus loading={tilesLoading} count={tilesCount} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section A: Swatch-size demo — pick block size, see repeats         */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-t pt-6">
        <h2 className="text-lg font-bold">
          A — Swatch-size demo: computed repeats per block size
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Each stored swatch photo represents a {SWATCH_WIDTH_IN}″ sample.
          Repeats = cell size ÷ swatch width, where cell = block ÷ gridSize (
          {demoGridSize}). At {SWATCH_WIDTH_IN * demoGridSize}″ the repeat is
          1×1 (swatch fills cell exactly).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Block size:</label>
            <select
              value={selectedBlockInches}
              onChange={(e) => setSelectedBlockInches(Number(e.target.value))}
              className="rounded border bg-background px-2 py-1 text-sm"
            >
              {[3, 4, 6, 9, 12, 18].map((in_) => (
                <option key={in_} value={in_}>
                  {in_}″ block
                </option>
              ))}
            </select>
          </div>
          <div className="rounded bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            Cell = {(selectedBlockInches / demoGridSize).toFixed(1)}″ →{" "}
            <strong>
              {swatchRepeats.toFixed(2)}× repeats/cell (
              {(swatchRepeats * swatchRepeats).toFixed(1)} tiles/cell)
            </strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BlockPanel
          block={demoBlock}
          fabricUrlMap={blobFabricUrlMap}
          fabricTileRepeats={swatchRepeats}
          label={`Block at ${selectedBlockInches}″ (${swatchRepeats.toFixed(2)}× repeats)`}
        />
        <LayoutPanel
          layout={demoLayout}
          blocks={layoutBlocks}
          fabricUrlMap={blobFabricUrlMap}
          fabricTileRepeats={swatchRepeats}
          label={`Layout at ${selectedBlockInches}″ (${swatchRepeats.toFixed(2)}× repeats)`}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section B: 3″ vs 5″ physical tiling                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-t pt-8">
        <h2 className="text-lg font-bold">B — 3″ vs 5″ physical tiling</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Both rendered at the same pixel size, but with{" "}
          <em>physically-correct</em> tile density (cellInches / swatchWidth).
          <br />— 3″ block → cell = {(3 / demoGridSize).toFixed(2)}″ →{" "}
          <strong>
            {(3 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}× repeats
          </strong>
          <br />— 5″ block → cell = {(5 / demoGridSize).toFixed(2)}″ →{" "}
          <strong>
            {(5 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}× repeats
          </strong>{" "}
          (you see more of the fabric, finer texture)
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">
            3″ block — {(3 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}×
            repeats/cell
          </p>
          <BlockPanel
            block={demoBlock}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={3 / demoGridSize / SWATCH_WIDTH_IN}
            label={`Block at 3″ (${(3 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}× repeats)`}
          />
          <LayoutPanel
            layout={demoLayout}
            blocks={layoutBlocks}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={3 / demoGridSize / SWATCH_WIDTH_IN}
            label={`Layout at 3″ (${(3 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}× repeats)`}
          />
        </div>
        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">
            5″ block — {(5 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}×
            repeats/cell
          </p>
          <BlockPanel
            block={demoBlock}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={5 / demoGridSize / SWATCH_WIDTH_IN}
            label={`Block at 5″ (${(5 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}× repeats)`}
          />
          <LayoutPanel
            layout={demoLayout}
            blocks={layoutBlocks}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={5 / demoGridSize / SWATCH_WIDTH_IN}
            label={`Layout at 5″ (${(5 / demoGridSize / SWATCH_WIDTH_IN).toFixed(2)}× repeats)`}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section C: Scale-to-fill — same canvas, different repeats          */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-t pt-8">
        <h2 className="text-lg font-bold">
          C — Scale-to-fill: one swatch per cell
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Both panels are the same pixel size. Repeats reflect how many times a{" "}
          {SWATCH_WIDTH_IN}″ swatch fits across the cell at physical scale.
          <br />— <strong>3″ block</strong>: cell = {SWATCH_WIDTH_IN}″ = swatch
          width → <code>repeats = 1.00</code>. Swatch fills cell at 1:1.
          <br />— <strong>5″ block</strong>: cell = 5″ &gt; {SWATCH_WIDTH_IN}″
          swatch → <code>repeats = {(SWATCH_WIDTH_IN / 5).toFixed(2)}</code>.
          Swatch scaled up ×{(5 / SWATCH_WIDTH_IN).toFixed(2)} — the weave/print
          appears bigger (zoomed in).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">
            3″ block — repeats = 1.00 (swatch fills cell at 1:1)
          </p>
          <BlockPanel
            block={demoBlock}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={1}
            label="Block at 3″ — scale to fill (repeats = 1.00)"
          />
          <LayoutPanel
            layout={demoLayout}
            blocks={layoutBlocks}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={1}
            label="Layout at 3″ — scale to fill (repeats = 1.00)"
          />
        </div>
        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">
            5″ block — repeats = {(SWATCH_WIDTH_IN / 5).toFixed(2)} (swatch
            scaled ×{(5 / SWATCH_WIDTH_IN).toFixed(2)}, fabric zoomed in)
          </p>
          <BlockPanel
            block={demoBlock}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={SWATCH_WIDTH_IN / 5}
            label={`Block at 5″ — scale to fill (repeats = ${(SWATCH_WIDTH_IN / 5).toFixed(2)})`}
          />
          <LayoutPanel
            layout={demoLayout}
            blocks={layoutBlocks}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={SWATCH_WIDTH_IN / 5}
            label={`Layout at 5″ — scale to fill (repeats = ${(SWATCH_WIDTH_IN / 5).toFixed(2)})`}
          />
        </div>
      </div>
    </div>
  );
}
