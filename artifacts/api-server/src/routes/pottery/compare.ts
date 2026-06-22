import { Router, type IRouter } from "express";
import multer from "multer";
import { asc, getTableColumns, inArray, sql } from "drizzle-orm";
import { db, potteryItems, potteryImages } from "@workspace/db";
import { ComparePotteryResponse } from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import {
  sniffImageType,
  stripImageMetadata,
  toDataUrl,
} from "../../lib/pottery/image";
import {
  analyzeImage,
  buildEmbeddingText,
  embedText,
  compareWithMatches,
  type CompareMatchInput,
} from "../../lib/pottery/openai";
import { generateVisualEmbedding } from "../../lib/visual-embed";
import { rerankCandidates } from "../../lib/reranker";
import { downloadAndShrinkImageForAi } from "../../lib/pottery/storage";
import { serializeItems } from "../../lib/pottery/serialize";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, fieldSize: 8192 },
});

// How many top candidates (after reranking) go to the GPT vision call. A private
// collection is small enough that 10 strong candidates give the model all the
// signal it needs while bounding per-request image downloads and cost.
const TOP_K = 10;

// Max supplemental angles per collection piece sent to the vision model.
// One extra angle is enough context; more would multiply download cost.
const MAX_EXTRA_IMAGES = 1;

// Wider pools feed the Voyage reranker with more signal; the reranker trims to TOP_K.
const TEXT_SEARCH_POOL = 30;
const VISUAL_SEARCH_POOL = 30;

// Exclude both embedding vectors — heavy and not needed in API responses.
const {
  embedding: _embedding,
  visualEmbedding: _visualEmbedding,
  ...itemColumns
} = getTableColumns(potteryItems);

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (k=60) — blends text and visual ranking lists.
// Pieces appearing in both lists rise higher; textSimilarity from the text lane
// is preserved for the GPT prompt and verdict flooring (more interpretable than
// the RRF score).
// ---------------------------------------------------------------------------
function reciprocalRankFusion(
  textRanked: Array<{ id: number; similarity: number }>,
  visualRanked: Array<{ id: number; similarity: number }>,
  k = 60,
): Array<{ id: number; rrfScore: number; textSimilarity: number }> {
  const scores = new Map<
    number,
    { rrfScore: number; textSimilarity: number }
  >();

  for (const { id, similarity } of textRanked) {
    scores.set(id, { rrfScore: 0, textSimilarity: similarity });
  }
  for (const { id } of visualRanked) {
    if (!scores.has(id)) scores.set(id, { rrfScore: 0, textSimilarity: 0 });
  }
  for (let i = 0; i < textRanked.length; i++) {
    scores.get(textRanked[i].id)!.rrfScore += 1 / (k + i + 1);
  }
  for (let i = 0; i < visualRanked.length; i++) {
    scores.get(visualRanked[i].id)!.rrfScore += 1 / (k + i + 1);
  }

  return Array.from(scores.entries())
    .map(([id, { rrfScore, textSimilarity }]) => ({
      id,
      rrfScore,
      textSimilarity,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, TOP_K);
}

/**
 * Build a plain-text document from a pottery piece's structured attributes —
 * this is what the Voyage reranker scores against the uploaded piece's text.
 */
function buildPotteryDocument(attrs: {
  name: string | null;
  style?: string | null;
  shape?: string | null;
  maker?: string | null;
  patternDescription?: string | null;
  motifs?: unknown;
  dominantColors?: unknown;
  aiDescription?: string | null;
}): string {
  const parts: string[] = [];
  if (attrs.name) parts.push(`Name: ${attrs.name}`);
  if (attrs.style) parts.push(`Style: ${attrs.style}`);
  if (attrs.shape) parts.push(`Shape: ${attrs.shape}`);
  if (attrs.maker) parts.push(`Maker: ${attrs.maker}`);
  if (attrs.patternDescription)
    parts.push(`Pattern: ${attrs.patternDescription}`);
  const motifs = Array.isArray(attrs.motifs) ? (attrs.motifs as string[]) : [];
  if (motifs.length) parts.push(`Motifs: ${motifs.join(", ")}`);
  const colors = Array.isArray(attrs.dominantColors)
    ? (attrs.dominantColors as string[])
    : [];
  if (colors.length) parts.push(`Colours: ${colors.join(", ")}`);
  if (attrs.aiDescription) parts.push(attrs.aiDescription);
  return parts.join(". ") || "Unknown pottery piece";
}

const router: IRouter = Router();
router.use(requireAuth);

router.post("/compare", aiLimiter, upload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "An image file is required." });
    return;
  }
  const contentType = sniffImageType(file.buffer);
  if (!contentType) {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }

  // Strip all embedded metadata (EXIF, GPS, XMP, ICC) before sending the
  // candidate image to the AI — the feature needs pixels, not metadata.
  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
  const dataUrl = toDataUrl(cleanBuffer, contentType);

  // Analyse text + generate the visual embedding in parallel. The visual
  // embedding gracefully returns null when JINA_API_KEY is absent, so the
  // visual lane simply stays empty rather than hard-failing.
  const [analysis, visualEmb] = await Promise.all([
    analyzeImage([dataUrl]),
    generateVisualEmbedding(cleanBuffer),
  ]);
  const embedding = await embedText(buildEmbeddingText(analysis));

  const candidate = {
    patternDescription: analysis.patternDescription,
    style: analysis.style,
    shape: analysis.shape,
    maker: analysis.maker,
    dimensions: analysis.dimensions,
    dominantColors: analysis.dominantColors,
    motifs: analysis.motifs,
  };

  const vectorLiteral = `[${embedding.join(",")}]`;

  // Text vector search (always) + visual vector search (when available) in parallel.
  const [textRanked, visualRanked] = await Promise.all([
    db
      .execute<{ id: number; similarity: number }>(
        sql`
        select id, 1 - (embedding <=> ${vectorLiteral}::vector) as similarity
        from pottery_items
        where embedding is not null
        order by embedding <=> ${vectorLiteral}::vector
        limit ${TEXT_SEARCH_POOL}
      `,
      )
      .then((r) =>
        r.rows.map((row) => ({
          id: Number(row.id),
          similarity: Number(row.similarity),
        })),
      ),
    visualEmb
      ? db
          .execute<{ id: number; similarity: number }>(
            sql`
            select id, 1 - (visual_embedding <=> ${`[${visualEmb.join(",")}]`}::vector) as similarity
            from pottery_items
            where visual_embedding is not null
            order by visual_embedding <=> ${`[${visualEmb.join(",")}]`}::vector
            limit ${VISUAL_SEARCH_POOL}
          `,
          )
          .then((r) =>
            r.rows.map((row) => ({
              id: Number(row.id),
              similarity: Number(row.similarity),
            })),
          )
      : Promise.resolve([] as Array<{ id: number; similarity: number }>),
  ]);

  // Merge via RRF. Falls back to text-only when the visual lane is empty
  // (no JINA_API_KEY or no visual embeddings stored yet).
  const mergedRanking = reciprocalRankFusion(textRanked, visualRanked);

  if (mergedRanking.length === 0) {
    res.json(
      ComparePotteryResponse.parse({
        candidate,
        matches: [],
        summary:
          "Your collection is empty, so there is nothing to compare this against yet. Add some pieces first.",
        ownsSamePattern: "no",
        ownsExactPiece: "no",
      }),
    );
    return;
  }

  const rows = await db
    .select(itemColumns)
    .from(potteryItems)
    .where(
      inArray(
        potteryItems.id,
        mergedRanking.map((r) => r.id),
      ),
    );
  const rowById = new Map(rows.map((row) => [row.id, row]));

  // ── Voyage reranker ────────────────────────────────────────────────────────
  // Re-score all RRF candidates against the uploaded piece's text description.
  // Falls back to the RRF order silently when VOYAGE_API_KEY is absent or the
  // call fails. After reranking, only TOP_K candidates proceed to the vision
  // model — bounding GPT cost and focusing it on the best matches.
  const rerankQuery = buildEmbeddingText(analysis);
  const rerankDocs = mergedRanking.map(({ id }) => {
    const row = rowById.get(id);
    return {
      id,
      text: row ? buildPotteryDocument(row) : "Unknown pottery piece",
    };
  });
  const rerankedIds = await rerankCandidates(rerankQuery, rerankDocs, TOP_K);
  const rerankedRanking = rerankedIds
    .map((id) => mergedRanking.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r != null);

  const similarityById = new Map(
    rerankedRanking.map((r) => [r.id, r.textSimilarity]),
  );

  // Ordered candidate rows, in reranked order.
  const orderedRows = rerankedRanking
    .map((r) => rowById.get(r.id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);
  const ids = orderedRows.map((row) => row.id);

  // Fetch supplemental images for all matched pieces in one query.
  const suppRows = await db
    .select({
      itemId: potteryImages.itemId,
      storagePath: potteryImages.storagePath,
    })
    .from(potteryImages)
    .where(inArray(potteryImages.itemId, ids))
    .orderBy(asc(potteryImages.position));
  const suppByItemId = new Map<number, string[]>();
  for (const s of suppRows) {
    const arr = suppByItemId.get(s.itemId) ?? [];
    arr.push(s.storagePath);
    suppByItemId.set(s.itemId, arr);
  }

  const serialized = await serializeItems(orderedRows);

  // Download primary + supplemental images, shrinking each to at most
  // 1024×1024 JPEG before forwarding to the AI. This bounds per-image memory to
  // roughly 50–300 KB regardless of the original upload size. The full-resolution
  // signed URLs in `serialized` are still returned to the authenticated client;
  // only the AI path uses the shrunk copies.
  const matchDataUrls = await Promise.all(
    orderedRows.map((row) => downloadAndShrinkImageForAi(row.imagePath)),
  );
  const extraDataUrlsByIndex = await Promise.all(
    orderedRows.map((row) =>
      Promise.all(
        (suppByItemId.get(row.id) ?? [])
          .slice(0, MAX_EXTRA_IMAGES)
          .map((p) => downloadAndShrinkImageForAi(p)),
      ),
    ),
  );

  const verdictInputs: CompareMatchInput[] = serialized.map((item, index) => ({
    index,
    imageUrl: matchDataUrls[index] ?? "",
    extraImageUrls: extraDataUrlsByIndex[index] ?? [],
    name: item.name,
    patternDescription: item.patternDescription,
    style: item.style,
    motifs: item.motifs,
    similarity: similarityById.get(item.id) ?? 0,
  }));

  const verdict = await compareWithMatches({
    candidateDataUrl: dataUrl,
    candidate: analysis,
    matches: verdictInputs,
  });

  // Safety net: the text-embedding similarity score measures how close the
  // AI-extracted pattern descriptions are. A high score is strong evidence the
  // patterns match regardless of what the vision model concludes from photos
  // alone (different angles, lighting, etc. can fool it).
  // Floor the per-match verdict up when the embedding strongly disagrees.
  const FLOOR_TO_MAYBE = 0.78; // similarity >= this: "no" → "maybe"
  const FLOOR_TO_YES = 0.9; // similarity >= this: "no"/"maybe" → "yes"

  const matches = serialized.map((item, index) => {
    const sim = similarityById.get(item.id) ?? 0;
    let samePattern = verdict.perMatch[index]?.samePattern ?? "no";
    let exactPiece = verdict.perMatch[index]?.exactPiece ?? "no";
    const explanation = verdict.perMatch[index]?.explanation ?? "";

    if (sim >= FLOOR_TO_YES) {
      if (samePattern === "no" || samePattern === "maybe") samePattern = "yes";
    } else if (sim >= FLOOR_TO_MAYBE) {
      if (samePattern === "no") samePattern = "maybe";
    }
    // exactPiece can't be floored as aggressively — same pattern ≠ same piece.
    if (sim >= FLOOR_TO_YES && exactPiece === "no") exactPiece = "maybe";

    return { item, similarity: sim, samePattern, exactPiece, explanation };
  });

  // Re-derive overall verdicts from the (possibly floored) per-match results
  // rather than trusting the model's top-level aggregation.
  const allPatterns = matches.map((m) => m.samePattern);
  const allPieces = matches.map((m) => m.exactPiece);
  function rollUp(verdicts: string[]): "yes" | "maybe" | "no" {
    if (verdicts.includes("yes")) return "yes";
    if (verdicts.includes("maybe")) return "maybe";
    return "no";
  }
  let ownsSamePattern = rollUp(allPatterns);
  let ownsExactPiece = rollUp(allPieces);
  let summary = verdict.summary;

  // When the new photo yields almost no recognisable detail, the analysis
  // can't be trusted — warn the owner to re-shoot rather than silently
  // returning false negatives.
  const sparseCandidate =
    !analysis.patternDescription &&
    !analysis.style &&
    !analysis.shape &&
    analysis.motifs.length === 0 &&
    analysis.dominantColors.length === 0;

  if (sparseCandidate) {
    if (ownsSamePattern === "no") ownsSamePattern = "maybe";
    if (ownsExactPiece === "no") ownsExactPiece = "maybe";
    summary =
      "I couldn't make out clear details in this photo, so treat this as a rough guess — for a confident answer, upload a sharper, well-lit photo of the piece against a plain background. " +
      summary;
  }

  res.json(
    ComparePotteryResponse.parse({
      candidate,
      matches,
      summary,
      ownsSamePattern,
      ownsExactPiece,
    }),
  );
});

export default router;
