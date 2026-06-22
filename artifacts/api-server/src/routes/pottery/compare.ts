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
import { downloadAndShrinkImageForAi } from "../../lib/pottery/storage";
import { serializeItems } from "../../lib/pottery/serialize";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, fieldSize: 8192 },
});

// Candidate cap for the vector similarity search.  Keeping this small limits
// the number of images downloaded and forwarded to OpenAI in one request,
// which bounds per-request memory use.  A private collection is small enough
// that 10 strong candidates gives the model all the signal it needs.
const TOP_K = 10;

// Max supplemental angles per collection piece sent to the vision model.
// One extra angle is enough context; more would multiply download cost.
const MAX_EXTRA_IMAGES = 1;

const { embedding: _embedding, ...itemColumns } = getTableColumns(potteryItems);

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
  // candidate image to OpenAI — the AI feature needs pixels, not metadata.
  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
  const dataUrl = toDataUrl(cleanBuffer, contentType);
  const analysis = await analyzeImage([dataUrl]);
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
  const ranked = await db.execute<{ id: number; similarity: number }>(sql`
    select id, 1 - (embedding <=> ${vectorLiteral}::vector) as similarity
    from pottery_items
    where embedding is not null
    order by embedding <=> ${vectorLiteral}::vector
    limit ${TOP_K}
  `);

  const rankedRows = ranked.rows.map((r) => ({
    id: Number(r.id),
    similarity: Number(r.similarity),
  }));

  if (rankedRows.length === 0) {
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

  const ids = rankedRows.map((r) => r.id);
  const similarityById = new Map(rankedRows.map((r) => [r.id, r.similarity]));

  const rows = await db
    .select(itemColumns)
    .from(potteryItems)
    .where(inArray(potteryItems.id, ids));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = ids
    .map((id) => rowById.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);

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
  // 1024×1024 JPEG before forwarding to OpenAI.  This bounds per-image memory
  // to roughly 50–300 KB regardless of the original upload size, so a
  // worst-case request (TOP_K items × (1 primary + MAX_EXTRA_IMAGES
  // supplemental)) stays well within safe memory limits.
  // The full-resolution signed URLs in `serialized` are still returned to the
  // authenticated client; only the AI path uses the shrunk copies.
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

  // Safety net: the embedding similarity score measures how close the
  // AI-extracted pattern descriptions are. A high score is strong evidence
  // the patterns match regardless of what the vision model concludes from
  // photos alone (different angles, lighting, etc. can fool it).
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
