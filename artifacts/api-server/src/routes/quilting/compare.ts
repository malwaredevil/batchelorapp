import { Router, type IRouter } from "express";
import multer from "multer";
import { getTableColumns, inArray, sql } from "drizzle-orm";
import { db, fabrics, quiltingImages } from "@workspace/db";
import { CompareFabricResponse } from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { compareLimiter } from "../../middleware/rateLimit";
import { sniffImageType, toAiDataUrl } from "../../lib/image";
import {
  analyzeImage,
  buildEmbeddingText,
  embedText,
  compareWithMatches,
  type CompareMatchInput,
} from "../../lib/openai";
import { generateVisualEmbedding } from "../../lib/visual-embed";
import { rerankCandidates, buildFabricDocument } from "../../lib/reranker";
import { downloadImageAsDataUrl } from "../../lib/storage";
import { serializeFabrics } from "../../lib/serialize";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, fieldSize: 8192 },
});

// How many top candidates (after reranking) go to the GPT vision call.
const TOP_K = 10;
const MAX_EXTRA_IMAGES = 2;
// Hard ceiling on how many stored images a single compare request may pull from
// storage and hand to the vision model.
const MAX_AI_IMAGES = 24;
// Wider pools feed the Voyage reranker with more signal; the reranker trims to TOP_K.
const TEXT_SEARCH_POOL = 30;
const VISUAL_SEARCH_POOL = 30;

// Exclude both embedding vectors — heavy and not needed in API responses.
const {
  embedding: _e,
  visualEmbedding: _ve,
  ...fabricColumns
} = getTableColumns(fabrics);

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (k=60) — blends text and visual ranking lists.
// Fabrics appearing in both lists rise higher; textSimilarity from the text
// lane is preserved for the GPT prompt (more interpretable than RRF score).
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

const router: IRouter = Router();
router.use(requireAuth);

router.post(
  "/compare",
  compareLimiter,
  upload.single("image"),
  async (req, res) => {
    const userId = req.session.userId!;
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

    const dataUrl = await toAiDataUrl(file.buffer, contentType);

    // Analyse text + generate visual embedding in parallel.
    // Visual embedding gracefully returns null when JINA_API_KEY is absent.
    const [analysis, visualEmb] = await Promise.all([
      analyzeImage([dataUrl]),
      generateVisualEmbedding(file.buffer),
    ]);
    const embedding = await embedText(buildEmbeddingText(analysis));

    const vectorLiteral = `[${embedding.join(",")}]`;

    // Text vector search + visual vector search, scoped to this user's fabrics only.
    const [textRanked, visualRanked] = await Promise.all([
      db
        .execute<{ id: number; similarity: number }>(
          sql`
          select id, 1 - (embedding <=> ${vectorLiteral}::vector) as similarity
          from ${fabrics}
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
              from ${fabrics}
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
    // (no JINA_API_KEY or no visual embeddings yet stored).
    const mergedRanking = reciprocalRankFusion(textRanked, visualRanked);

    if (mergedRanking.length === 0) {
      res.json(
        CompareFabricResponse.parse({
          summary:
            "Your collection is empty — there are no fabrics to compare against yet.",
          ownsSamePattern: "no",
          ownsExactFabric: "no",
          matches: [],
        }),
      );
      return;
    }

    const fabricRows = await db
      .select(fabricColumns)
      .from(fabrics)
      .where(
        inArray(
          fabrics.id,
          mergedRanking.map((r) => r.id),
        ),
      );

    // ── Voyage reranker ────────────────────────────────────────────────────────
    const fabricRowById = new Map(fabricRows.map((r) => [r.id, r]));
    const rerankQuery = buildEmbeddingText(analysis);
    const rerankDocs = mergedRanking.map(({ id }) => {
      const row = fabricRowById.get(id);
      return {
        id,
        text: row ? buildFabricDocument(row) : "Unknown fabric",
      };
    });
    const rerankedIds = await rerankCandidates(rerankQuery, rerankDocs, TOP_K);
    const rerankedRanking = rerankedIds
      .map((id) => mergedRanking.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r != null);

    const similarityById = new Map(
      rerankedRanking.map((r) => [r.id, r.textSimilarity]),
    );

    const supplementalByFabricId = new Map<number, string[]>();
    const allImages = await db
      .select({
        entityId: quiltingImages.entityId,
        storagePath: quiltingImages.storagePath,
        position: quiltingImages.position,
      })
      .from(quiltingImages)
      .where(
        sql`entity_type = 'fabric' AND entity_id = ANY(${sql`ARRAY[${sql.join(
          rerankedRanking.map((r) => sql`${r.id}`),
          sql`, `,
        )}]::int[]`})`,
      )
      .orderBy(quiltingImages.entityId, quiltingImages.position);

    for (const img of allImages) {
      const list = supplementalByFabricId.get(img.entityId) ?? [];
      if (list.length < MAX_EXTRA_IMAGES) list.push(img.storagePath);
      supplementalByFabricId.set(img.entityId, list);
    }

    const matchInputs: CompareMatchInput[] = [];

    let imageBudget = MAX_AI_IMAGES;
    for (const { id } of rerankedRanking) {
      if (imageBudget <= 0) break;
      const fabric = fabricRowById.get(id);
      if (!fabric) continue;

      let primaryDataUrl: string;
      try {
        primaryDataUrl = await downloadImageAsDataUrl(fabric.imagePath);
      } catch (err) {
        req.log.warn(
          { err, fabricId: id },
          "compare: skipping fabric, primary image unavailable",
        );
        continue;
      }
      imageBudget -= 1;

      const extraPaths = (supplementalByFabricId.get(id) ?? []).slice(
        0,
        Math.max(0, imageBudget),
      );
      const extraDataUrls: string[] = [];
      for (const extraPath of extraPaths) {
        try {
          extraDataUrls.push(await downloadImageAsDataUrl(extraPath));
          imageBudget -= 1;
        } catch (err) {
          req.log.warn(
            { err, fabricId: id },
            "compare: skipping unavailable supplemental image",
          );
        }
      }

      matchInputs.push({
        index: id,
        imageUrl: primaryDataUrl,
        extraImageUrls: extraDataUrls,
        name: fabric.name,
        lineName: fabric.lineName ?? null,
        designer: fabric.designer ?? null,
        printType: fabric.printType ?? null,
        motifs: (fabric.motifs as string[]) ?? [],
        dominantColors: (fabric.dominantColors as string[]) ?? [],
        similarity: similarityById.get(id) ?? 0,
      });
    }

    const verdict = await compareWithMatches({
      candidateDataUrl: dataUrl,
      candidate: analysis,
      matches: matchInputs,
    });

    const serializedFabrics = await serializeFabrics(fabricRows);
    const serializedById = new Map(serializedFabrics.map((f) => [f.id, f]));

    const matchResults = rerankedRanking
      .map(({ id, textSimilarity }) => {
        const matchVerdict = verdict.perMatch[id];
        const fabric = serializedById.get(id);
        if (!matchVerdict || !fabric) return null;
        return {
          fabric,
          similarity: textSimilarity,
          samePattern: matchVerdict.samePattern,
          exactFabric: matchVerdict.exactFabric,
          explanation: matchVerdict.explanation,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Conservative downgrade: if the photo was too unclear to analyse well,
    // soften any "no" to "maybe" to avoid false negatives.
    let ownsSamePattern = verdict.ownsSamePattern;
    let ownsExactFabric = verdict.ownsExactFabric;
    const hasUnclearAnalysis =
      analysis.dominantColors.length === 0 &&
      analysis.motifs.length === 0 &&
      !analysis.printType;
    if (hasUnclearAnalysis && ownsSamePattern === "no")
      ownsSamePattern = "maybe";
    if (hasUnclearAnalysis && ownsExactFabric === "no")
      ownsExactFabric = "maybe";

    res.json(
      CompareFabricResponse.parse({
        summary: verdict.summary,
        ownsSamePattern,
        ownsExactFabric,
        matches: matchResults,
      }),
    );
  },
);

export default router;
