/**
 * DEV-ONLY — /quilting/dev/fabric-pipeline
 *
 * Full pipeline history on one page: every stage from raw photo through to the
 * shipped production tile, so you can compare them all side-by-side.
 *
 * Stage 0 — Original photo
 * Stage 1 — Flat-field correction (lighting / vignette removal)
 * Stage 2 — Posterized raster (ready to vectorize)
 * Stage 3 — Direction A: baseline VTracer
 * Stage 4 — Direction A: smooth
 * Stage 5 — Direction A: crisp
 * Stage 6 — Direction A: 3-pass flat-field
 * Stage 7 — Direction A: ultra-smooth
 * Stage 8 — Direction A: max detail  ← PRODUCTION DEFAULT (the one you chose)
 *
 * Uses the unauthenticated dev tile experiment endpoints
 * (/api/quilting/dev/fabric-tile-experiment/:id/method) so no blob-URL
 * pre-fetch is needed — tiles are loaded directly as <image href> in SVG.
 *
 * No production code, infrastructure, or database changes.
 */

import {
  CURRENT_REPEATS,
  DevNav,
  BlockPanel,
  FabricPhotoStrip,
  fabricTileUrl,
  ALL_PIPELINE_VARIANTS,
  useDevData,
} from "./_shared";

export default function FabricPipelineDevPage() {
  const { demoBlock, demoFabricIds, fabricsList } = useDevData();

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold">
            Full pipeline — raw photo → shipped tile
          </h1>
          <p className="text-sm text-muted-foreground">
            DEV-ONLY. Every stage from the original swatch photo through to the
            production tile, all on one page. The panel outlined in green is the
            one currently shipped.{" "}
            <span className="text-muted-foreground/70">
              Uses unauthenticated dev endpoints (
              <code>/api/quilting/dev/fabric-tile-experiment/:id/method</code>)
              — no blob pre-fetch needed.
            </span>
          </p>
        </div>
        <DevNav current="pipeline" />
      </div>

      <FabricPhotoStrip fabricIds={demoFabricIds} fabricsList={fabricsList} />

      {demoBlock && (
        <p className="text-sm text-muted-foreground">
          Block: <strong>{demoBlock.name}</strong>
          {demoFabricIds.length > 0 && (
            <> — fabric IDs: {demoFabricIds.join(" / ")}</>
          )}
        </p>
      )}

      {/* 3-column grid — all 9 stages */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {ALL_PIPELINE_VARIANTS.map((v) => (
          <div
            key={v.method}
            className={
              v.isProduction
                ? "rounded-xl ring-2 ring-green-500 ring-offset-2"
                : undefined
            }
          >
            <BlockPanel
              block={demoBlock}
              fabricUrlMap={Object.fromEntries(
                demoFabricIds.map((id) => [id, fabricTileUrl(id, v.method)]),
              )}
              fabricTileRepeats={CURRENT_REPEATS}
              label={
                v.isProduction
                  ? `${v.stage} — ${v.title} ★`
                  : `${v.stage} — ${v.title}`
              }
            />
            <p className="mt-1 px-1 text-xs text-muted-foreground">
              {v.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
