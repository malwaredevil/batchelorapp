import sharp, { type OutputInfo } from "sharp";
import {
  vectorize,
  ColorMode,
  Hierarchical,
  PathSimplifyMode,
} from "@neplex/vectorizer";

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Hard ceiling on the number of pixels Sharp will decode from any input. This
 * rejects "decompression bomb" uploads — a tiny file that expands to a huge
 * raster — before they can exhaust CPU/memory. 50 MP comfortably covers any
 * real phone/camera photo while blocking pathological inputs.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Longest-edge cap for images we persist. Keeps stored originals at a sane size
 * for display without letting a single upload balloon storage or later AI
 * payloads. A 2048px JPEG is well under ~1 MB.
 */
const MAX_STORAGE_DIMENSION = 2048;

/**
 * Longest-edge cap for images handed to the vision model. Vision models tile
 * images at ~512px, so 1024px is plenty of detail while keeping each base64
 * payload small. This is the key bound that stops the compare fan-out from
 * turning a handful of stored images into hundreds of megabytes of request body.
 */
const MAX_AI_DIMENSION = 1024;

/**
 * Sniff the real image type from the file's magic bytes. Returns null for any
 * content that is not a supported image, regardless of the declared MIME type.
 */
export function sniffImageType(buffer: Buffer): SupportedImageType | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function toDataUrl(buffer: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * Decode `buffer` with a strict pixel ceiling, bake in EXIF orientation, strip
 * all embedded metadata (EXIF, ICC, XMP, GPS, etc.), downscale so the longest
 * edge is at most `maxDimension`, and re-encode in the same container format.
 *
 * Centralising decode here means every untrusted image — whether it is stored
 * or sent to a third party — passes through the same bounded pipeline.
 */
async function processImage(
  buffer: Buffer,
  contentType: SupportedImageType,
  maxDimension: number,
): Promise<Buffer> {
  const pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  switch (contentType) {
    case "image/jpeg":
      return pipeline.jpeg().toBuffer();
    case "image/png":
      return pipeline.png().toBuffer();
    case "image/webp":
      return pipeline.webp().toBuffer();
  }
}

/**
 * Normalise an uploaded image for persistence: metadata stripped and bounded to
 * {@link MAX_STORAGE_DIMENSION}. Output uses the same container format as the
 * input so callers can keep using the original `contentType`.
 */
export async function stripImageMetadata(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  return processImage(buffer, contentType, MAX_STORAGE_DIMENSION);
}

/**
 * Produce a data URL for a vision-model request, bounded to
 * {@link MAX_AI_DIMENSION}. Used for both freshly uploaded candidates and
 * images pulled from storage, so legacy oversized originals are also capped
 * before they reach the AI request body.
 */
export async function toAiDataUrl(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<string> {
  const bounded = await processImage(buffer, contentType, MAX_AI_DIMENSION);
  return toDataUrl(bounded, contentType);
}

/**
 * Square size (px) of the generated tileable fabric crop. Small enough to be
 * cheap to generate/serve, large enough to preserve visible weave/print grain.
 */
const FLAT_TILE_SIZE = 512;

/**
 * Standard deviation (px) of the low-pass blur used to estimate the
 * illumination field for flat-field correction. Roughly a third of the tile
 * size isolates slow lighting falloff (vignette, directional light) while
 * leaving fine weave/print texture in the high-frequency residual.
 */
const FLAT_FIELD_BLUR_SIGMA = FLAT_TILE_SIZE / 3;

/**
 * Generate a flat-field-corrected, tileable square crop of a fabric photo,
 * suitable for use as an SVG `<pattern>` fill.
 *
 * Real fabric photos almost always have some low-frequency lighting falloff
 * (a vignette, or a single directional light source) baked into the pixels.
 * When a single crop of that photo is repeated as a tiling pattern (as our
 * SVG fabric swatches do), that falloff repeats at high frequency too — each
 * tile shows the same lighter-center/darker-edge gradient, which the eye
 * reads as a grid of embossed, "puffy" 3D squares.
 *
 * This performs a classic flat-field / retinex-style illumination-flattening
 * pass: subtract a heavily blurred (low-frequency) copy of the crop from
 * itself, then add back the crop's global mean brightness. That cancels the
 * slow-varying lighting field while preserving the fine, high-frequency grain
 * that makes the weave/print recognizable. A saturation/contrast boost is
 * then applied per the "color enhanced" request — flattening alone can look
 * slightly washed out.
 *
 * Sharp has no built-in per-pixel "divide"/subtract composite, so this is
 * done via raw pixel-buffer arithmetic rather than a `.composite()` call.
 */
export async function generateFlatFabricTile(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  const cropped = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: FLAT_TILE_SIZE,
      height: FLAT_TILE_SIZE,
      fit: "cover",
      position: "centre",
    })
    .removeAlpha()
    .toColourspace("srgb");

  const { data: sharpBuf, info } = await cropped
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: blurredBuf } = await cropped
    .clone()
    .blur(FLAT_FIELD_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = sharpBuf.length;
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) sum += sharpBuf[i]!;
  const mean = sum / pixelCount;

  const flattened = Buffer.alloc(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const value = sharpBuf[i]! - blurredBuf[i]! + mean;
    flattened[i] = value < 0 ? 0 : value > 255 ? 255 : value;
  }

  const flatImage = sharp(flattened, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .normalise()
    .modulate({ saturation: 1.3, brightness: 1.03 });

  switch (contentType) {
    case "image/jpeg":
      return flatImage.jpeg({ quality: 90 }).toBuffer();
    case "image/png":
      return flatImage.png().toBuffer();
    case "image/webp":
      return flatImage.webp({ quality: 90 }).toBuffer();
  }
}

/**
 * Experimental fabric-tile pipelines, gated to dev-only preview routes so
 * they can be judged side-by-side against the shipped `generateFlatFabricTile`
 * on the fabric-compare dev page before any of them become production code.
 *
 * These implement the two concrete, stack-appropriate recommendations from
 * the vectorization research report (attached_assets/Vector_Research_*.md):
 *   1. Anchor the flat-field correction to a bright percentile of the
 *      illumination estimate instead of the crop's mean, and use division
 *      (a per-pixel gain map) instead of subtraction — the mean-based
 *      subtract approach in `generateFlatFabricTile` pulls tiles with a
 *      bright highlight + darker surround down to a duller average.
 *   2. Suppress weave/thread texture with a low-pass blur and reduce to a
 *      small no-dither palette, which is the "posterize before vectorizing"
 *      half of the report's recommended pipeline.
 *
 * The report's full pipeline also calls for OpenCV + VTracer (Python) to
 * produce actual traced SVG paths for cutting. That is a different problem
 * (real vector cut-geometry) than what these two tiles solve (a better raster
 * photo tile for the existing SVG `<pattern>` fill), and would require
 * introducing a first Python toolchain into this pure Node/TS monorepo —
 * intentionally not done here without confirming that's actually wanted; see
 * the fabric-compare page notes.
 */

/** Percentile (0-100) of the blurred illumination field used as the target
 * brightness. Higher = anchor to a brighter region (e.g. a highlight) rather
 * than the overall average, which is what keeps a naturally bright fabric
 * from being darkened by flat-fielding. */
const FLAT_FIELD_V2_TARGET_PERCENTILE = 90;

function percentile(values: Uint8Array | Float64Array, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

/** Rec. 601 luma weights, used as a cheap per-pixel luminance proxy for the
 * illumination-field estimate (approximates the report's LAB-L approach
 * without a full colourspace round trip). */
function luminanceOf(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Runs one division-based flat-field pass in place on `sharpBuf`: estimates
 * the illumination field as a Gaussian blur of the current pixels, then
 * divides each pixel by that field's local level (relative to a bright
 * percentile anchor) to cancel slow-varying lighting falloff.
 *
 * A single pass with a single global sigma is a decent approximation, but
 * leaves a faint residual gradient — real vignettes aren't a perfect
 * Gaussian, and the fabric's own low-frequency print/weave pattern leaks a
 * little into the "illumination" estimate. Running this twice (see
 * {@link generateFlatFabricTileV3}) measurably tightens that residual: the
 * second pass targets whatever broad gradient survived the first, since it
 * re-measures the *already-corrected* image rather than compounding blind
 * guesses from the original.
 */
async function applyFlatFieldPass(
  sharpBuf: Buffer,
  info: OutputInfo,
  blurSigma: number,
): Promise<Buffer> {
  const { channels } = info;
  const pixelCount = sharpBuf.length / channels;

  const { data: blurredBuf } = await sharp(sharpBuf, {
    raw: { width: info.width, height: info.height, channels },
  })
    .blur(blurSigma)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const blurredLuma = new Float64Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * channels;
    blurredLuma[i] = luminanceOf(
      blurredBuf[o]!,
      blurredBuf[o + 1]!,
      blurredBuf[o + 2]!,
    );
  }
  const targetLevel = percentile(blurredLuma, FLAT_FIELD_V2_TARGET_PERCENTILE);

  const corrected = Buffer.alloc(sharpBuf.length);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * channels;
    // Clamp the gain so near-black background pixels (division by ~0) don't
    // blow out to pure white.
    const gain = Math.min(2.5, targetLevel / Math.max(blurredLuma[i]!, 16));
    for (let c = 0; c < channels; c++) {
      const value = sharpBuf[o + c]! * gain;
      corrected[o + c] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
  return corrected;
}

async function cropToRawTile(buffer: Buffer) {
  const cropped = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({
      width: FLAT_TILE_SIZE,
      height: FLAT_TILE_SIZE,
      fit: "cover",
      position: "centre",
    })
    .removeAlpha()
    .toColourspace("srgb");

  const { data, info } = await cropped
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

function encodeFlatImage(
  raw: Buffer,
  info: OutputInfo,
  contentType: SupportedImageType,
) {
  const flatImage = sharp(raw, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).modulate({ saturation: 1.15 });

  switch (contentType) {
    case "image/jpeg":
      return flatImage.jpeg({ quality: 90 }).toBuffer();
    case "image/png":
      return flatImage.png().toBuffer();
    case "image/webp":
      return flatImage.webp({ quality: 90 }).toBuffer();
  }
}

/**
 * Flat-field correction v2: division-based gain map anchored to a bright
 * percentile of the blurred luminance, applied per-channel. Unlike
 * {@link generateFlatFabricTile}'s mean-subtract approach, this keeps
 * naturally bright fabrics bright instead of renormalizing to the crop's
 * average brightness.
 */
export async function generateFlatFabricTileV2(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  const { data: sharpBuf, info } = await cropToRawTile(buffer);
  const corrected = await applyFlatFieldPass(
    sharpBuf,
    info,
    FLAT_FIELD_BLUR_SIGMA,
  );
  return encodeFlatImage(corrected, info, contentType);
}

/** Sigma for the second flat-field pass in v3. Deliberately larger than the
 * first pass: the first pass already removed most of the high-amplitude
 * falloff, so the residual left behind is an even slower, broader gradient
 * (the "faint dark edges / light center" look) — a wider blur targets that
 * specifically without re-touching texture-scale detail the first pass
 * already preserved. */
const FLAT_FIELD_V3_SECOND_PASS_SIGMA = FLAT_TILE_SIZE / 2;

/**
 * Flat-field correction v3: same division-based approach as v2, but applied
 * twice. The first pass (v2's original sigma) removes the bulk of the
 * lighting falloff; the second, wider-blur pass re-measures the
 * already-corrected image and mops up the residual broad gradient that a
 * single pass typically leaves behind (faint darker edges, faint lighter
 * center) — see {@link applyFlatFieldPass}.
 */
export async function generateFlatFabricTileV3(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  const { data: sharpBuf, info } = await cropToRawTile(buffer);
  const pass1 = await applyFlatFieldPass(sharpBuf, info, FLAT_FIELD_BLUR_SIGMA);
  const pass2 = await applyFlatFieldPass(
    pass1,
    info,
    FLAT_FIELD_V3_SECOND_PASS_SIGMA,
  );
  return encodeFlatImage(pass2, info, contentType);
}

/** Gaussian sigma used to suppress fine thread/weave texture before
 * posterizing — enough to blur individual threads without erasing a printed
 * motif at this crop size. */
const TEXTURE_SUPPRESS_SIGMA = 2.2;

/** Palette size for the no-dither posterize step, per the report's
 * "3-8 colors, no dithering" recommendation for keeping a future vectorizer's
 * output to a manageable number of regions. */
const POSTERIZE_COLORS = 6;

/**
 * Runs {@link generateFlatFabricTileV2}'s correction, then applies the
 * report's second pipeline stage: a texture-suppressing blur followed by a
 * no-dither palette reduction (posterize). This is the "ready to vectorize"
 * raster — it always returns PNG since palette quantization needs an
 * indexed/paletted output, regardless of the source `contentType`.
 */
export async function generateFabricTilePosterized(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  const flattened = await generateFlatFabricTileV2(buffer, contentType);

  return sharp(flattened)
    .blur(TEXTURE_SUPPRESS_SIGMA)
    .png({ colours: POSTERIZE_COLORS, dither: 0 })
    .toBuffer();
}

/**
 * Same as {@link generateFabricTilePosterized}, but built on the two-pass
 * {@link generateFlatFabricTileV3} correction instead of v2. This is the
 * raster that currently feeds {@link generateFabricTileVectorized} (Direction
 * A) — the tighter flat-field correction reduces the faint residual
 * dark-edge/light-center gradient that fed through into the vectorized SVG's
 * fill regions.
 */
export async function generateFabricTilePosterizedV3(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<Buffer> {
  const flattened = await generateFlatFabricTileV3(buffer, contentType);

  return sharp(flattened)
    .blur(TEXTURE_SUPPRESS_SIGMA)
    .png({ colours: POSTERIZE_COLORS, dither: 0 })
    .toBuffer();
}

/**
 * Direction A of the vectorization research report: runs the posterized
 * "ready to vectorize" raster through VTracer (via the `@neplex/vectorizer`
 * Node/WASM binding — no Python toolchain or API key needed) to produce a
 * real traced SVG with actual vector fill paths, instead of a raster image.
 * The returned SVG string is sized to the same square tile used by the
 * raster pipelines, so it can be dropped into an `<image href>` (as a
 * `data:image/svg+xml` URL or served directly) anywhere a raster tile URL
 * is used today — including tiled inside an SVG `<pattern>`.
 *
 * Built on {@link generateFabricTilePosterizedV3} (the two-pass flat-field
 * correction) — this is the chosen/best-so-far direction, kept as the
 * baseline for further refinement.
 */
export async function generateFabricTileVectorized(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<string> {
  const posterized = await generateFabricTilePosterizedV3(buffer, contentType);

  return vectorize(posterized, {
    colorMode: ColorMode.Color,
    colorPrecision: 6,
    filterSpeckle: 4,
    spliceThreshold: 45,
    cornerThreshold: 60,
    hierarchical: Hierarchical.Stacked,
    mode: PathSimplifyMode.Spline,
    layerDifference: 5,
    lengthThreshold: 5,
    maxIterations: 2,
    pathPrecision: 5,
  });
}

/**
 * Fully tunable version of the Direction A pipeline, parameterized at every
 * stage (flat-field pass count/sigmas, texture-suppression blur, posterize
 * palette size, and every VTracer knob). {@link generateFabricTileVectorized}
 * is equivalent to calling this with {@link DIRECTION_A_BASELINE_TUNING}.
 *
 * Exists so the dev fabric-compare page can render several tuned variants
 * side-by-side against the baseline without duplicating the whole pipeline
 * per variant — see the named presets below for the specific tradeoffs each
 * one explores.
 */
export interface VectorizeTuning {
  /** Sigma for each sequential flat-field division pass. Each additional,
   * wider-sigma pass re-measures the already-corrected image and mops up
   * whatever broad gradient survived the previous pass (see
   * {@link applyFlatFieldPass}) — more passes trade a little processing time
   * for a tighter illumination correction. */
  flatFieldSigmas: number[];
  /** Gaussian sigma suppressing fine thread/weave texture before posterize.
   * Lower preserves more print/weave detail (crisper, but more posterize
   * regions); higher smooths more aggressively (fewer, cleaner regions, but
   * can blur small motifs). */
  textureSuppressSigma: number;
  /** Palette size for the no-dither posterize step. */
  posterizeColors: number;
  colorPrecision: number;
  filterSpeckle: number;
  spliceThreshold: number;
  cornerThreshold: number;
  layerDifference: number;
  lengthThreshold: number;
}

/** Baseline tuning — identical to what {@link generateFabricTileVectorized}
 * has always used (two-pass flat-field, 6-color posterize). */
export const DIRECTION_A_BASELINE_TUNING: VectorizeTuning = {
  flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
  textureSuppressSigma: TEXTURE_SUPPRESS_SIGMA,
  posterizeColors: POSTERIZE_COLORS,
  colorPrecision: 6,
  filterSpeckle: 4,
  spliceThreshold: 45,
  cornerThreshold: 60,
  layerDifference: 5,
  lengthThreshold: 5,
};

/** Variant 1 — "smoother": fewer posterize colors and heavier texture
 * suppression, plus a looser corner threshold / larger layer difference in
 * VTracer, so print/weave grain is flattened into fewer, cleaner regions.
 * Hypothesis: less internal detail per region means less surface area for
 * the residual flat-field gradient to show up as a visible edge inside a
 * region — trades some print fidelity for a cleaner, calmer look. */
export const DIRECTION_A_SMOOTH_TUNING: VectorizeTuning = {
  flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
  textureSuppressSigma: 3.2,
  posterizeColors: 5,
  colorPrecision: 5,
  filterSpeckle: 6,
  spliceThreshold: 45,
  cornerThreshold: 75,
  layerDifference: 8,
  lengthThreshold: 6,
};

/** Variant 2 — "crisp": lighter texture suppression, more posterize colors,
 * higher VTracer color precision, and a tighter speckle filter, so more of
 * the original print/weave detail survives into the traced paths.
 * Hypothesis: since the residual gradient is faint, more colour bands may
 * actually break it up into thinner, less noticeable slices instead of one
 * broad visible band — trades a few more path regions for sharper detail. */
export const DIRECTION_A_CRISP_TUNING: VectorizeTuning = {
  flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
  textureSuppressSigma: 1.4,
  posterizeColors: 8,
  colorPrecision: 7,
  filterSpeckle: 2,
  spliceThreshold: 45,
  cornerThreshold: 50,
  layerDifference: 4,
  lengthThreshold: 4,
};

/** Variant 3 — "3-pass": identical posterize/VTracer settings to the
 * baseline, but adds a third, even-wider-sigma flat-field pass. Each pass
 * re-measures the already-corrected image, so this directly targets
 * whatever broad gradient two passes still leave behind — the most direct
 * attack on the reported "faint dark edges / light center" artifact,
 * independent of posterize/vectorize tuning. */
export const DIRECTION_A_THREE_PASS_TUNING: VectorizeTuning = {
  flatFieldSigmas: [
    FLAT_FIELD_BLUR_SIGMA,
    FLAT_FIELD_V3_SECOND_PASS_SIGMA,
    FLAT_TILE_SIZE * 0.9,
  ],
  textureSuppressSigma: TEXTURE_SUPPRESS_SIGMA,
  posterizeColors: POSTERIZE_COLORS,
  colorPrecision: 6,
  filterSpeckle: 4,
  spliceThreshold: 45,
  cornerThreshold: 60,
  layerDifference: 5,
  lengthThreshold: 5,
};

/** Variant 4 — "ultra-smooth": combines the 3-pass flat-field correction with
 * the "smoother" posterize/VTracer settings, so both levers that attack the
 * residual gradient/texture artifact are stacked at once instead of tested
 * in isolation. Hypothesis: if either lever alone only partially helps, the
 * combination should show a materially larger, more visible improvement —
 * useful as a "how far can we push it" upper bound. */
export const DIRECTION_A_ULTRA_SMOOTH_TUNING: VectorizeTuning = {
  flatFieldSigmas: [
    FLAT_FIELD_BLUR_SIGMA,
    FLAT_FIELD_V3_SECOND_PASS_SIGMA,
    FLAT_TILE_SIZE * 0.9,
  ],
  textureSuppressSigma: 4.5,
  posterizeColors: 4,
  colorPrecision: 4,
  filterSpeckle: 8,
  spliceThreshold: 60,
  cornerThreshold: 90,
  layerDifference: 10,
  lengthThreshold: 8,
};

/** Variant 5 — "max-detail": pushes every lever toward preserving the
 * original print as literally as possible — minimal texture suppression,
 * maximum posterize palette/colour precision, and the tightest speckle/
 * corner/layer settings VTracer supports here. Deliberately the opposite
 * extreme from "ultra-smooth" so the six variants span the full range
 * instead of clustering near the baseline. */
export const DIRECTION_A_MAX_DETAIL_TUNING: VectorizeTuning = {
  flatFieldSigmas: [FLAT_FIELD_BLUR_SIGMA, FLAT_FIELD_V3_SECOND_PASS_SIGMA],
  textureSuppressSigma: 0.6,
  posterizeColors: 12,
  colorPrecision: 8,
  filterSpeckle: 1,
  spliceThreshold: 30,
  cornerThreshold: 35,
  layerDifference: 2,
  lengthThreshold: 3,
};

async function applyTunedFlatField(
  buffer: Buffer,
  sigmas: number[],
): Promise<{ data: Buffer; info: OutputInfo }> {
  const { data: raw, info } = await cropToRawTile(buffer);
  let corrected = raw;
  for (const sigma of sigmas) {
    corrected = await applyFlatFieldPass(corrected, info, sigma);
  }
  return { data: corrected, info };
}

async function generateFabricTilePosterizedTuned(
  buffer: Buffer,
  contentType: SupportedImageType,
  tuning: VectorizeTuning,
): Promise<Buffer> {
  const { data: corrected, info } = await applyTunedFlatField(
    buffer,
    tuning.flatFieldSigmas,
  );
  const flattened = await encodeFlatImage(corrected, info, contentType);

  return sharp(flattened)
    .blur(tuning.textureSuppressSigma)
    .png({ colours: tuning.posterizeColors, dither: 0 })
    .toBuffer();
}

/**
 * Tunable version of {@link generateFabricTileVectorized} — see
 * {@link VectorizeTuning} and the named presets above.
 */
export async function generateFabricTileVectorizedTuned(
  buffer: Buffer,
  contentType: SupportedImageType,
  tuning: VectorizeTuning,
): Promise<string> {
  const posterized = await generateFabricTilePosterizedTuned(
    buffer,
    contentType,
    tuning,
  );

  return vectorize(posterized, {
    colorMode: ColorMode.Color,
    colorPrecision: tuning.colorPrecision,
    filterSpeckle: tuning.filterSpeckle,
    spliceThreshold: tuning.spliceThreshold,
    cornerThreshold: tuning.cornerThreshold,
    hierarchical: Hierarchical.Stacked,
    mode: PathSimplifyMode.Spline,
    layerDifference: tuning.layerDifference,
    lengthThreshold: tuning.lengthThreshold,
    maxIterations: 2,
    pathPrecision: 5,
  });
}

/**
 * THE single enforced production fabric-tile pipeline. After comparing 6
 * Direction A tuning variants on real fabrics (see
 * `artifacts/modules/src/quilting/pages/dev/fabric-compare.tsx`), "Max
 * Detail" (`DIRECTION_A_MAX_DETAIL_TUNING`) was chosen as the production
 * default — it preserves the most print fidelity of the six.
 *
 * Every production surface that renders a fabric tile fill (Block Designer,
 * WQ Designer, Layout preview, SVG export, etc.) consumes this through the
 * `tileImageUrl` field on a fabric, which is always backed by this function
 * (see `GET /fabrics/:id/tile-image` in `routes/quilting/fabrics.ts`). There
 * must be exactly one production tuning — do not call
 * `generateFabricTileVectorizedTuned` directly with a different preset
 * outside of the dev-only comparison page.
 */
export async function generateProductionFabricTile(
  buffer: Buffer,
  contentType: SupportedImageType,
): Promise<string> {
  return generateFabricTileVectorizedTuned(
    buffer,
    contentType,
    DIRECTION_A_MAX_DETAIL_TUNING,
  );
}
