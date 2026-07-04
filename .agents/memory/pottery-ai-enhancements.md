---
name: Pottery AI enhancements
description: New AI features added to pottery: glaze-type classification, surface zone analysis, zone embedding for 3-way RRF search. Also covers the broken orval codegen workaround.
---

## New columns (added additively via schema-statements.ts)

- `glaze_type text` — Jina CLIP zero-shot classification from `GLAZE_TYPE_LABELS`
- `surface_zones jsonb` — GPT-structured decomposition into named decorative zones (rim, body, shoulder, foot, interior, handle, spout)
- `zone_embedding vector(1024)` — Jina CLIP embedding of the center body crop (top 15%, height 70%), for surface-pattern similarity

## Key functions (pottery/openai.ts)

- `analyzeImage()` — now runs `classifyGlazeType` in parallel via Jina CLIP; result is in `VisionAnalysis.glazeType`
- `analyzePotteryZones(dataUrls)` — separate GPT call returning `SurfaceZoneAnalysis | null`
- `locateBackstampAndEnhanceMaker(dataUrls)` — focused backstamp pass, only run when `analysis.maker === null`
- All three use `callModel(MODELS.FAST/SMART_VISION, ...)`

## Key function (visual-embed.ts)

- `generateZoneEmbedding(imageBuffer)` — crops center 70% with sharp, returns Jina CLIP embedding; silently returns null when JINA_API_KEY absent

## Compare route 3-way RRF

`compare.ts` now has three search lanes: text embedding + whole-piece visual + zone embedding. Fused via 3-argument `reciprocalRankFusion(textRanked, visualRanked, zoneRanked, k=60)`.

## serialize.ts / type annotation gotcha

`ItemRowForSerialization = Omit<PotteryItemRow, "embedding" | "visualEmbedding" | "zoneEmbedding">` — all three vectors must be excluded, otherwise TypeScript complains when the itemColumns select (which also excludes all three) is assigned to a typed variable.

Watch for **explicit `let row: Omit<PotteryItemRow, "embedding" | "visualEmbedding">` annotations** in route handlers — these need updating whenever a new vector column is added.

## Orval codegen is broken (ESM js-yaml issue)

`pnpm --filter @workspace/api-spec run codegen` fails at the orval step with `SyntaxError: The requested module 'js-yaml' does not provide an export named 'default'` on Node 24. The build-spec step completes correctly (openapi.yaml is written).

**Workaround:** Manually update the generated files in `lib/api-zod/src/generated/`:

1. `types/potteryPotteryItem.ts` — add the TypeScript interface fields
2. `api.ts` — add the Zod schema fields (use `replace_all: true` for patterns like `"acquiredAt" → "dominantColors"` to update all pottery item schemas at once)
