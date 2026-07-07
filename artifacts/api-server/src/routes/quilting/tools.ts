import { Router, type IRouter } from "express";
import multer from "multer";
import { desc, getTableColumns } from "drizzle-orm";
import { db, fabrics, type FabricRow } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { sniffImageType, stripImageMetadata, toDataUrl } from "../../lib/image";
import { callModel, MODELS } from "../../lib/ai-client";
import { serializeFabrics } from "../../lib/serialize";

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

const { embedding: _e, visualEmbedding: _ve, ...fabricColumns } =
  getTableColumns(fabrics);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const router: IRouter = Router();
router.use(requireAuth);

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
    const contentType = sniffImageType(file.buffer);
    if (!contentType) {
      res
        .status(400)
        .json({ error: "Unsupported image. Please upload a JPEG, PNG or WEBP." });
      return;
    }

    const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
    const dataUrl = toDataUrl(cleanBuffer, contentType);

    // Ask the vision model to identify dominant colours from our fixed palette
    const completion = await callModel(
      MODELS.FAST_VISION,
      async (client, model) => {
        return client.chat.completions.create({
          model,
          max_tokens: 200,
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
      const raw = JSON.parse(
        completion.choices[0]?.message?.content ?? "{}",
      ) as { colors?: unknown };
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
      res
        .status(422)
        .json({ error: "Could not extract a colour palette from this image." });
      return;
    }

    // Load all fabrics (no embeddings needed)
    const allRows = await db
      .select(fabricColumns)
      .from(fabrics)
      .orderBy(desc(fabrics.createdAt));

    const extractedSet = new Set(extractedColors);

    // Score each fabric by Jaccard similarity of colour sets
    const scored = allRows
      .map((row) => {
        const fabricColors = new Set(
          ((row.dominantColors as string[]) ?? []).map((c) =>
            c.toLowerCase().trim(),
          ),
        );
        const intersection = [...extractedSet].filter((c) =>
          fabricColors.has(c),
        );
        const union = new Set([...extractedSet, ...fabricColors]);
        const score = union.size === 0 ? 0 : intersection.length / union.size;
        return { row, score, matchedColors: intersection };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

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

export default router;
