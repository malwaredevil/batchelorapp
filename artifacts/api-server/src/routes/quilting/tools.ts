import { Router, type IRouter } from "express";
import multer from "multer";
import { DEFAULT_MULTER_FILE_BYTES } from "../../middleware/uploadSizeGuard";
import { desc, getTableColumns } from "drizzle-orm";
import {
  db,
  fabrics,
  quiltPatterns,
  finishedQuilts,
  type FabricRow,
  type QuiltPatternRow,
  type FinishedQuiltRow,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { toDataUrl } from "../../lib/image";
import {
  createImageFileFilter,
  sniffAndValidateMime,
  isImageMimeType,
  stripMetadata,
} from "@workspace/upload-validation";
import { getConfig } from "../../lib/app-config";
import { callModel, MODELS } from "../../lib/ai-client";
import {
  serializeFabrics,
  serializePatterns,
  serializeQuilts,
} from "../../lib/serialize";

/**
 * Canonical CSS color names used by the quilting fabric analyser.
 * Must stay in sync with the ANALYSIS_PROMPT in openai.ts and the
 * palette referenced by colorToHex in lib/web-core/src/colors.ts.
 */
const PALETTE_NAMES = new Set([
  "white",
  "cream",
  "ivory",
  "beige",
  "tan",
  "brown",
  "dark brown",
  "gold",
  "yellow",
  "orange",
  "red",
  "burgundy",
  "pink",
  "lavender",
  "purple",
  "light blue",
  "sky blue",
  "blue",
  "cobalt blue",
  "navy",
  "teal",
  "turquoise",
  "green",
  "sage",
  "olive",
  "grey",
  "charcoal",
  "black",
]);

const PALETTE_LIST = [...PALETTE_NAMES].join(", ");

const {
  embedding: _e,
  visualEmbedding: _ve,
  ...fabricColumns
} = getTableColumns(fabrics);

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DEFAULT_MULTER_FILE_BYTES, files: 1 },
  fileFilter: createImageFileFilter(ALLOWED_IMAGE_TYPES),
});

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Shared helper: extract a 5–7 colour palette from an uploaded inspiration
// image using the vision model, constrained to PALETTE_NAMES.
// ---------------------------------------------------------------------------

async function extractPaletteFromUpload(
  file: Express.Multer.File,
): Promise<{ error: string; status: number } | { extractedColors: string[] }> {
  let sniffedType: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
  } catch {
    return {
      error: "Unsupported image. Please upload a JPEG, PNG or WEBP.",
      status: 400,
    };
  }
  if (!isImageMimeType(sniffedType)) {
    return {
      error: "Unsupported image. Please upload a JPEG, PNG or WEBP.",
      status: 400,
    };
  }
  const contentType = sniffedType;

  const cleanBuffer = await stripMetadata(file.buffer, contentType);
  const dataUrl = toDataUrl(cleanBuffer, contentType);

  const completion = await callModel(
    MODELS.FAST_VISION,
    async (client, model) => {
      return client.chat.completions.create({
        model,
        max_tokens: await getConfig(
          "quilting",
          "color_suggestion_max_tokens",
          200,
        ),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
              {
                type: "text",
                text: `Identify the 5 to 7 most dominant colours in this image. Use ONLY names from this fixed list: ${PALETTE_LIST}. Pick the closest match for each colour you see. Return STRICT JSON only: {"colors":["name1","name2","name3",...]}`,
              },
            ],
          },
        ],
      });
    },
  );

  let extractedColors: string[] = [];
  try {
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      colors?: unknown;
    };
    if (Array.isArray(raw.colors)) {
      extractedColors = (raw.colors as unknown[])
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.toLowerCase().trim())
        .filter((c) => PALETTE_NAMES.has(c))
        .slice(0, 7);
    }
  } catch {
    // fall through
  }

  if (extractedColors.length === 0) {
    return {
      error: "Could not extract a colour palette from this image.",
      status: 422,
    };
  }

  return { extractedColors };
}

/** Score a set of rows (each with a `dominantColors` array) against an extracted palette. */
function scoreByDominantColors<T extends { dominantColors: unknown }>(
  rows: T[],
  extractedColors: string[],
  limit: number,
): Array<{ row: T; score: number; matchedColors: string[] }> {
  const extractedSet = new Set(extractedColors);
  return rows
    .map((row) => {
      const rowColors = new Set(
        ((row.dominantColors as string[]) ?? []).map((c) =>
          c.toLowerCase().trim(),
        ),
      );
      const intersection = [...extractedSet].filter((c) => rowColors.has(c));
      const union = new Set([...extractedSet, ...rowColors]);
      const score = union.size === 0 ? 0 : intersection.length / union.size;
      return { row, score, matchedColors: intersection };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// POST /quilting/tools/palette-match
//
// Accept an inspiration image, ask the vision model to extract 5–7 dominant
// colours from our fixed CSS palette, then score all stash fabrics by
// Jaccard similarity of their `dominantColors` against the extracted set.
// Returns top-10 matches with per-match score and matched colour names.
// ---------------------------------------------------------------------------

router.post(
  "/tools/palette-match",
  aiLimiter,
  upload.single("image"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "An image file is required." });
      return;
    }

    const extraction = await extractPaletteFromUpload(file);
    if ("error" in extraction) {
      res.status(extraction.status).json({ error: extraction.error });
      return;
    }
    const { extractedColors } = extraction;

    // Load all fabrics (no embeddings needed)
    const allRows = await db
      .select(fabricColumns)
      .from(fabrics)
      .orderBy(desc(fabrics.createdAt));

    const scored = scoreByDominantColors(allRows, extractedColors, 10);

    const serialized = await serializeFabrics(
      scored.map((s) => s.row) as Array<
        Omit<FabricRow, "embedding" | "visualEmbedding">
      >,
    );

    const matches = scored.map((s, i) => ({
      fabric: serialized[i],
      score: parseFloat(s.score.toFixed(3)),
      matchedColors: s.matchedColors,
    }));

    res.json({ extractedColors, matches });
  },
);

// ---------------------------------------------------------------------------
// POST /quilting/tools/palette-match-patterns
//
// Same extraction/scoring approach as palette-match, but scores against
// quilt patterns' `dominantColors` instead of fabrics.
// ---------------------------------------------------------------------------

router.post(
  "/tools/palette-match-patterns",
  aiLimiter,
  upload.single("image"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "An image file is required." });
      return;
    }

    const extraction = await extractPaletteFromUpload(file);
    if ("error" in extraction) {
      res.status(extraction.status).json({ error: extraction.error });
      return;
    }
    const { extractedColors } = extraction;

    const allRows = await db
      .select()
      .from(quiltPatterns)
      .orderBy(desc(quiltPatterns.createdAt));

    const scored = scoreByDominantColors(allRows, extractedColors, 10);

    const serialized = await serializePatterns(
      scored.map((s) => s.row) as QuiltPatternRow[],
    );

    const matches = scored.map((s, i) => ({
      pattern: serialized[i],
      score: parseFloat(s.score.toFixed(3)),
      matchedColors: s.matchedColors,
    }));

    res.json({ extractedColors, matches });
  },
);

// ---------------------------------------------------------------------------
// POST /quilting/tools/palette-match-quilts
//
// Same extraction/scoring approach as palette-match, but scores against
// finished quilts' `dominantColors` instead of fabrics.
// ---------------------------------------------------------------------------

router.post(
  "/tools/palette-match-quilts",
  aiLimiter,
  upload.single("image"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "An image file is required." });
      return;
    }

    const extraction = await extractPaletteFromUpload(file);
    if ("error" in extraction) {
      res.status(extraction.status).json({ error: extraction.error });
      return;
    }
    const { extractedColors } = extraction;

    const allRows = await db
      .select()
      .from(finishedQuilts)
      .orderBy(desc(finishedQuilts.createdAt));

    const scored = scoreByDominantColors(allRows, extractedColors, 10);

    const serialized = await serializeQuilts(
      scored.map((s) => s.row) as FinishedQuiltRow[],
    );

    const matches = scored.map((s, i) => ({
      quilt: serialized[i],
      score: parseFloat(s.score.toFixed(3)),
      matchedColors: s.matchedColors,
    }));

    res.json({ extractedColors, matches });
  },
);

export default router;
