/**
 * DEV-ONLY — /quilting/dev/fabric-compare
 *
 * Overview / nav hub for all fabric rendering dev pages.
 * The detailed comparisons have moved to their own focused pages so each
 * loads fewer tiles and renders faster.
 */

import { DevNav, FabricPhotoStrip, useDevData } from "./_shared";

const SOURCE_IMAGE_URL = `${import.meta.env.BASE_URL}dev-fabric-compare/source.jpg`;

const PAGES = [
  {
    href: "/modules/quilting/dev/fabric-density",
    label: "Density comparison",
    description:
      "Current production (4×4 = 16 tiles/cell) vs a selectable repeat count. Renders the first DB block + layout via the production pipeline.",
  },
  {
    href: "/modules/quilting/dev/fabric-size",
    label: "3\u2033 vs 5\u2033 block size",
    description:
      "Three views: swatch-size demo (pick any block size), 3\u2033 vs 5\u2033 physical tiling, and scale-to-fill (repeats = 1.00 vs 0.60).",
  },
  {
    href: "/modules/quilting/dev/fabric-pipeline",
    label: "Pipeline A variants",
    description:
      "Historical reference: all Direction A vectorization tuning variants side-by-side. Uses unauthenticated dev endpoints \u2014 no blob pre-fetch needed.",
  },
  {
    href: "/modules/quilting/dev/fabric-photo-preview",
    label: "Photo-clip \u2728 most realistic",
    description:
      "Actual fabric photos clipped to each triangle/square shape via SVG clipPath \u2014 one real photo per cut piece, no tiling, no vectorization artifacts.",
  },
] as const;

export default function FabricCompareDevPage() {
  const { demoFabricIds, fabricsList } = useDevData();
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold">
            Fabric SVG rendering — dev comparison hub
          </h1>
          <p className="text-sm text-muted-foreground">
            Internal dev-only pages. Not linked from any menu. Never pushed to
            GitHub or served in production.
          </p>
        </div>
        <DevNav current="compare" />
      </div>

      <FabricPhotoStrip fabricIds={demoFabricIds} fabricsList={fabricsList} />

      {/* Source fabric photo */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Source fabric swatch (reference photo)
        </h2>
        <img
          src={SOURCE_IMAGE_URL}
          alt="Source fabric"
          className="rounded border"
          width={280}
        />
      </div>

      {/* Page directory */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Dev pages</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {PAGES.map((p) => (
            <a
              key={p.href}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-1 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
            >
              <span className="font-semibold text-sm">{p.label}</span>
              <span className="text-xs text-muted-foreground">
                {p.description}
              </span>
            </a>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-4">
        Each page pre-fetches its fabric tiles as blob URLs (
        <code>fetch&#123;credentials:&apos;include&apos;&#125;</code> →{" "}
        <code>blob:</code>) so SVG <code>&lt;pattern&gt;&lt;image&gt;</code>{" "}
        never has to carry session cookies. The &ldquo;✓ N fabric tiles
        loaded&rdquo; indicator in each page&apos;s header confirms the tiles
        are ready before the panels render.
      </p>
    </div>
  );
}
