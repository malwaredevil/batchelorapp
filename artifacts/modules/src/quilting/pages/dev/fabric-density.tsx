/**
 * DEV-ONLY — /quilting/dev/fabric-density
 *
 * Stamp density comparison: current production (4×4 = 16 tiles/cell) vs a
 * selectable alternative, using the first real DB block + layout and the
 * production tile pipeline (tile-image.png via blob URL auth).
 */

import { useState } from "react";
import {
  CURRENT_REPEATS,
  DevNav,
  TilesStatus,
  BlockPanel,
  LayoutPanel,
  FabricPhotoStrip,
  useDevData,
} from "./_shared";

export default function FabricDensityDevPage() {
  const [selectedRepeats, setSelectedRepeats] = useState(1);
  const {
    demoBlock,
    demoLayout,
    layoutBlocks,
    blobFabricUrlMap,
    tilesLoading,
    demoFabricIds,
    fabricsList,
  } = useDevData();

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold">Stamp density — live comparison</h1>
          <p className="text-sm text-muted-foreground">
            DEV-ONLY. Renders the first saved block + layout from your actual
            database via the production pipeline (<code>BlockPreviewSvg</code> +{" "}
            <code>LayoutPreviewSvg</code> + <code>/tile-image.png</code> blob
            URLs). Whatever looks right here is guaranteed to look the same in
            the app.
          </p>
        </div>
        <DevNav current="density" />
      </div>

      <FabricPhotoStrip fabricIds={demoFabricIds} fabricsList={fabricsList} />

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          Repeats per cell
          <TilesStatus
            loading={tilesLoading}
            count={Object.keys(blobFabricUrlMap).length}
          />
        </h2>
        <label className="text-sm font-medium">Compare against:</label>
        <select
          value={selectedRepeats}
          onChange={(e) => setSelectedRepeats(Number(e.target.value))}
          className="rounded border bg-background px-2 py-1 text-sm"
        >
          {[1, 2, 3, 4, 5, 6, 8].map((r) => (
            <option key={r} value={r}>
              {r}×{r} per cell ({r * r} tiles)
              {r === CURRENT_REPEATS ? " — current production" : ""}
            </option>
          ))}
        </select>
        {demoBlock && (
          <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            Block: &quot;{demoBlock.name}&quot; ({demoBlock.gridSize}×
            {demoBlock.gridSize})
          </span>
        )}
        {demoLayout && (
          <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            Layout: &quot;{demoLayout.name}&quot; ({demoLayout.cols}×
            {demoLayout.rows})
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">
            Current production — {CURRENT_REPEATS}×{CURRENT_REPEATS} ={" "}
            {CURRENT_REPEATS * CURRENT_REPEATS} tiles/cell
          </p>
          <BlockPanel
            block={demoBlock}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={CURRENT_REPEATS}
            label={
              demoBlock
                ? `Block: "${demoBlock.name}" — ${CURRENT_REPEATS}× (current)`
                : "Block"
            }
          />
          <LayoutPanel
            layout={demoLayout}
            blocks={layoutBlocks}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={CURRENT_REPEATS}
            label={
              demoLayout
                ? `Layout: "${demoLayout.name}" — ${CURRENT_REPEATS}× (current)`
                : "Saved layout"
            }
          />
        </div>

        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">
            Selected — {selectedRepeats}×{selectedRepeats} ={" "}
            {selectedRepeats * selectedRepeats} tiles/cell
            {selectedRepeats === CURRENT_REPEATS && " (same as current)"}
          </p>
          <BlockPanel
            block={demoBlock}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={selectedRepeats}
            label={
              demoBlock
                ? `Block: "${demoBlock.name}" — ${selectedRepeats}×`
                : "Block"
            }
          />
          <LayoutPanel
            layout={demoLayout}
            blocks={layoutBlocks}
            fabricUrlMap={blobFabricUrlMap}
            fabricTileRepeats={selectedRepeats}
            label={
              demoLayout
                ? `Layout: "${demoLayout.name}" — ${selectedRepeats}×`
                : "Saved layout"
            }
          />
        </div>
      </div>
    </div>
  );
}
