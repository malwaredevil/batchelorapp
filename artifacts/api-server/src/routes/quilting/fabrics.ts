import { Router, type IRouter } from "express";
import multer from "multer";
import { DEFAULT_MULTER_FILE_BYTES } from "../../middleware/uploadSizeGuard";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  sql,
} from "drizzle-orm";
import {
  db,
  fabrics,
  entityCategories,
  quiltingCategories as categories,
  quiltingImages,
  quiltFabricLinks,
  type FabricRow,
} from "@workspace/db";
import {
  GetFabricParams,
  GetFabricResponse,
  UpdateFabricParams,
  UpdateFabricBody,
  UpdateFabricResponse,
  DeleteFabricParams,
  GetFabricImageParams,
  ReanalyzeFabricParams,
  ReanalyzeFabricResponse,
  BulkReanalyzeFabricsBody,
  BulkReanalyzeFabricsResponse,
  AddFabricImageParams,
  AddFabricImageBody,
  UpdateFabricImageParams,
  UpdateFabricImageBody,
  DeleteFabricImageParams,
  ListFabricsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { env } from "../../lib/env";
import { aiLimiter, bulkAiLimiter } from "../../middleware/rateLimit";
import {
  toDataUrl,
  generateFlatFabricTile,
  generateFlatFabricTileV2,
  generateFabricTilePosterized,
  generateFabricTileVectorized,
  generateFabricTileVectorizedTuned,
  generateProductionFabricTile,
  getCachedProductionFabricTile,
  DIRECTION_A_SMOOTH_TUNING,
  DIRECTION_A_CRISP_TUNING,
  DIRECTION_A_THREE_PASS_TUNING,
  DIRECTION_A_ULTRA_SMOOTH_TUNING,
  DIRECTION_A_MAX_DETAIL_TUNING,
} from "../../lib/image";
import {
  createImageFileFilter,
  sniffImageType,
  sniffAndValidateMime,
  isImageMimeType,
  stripMetadata,
} from "@workspace/upload-validation";
import {
  uploadImage,
  deleteImage,
  downloadImageBuffer,
  downloadImageAsDataUrl,
} from "../../lib/storage";
import {
  analyzeImage,
  buildEmbeddingText,
  embedText,
  type AnalysisContext,
} from "../../lib/openai";
import { generateVisualEmbedding } from "../../lib/visual-embed";
import { serializeFabric, serializeFabrics } from "../../lib/serialize";
import {
  semanticCollectionSearch,
  buildFabricSearchDocument,
} from "../../lib/collection-search";

const {
  embedding: _e,
  visualEmbedding: _ve,
  ...fabricColumns
} = getTableColumns(fabrics);

const MAX_NAME = 200;
const MAX_FIELD = 200;
const MAX_NOTES = 4000;
const MAX_LABEL = 100;

const MAX_SUPPLEMENTAL_IMAGES = 10;
const MAX_REANALYZE_IMAGES = 5;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DEFAULT_MULTER_FILE_BYTES,
    files: 1,
    fields: 12,
    fieldSize: 8192,
  },
  fileFilter: createImageFileFilter(ALLOWED_IMAGE_TYPES),
});

function clamp(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

/** Resolve category names → IDs, creating shared household categories as needed. */
async function resolveOrCreateCategories(names: string[]): Promise<number[]> {
  if (names.length === 0) return [];
  const ids: number[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, trimmed))
      .limit(1);
    if (existing) {
      ids.push(existing.id);
    } else {
      try {
        const [created] = await db
          .insert(categories)
          .values({ name: trimmed })
          .returning({ id: categories.id });
        if (created) ids.push(created.id);
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        // Created concurrently by another request — look it up.
        const [race] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.name, trimmed))
          .limit(1);
        if (race) ids.push(race.id);
      }
    }
  }
  return ids;
}

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Dev-only: flat-field tile preview for the fabric-compare comparison page.
// Reads a single bundled fixture image, never user-controlled input. Mounted
// before requireAuth because it's loaded via a raw SVG <image> element (no
// custom-fetch header attached), and hard-disabled outside development.
// ---------------------------------------------------------------------------
router.get("/dev/fabric-tile-preview", async (_req, res) => {
  if (env.isProduction) {
    res.status(404).end();
    return;
  }
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const fixturePath = path.resolve(
    __dirname,
    "dev-assets/fabric-compare-source.jpg",
  );
  const buffer = await readFile(fixturePath);
  const tile = await generateFlatFabricTile(buffer, "image/jpeg");
  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "no-store");
  res.end(tile);
});

// ---------------------------------------------------------------------------
// Dev-only: experimental flat-field v2 (percentile/division-anchored) tile,
// per the vectorization research report. Same fixture/gating as above.
// ---------------------------------------------------------------------------
router.get("/dev/fabric-tile-experiment-v2", async (_req, res) => {
  if (env.isProduction) {
    res.status(404).end();
    return;
  }
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const fixturePath = path.resolve(
    __dirname,
    "dev-assets/fabric-compare-source.jpg",
  );
  const buffer = await readFile(fixturePath);
  const tile = await generateFlatFabricTileV2(buffer, "image/jpeg");
  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "no-store");
  res.end(tile);
});

// ---------------------------------------------------------------------------
// Dev-only: experimental posterized/quantized tile (flat-field v2 + texture
// suppression + no-dither palette reduction), the "ready to vectorize" raster
// stage from the research report. Same fixture/gating as above.
// ---------------------------------------------------------------------------
router.get("/dev/fabric-tile-experiment-posterized", async (_req, res) => {
  if (env.isProduction) {
    res.status(404).end();
    return;
  }
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const fixturePath = path.resolve(
    __dirname,
    "dev-assets/fabric-compare-source.jpg",
  );
  const buffer = await readFile(fixturePath);
  const tile = await generateFabricTilePosterized(buffer, "image/jpeg");
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store");
  res.end(tile);
});

// ---------------------------------------------------------------------------
// Dev-only: VTracer-vectorized tile (Direction A from the vectorization
// research report). Traces the posterized raster into a real SVG with vector
// fill paths via `@neplex/vectorizer` (Node/WASM VTracer binding, no API key
// or Python toolchain needed). Same fixture/gating as the raster variants.
// ---------------------------------------------------------------------------
router.get("/dev/fabric-tile-experiment-vectorized", async (_req, res) => {
  if (env.isProduction) {
    res.status(404).end();
    return;
  }
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const fixturePath = path.resolve(
    __dirname,
    "dev-assets/fabric-compare-source.jpg",
  );
  const buffer = await readFile(fixturePath);
  const svg = await generateFabricTileVectorized(buffer, "image/jpeg");
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "no-store");
  res.end(svg);
});

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Dev-only: same tile experiments as above, but sourced from a real stored
// fabric's own photo instead of the bundled fixture — used by the HST
// comparison section on the fabric-compare dev page to test a second,
// contrasting-color fabric. Requires auth (real household data), unlike the
// fixture-based routes above which read a static bundled asset.
// ---------------------------------------------------------------------------
router.get(
  "/dev/fabric-tile-experiment/:fabricId/:method",
  async (req, res) => {
    if (env.isProduction) {
      res.status(404).end();
      return;
    }
    const fabricId = Number(req.params["fabricId"]);
    const method = String(req.params["method"]);
    if (!Number.isInteger(fabricId) || fabricId <= 0) {
      res.status(400).json({ error: "Invalid fabricId" });
      return;
    }
    const [row] = await db
      .select({ imagePath: fabrics.imagePath })
      .from(fabrics)
      .where(eq(fabrics.id, fabricId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Fabric not found" });
      return;
    }
    const { buffer, contentType: rawContentType } = await downloadImageBuffer(
      row.imagePath,
    );
    const contentType = sniffImageType(buffer) ?? "image/jpeg";

    switch (method) {
      case "original": {
        res.set("Content-Type", rawContentType);
        res.set("Cache-Control", "no-store");
        res.end(buffer);
        return;
      }
      case "v2": {
        const tile = await generateFlatFabricTileV2(buffer, contentType);
        res.set("Content-Type", contentType);
        res.set("Cache-Control", "no-store");
        res.end(tile);
        return;
      }
      case "posterized": {
        const tile = await generateFabricTilePosterized(buffer, contentType);
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "no-store");
        res.end(tile);
        return;
      }
      case "vectorized": {
        const svg = await generateFabricTileVectorized(buffer, contentType);
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        res.end(svg);
        return;
      }
      case "vectorized-smooth": {
        const svg = await generateFabricTileVectorizedTuned(
          buffer,
          contentType,
          DIRECTION_A_SMOOTH_TUNING,
        );
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        res.end(svg);
        return;
      }
      case "vectorized-crisp": {
        const svg = await generateFabricTileVectorizedTuned(
          buffer,
          contentType,
          DIRECTION_A_CRISP_TUNING,
        );
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        res.end(svg);
        return;
      }
      case "vectorized-3pass": {
        const svg = await generateFabricTileVectorizedTuned(
          buffer,
          contentType,
          DIRECTION_A_THREE_PASS_TUNING,
        );
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        res.end(svg);
        return;
      }
      case "vectorized-ultra-smooth": {
        const svg = await generateFabricTileVectorizedTuned(
          buffer,
          contentType,
          DIRECTION_A_ULTRA_SMOOTH_TUNING,
        );
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        res.end(svg);
        return;
      }
      case "vectorized-max-detail": {
        const svg = await generateFabricTileVectorizedTuned(
          buffer,
          contentType,
          DIRECTION_A_MAX_DETAIL_TUNING,
        );
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        res.end(svg);
        return;
      }
      default:
        res.status(400).json({ error: "Invalid method" });
    }
  },
);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

router.get("/fabrics", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10) || 50),
  );
  const offset = (page - 1) * pageSize;

  // When a text query is provided, try hybrid semantic search first.
  // Falls back to ILIKE when embeddings are unavailable or the result is empty.
  if (q) {
    try {
      const rankedIds = await semanticCollectionSearch({
        query: q,
        table: fabrics,
        textEmbeddingCol: "embedding",
        visualEmbeddingCol: "visual_embedding",
        db,
        fetchDocuments: async (ids) => {
          const rows = await db
            .select(fabricColumns)
            .from(fabrics)
            .where(inArray(fabrics.id, ids));
          return rows.map((r) => ({
            id: r.id,
            text: buildFabricSearchDocument(
              r as Parameters<typeof buildFabricSearchDocument>[0],
            ),
          }));
        },
      });

      if (rankedIds.length > 0) {
        const total = rankedIds.length;
        const pageIds = rankedIds.slice(offset, offset + pageSize);

        if (pageIds.length === 0) {
          res.json(
            ListFabricsResponse.parse({ items: [], total, page, pageSize }),
          );
          return;
        }

        const pageRows = await db
          .select(fabricColumns)
          .from(fabrics)
          .where(inArray(fabrics.id, pageIds));
        const byId = new Map(pageRows.map((r) => [r.id, r]));
        const orderedRows = pageIds
          .filter((id) => byId.has(id))
          .map((id) => byId.get(id)!);
        const items = await serializeFabrics(
          orderedRows as Array<
            Omit<FabricRow, "embedding" | "visualEmbedding">
          >,
        );
        res.json(ListFabricsResponse.parse({ items, total, page, pageSize }));
        return;
      }
    } catch {
      // Semantic search unavailable — fall through to ILIKE.
    }
  }

  const where = q ? ilike(fabrics.name, `%${q}%`) : undefined;

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(fabrics)
    .where(where);

  const rows = await db
    .select(fabricColumns)
    .from(fabrics)
    .where(where)
    .orderBy(desc(fabrics.createdAt))
    .limit(pageSize)
    .offset(offset);

  const items = await serializeFabrics(
    rows as Array<Omit<FabricRow, "embedding" | "visualEmbedding">>,
  );
  res.json(ListFabricsResponse.parse({ items, total, page, pageSize }));
});

// ---------------------------------------------------------------------------
// Used fabric IDs (must appear before /:id to avoid being caught by that param)
// ---------------------------------------------------------------------------

router.get("/fabrics/used-ids", async (_req, res) => {
  const rows = await db
    .selectDistinct({ fabricId: quiltFabricLinks.fabricId })
    .from(quiltFabricLinks);
  res.json(rows.map((r) => r.fabricId));
});

// ---------------------------------------------------------------------------
// Fabric pairings — find 4 stash fabrics that pair well by embedding similarity
// ---------------------------------------------------------------------------

router.get("/fabrics/:id/pairings", async (req, res) => {
  const { id } = GetFabricParams.parse(req.params);

  // Load the target fabric's embeddings
  const [target] = await db
    .select()
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);

  if (!target) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  type RankedRow = { id: number; similarity: number };

  // Cosine similarity search on text embedding
  let textRanked: RankedRow[] = [];
  if (target.embedding) {
    const vec = `[${(target.embedding as number[]).join(",")}]`;
    const rows = await db.execute<RankedRow>(sql`
      select id, 1 - (embedding <=> ${vec}::vector) as similarity
      from quilting_fabrics
      where embedding is not null and id != ${id}
      order by embedding <=> ${vec}::vector
      limit 20
    `);
    textRanked = rows.rows.map((r) => ({
      id: Number(r.id),
      similarity: Number(r.similarity),
    }));
  }

  // Cosine similarity search on visual embedding
  let visualRanked: RankedRow[] = [];
  if (target.visualEmbedding) {
    const vec = `[${(target.visualEmbedding as number[]).join(",")}]`;
    const rows = await db.execute<RankedRow>(sql`
      select id, 1 - (visual_embedding <=> ${vec}::vector) as similarity
      from quilting_fabrics
      where visual_embedding is not null and id != ${id}
      order by visual_embedding <=> ${vec}::vector
      limit 20
    `);
    visualRanked = rows.rows.map((r) => ({
      id: Number(r.id),
      similarity: Number(r.similarity),
    }));
  }

  // Reciprocal Rank Fusion (k=60) to merge the two ranked lists
  const scores = new Map<number, number>();
  textRanked.forEach(({ id: fid }, rank) => {
    scores.set(fid, (scores.get(fid) ?? 0) + 1 / (60 + rank + 1));
  });
  visualRanked.forEach(({ id: fid }, rank) => {
    scores.set(fid, (scores.get(fid) ?? 0) + 1 / (60 + rank + 1));
  });

  // Pick the top 4 by RRF score
  const topIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([fid]) => fid);

  if (topIds.length === 0) {
    res.json([]);
    return;
  }

  const {
    embedding: _emb,
    visualEmbedding: _vemb,
    ...cols
  } = getTableColumns(fabrics);
  const rows = await db
    .select(cols)
    .from(fabrics)
    .where(inArray(fabrics.id, topIds));
  const serialized = await Promise.all(
    rows.map((r) =>
      serializeFabric(r as Omit<FabricRow, "embedding" | "visualEmbedding">),
    ),
  );

  // Return in the same order as topIds
  const byId = new Map(serialized.map((f) => [f.id, f]));
  res.json(topIds.map((fid) => byId.get(fid)).filter(Boolean));
});

// ---------------------------------------------------------------------------
// Get one
// ---------------------------------------------------------------------------

router.get("/fabrics/:id", async (req, res) => {
  const { id } = GetFabricParams.parse(req.params);
  const [row] = await db
    .select(fabricColumns)
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }
  res.json(
    GetFabricResponse.parse(
      await serializeFabric(
        row as Omit<FabricRow, "embedding" | "visualEmbedding">,
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// Create (with AI cataloguing)
// ---------------------------------------------------------------------------

router.post("/fabrics", aiLimiter, upload.single("image"), async (req, res) => {
  const userId = req.session.userId!;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "An image file is required." });
    return;
  }
  let sniffedType: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
  } catch {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }
  if (!isImageMimeType(sniffedType)) {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }
  const contentType = sniffedType;
  const cleanBuffer = await stripMetadata(file.buffer, contentType);
  const dataUrl = toDataUrl(cleanBuffer, contentType);

  const context: AnalysisContext | undefined = (() => {
    const name = clamp(req.body.name, MAX_NAME);
    const lineName = clamp(req.body.lineName, MAX_FIELD);
    const designer = clamp(req.body.designer, MAX_FIELD);
    const manufacturer = clamp(req.body.manufacturer, MAX_FIELD);
    if (!name && !lineName && !designer && !manufacturer) return undefined;
    return { lockedFields: [], name, lineName, designer, manufacturer };
  })();

  const analysis = await analyzeImage([dataUrl], context);
  const embeddingText = buildEmbeddingText(analysis);
  const [embedding, imagePath, visualEmb] = await Promise.all([
    embedText(embeddingText),
    uploadImage(cleanBuffer, contentType),
    generateVisualEmbedding(cleanBuffer).catch(() => null),
  ]);

  const quantity = parseFloat(req.body.quantity ?? "1") || 1;
  const quantityUnit = clamp(req.body.quantityUnit, 20) ?? "yards";
  const widthInches = req.body.widthInches
    ? parseFloat(req.body.widthInches) || null
    : null;

  const [row] = (await db
    .insert(fabrics)
    .values({
      userId,
      name: clamp(req.body.name, MAX_NAME) ?? analysis.name,
      lineName: analysis.lineName,
      designer: analysis.designer,
      manufacturer: analysis.manufacturer,
      colorway: analysis.colorway,
      printType: analysis.printType,
      fiberContent: analysis.fiberContent,
      widthInches,
      quantity,
      quantityUnit,
      sku: clamp(req.body.sku, MAX_FIELD),
      notes: clamp(req.body.notes, MAX_NOTES),
      aiDescription: analysis.aiDescription,
      dominantColors: analysis.dominantColors,
      motifs: analysis.motifs,
      styleDescriptors: analysis.styleDescriptors,
      acquiredAt: clamp(req.body.acquiredAt, 50),
      lockedFields: [],
      imagePath,
      embedding: sql`${`[${embedding.join(",")}]`}::vector`,
      visualEmbedding: visualEmb
        ? sql`${`[${visualEmb.join(",")}]`}::vector`
        : null,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .returning(fabricColumns as any)) as unknown as Array<
    Omit<FabricRow, "embedding" | "visualEmbedding">
  >;

  const categoryNames = parseStringArray(req.body.categories);
  if (categoryNames.length > 0) {
    const catIds = await resolveOrCreateCategories(categoryNames);
    if (catIds.length > 0) {
      await db
        .insert(entityCategories)
        .values(
          catIds.map((cid) => ({
            entityType: "fabric" as const,
            entityId: row.id,
            categoryId: cid,
          })),
        )
        .onConflictDoNothing();
    }
  }

  const serialized = await serializeFabric(row);
  res.status(201).json(serialized);
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

router.patch("/fabrics/:id", async (req, res) => {
  const { id } = UpdateFabricParams.parse(req.params);
  const body = UpdateFabricBody.parse(req.body);

  const [existing] = await db
    .select({ id: fabrics.id })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const updates: Partial<typeof fabrics.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.slice(0, MAX_NAME);
  if (body.lineName !== undefined) updates.lineName = body.lineName;
  if (body.designer !== undefined) updates.designer = body.designer;
  if (body.manufacturer !== undefined) updates.manufacturer = body.manufacturer;
  if (body.colorway !== undefined) updates.colorway = body.colorway;
  if (body.printType !== undefined) updates.printType = body.printType;
  if (body.fiberContent !== undefined) updates.fiberContent = body.fiberContent;
  if (body.widthInches !== undefined) updates.widthInches = body.widthInches;
  if (body.quantity !== undefined) updates.quantity = body.quantity;
  if (body.quantityUnit !== undefined) updates.quantityUnit = body.quantityUnit;
  if (body.sku !== undefined) updates.sku = body.sku;
  if (body.notes !== undefined)
    updates.notes = body.notes?.slice(0, MAX_NOTES) ?? null;
  if (body.acquiredAt !== undefined) updates.acquiredAt = body.acquiredAt;
  if (body.dominantColors !== undefined)
    updates.dominantColors = body.dominantColors;
  if (body.motifs !== undefined) updates.motifs = body.motifs;
  if (body.lockedFields !== undefined) updates.lockedFields = body.lockedFields;

  if (Object.keys(updates).length > 0) {
    await db.update(fabrics).set(updates).where(eq(fabrics.id, id));
  }

  if (body.categories !== undefined) {
    await db
      .delete(entityCategories)
      .where(sql`entity_type = 'fabric' AND entity_id = ${id}`);
    const catIds = await resolveOrCreateCategories(body.categories);
    if (catIds.length > 0) {
      await db
        .insert(entityCategories)
        .values(
          catIds.map((cid) => ({
            entityType: "fabric" as const,
            entityId: id,
            categoryId: cid,
          })),
        )
        .onConflictDoNothing();
    }
  }

  const [row] = await db
    .select(fabricColumns)
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  res.json(
    UpdateFabricResponse.parse(
      await serializeFabric(
        row as Omit<FabricRow, "embedding" | "visualEmbedding">,
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

router.delete("/fabrics/:id", async (req, res) => {
  const { id } = DeleteFabricParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: fabrics.imagePath })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const supplementalImages = await db
    .select({ storagePath: quiltingImages.storagePath })
    .from(quiltingImages)
    .where(sql`entity_type = 'fabric' AND entity_id = ${id}`);

  await db.delete(fabrics).where(eq(fabrics.id, id));
  await Promise.allSettled([
    deleteImage(row.imagePath),
    ...supplementalImages.map((img) => deleteImage(img.storagePath)),
  ]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Primary image (proxied)
// ---------------------------------------------------------------------------

router.get("/fabrics/:id/image", async (req, res) => {
  const { id } = GetFabricImageParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: fabrics.imagePath })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(row.imagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.end(buffer);
});

router.get("/fabrics/:id/tile-image", async (req, res) => {
  const { id } = GetFabricImageParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: fabrics.imagePath })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }
  const svg = await getCachedProductionFabricTile(
    row.imagePath,
    downloadImageBuffer,
  );
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "private, max-age=86400");
  res.end(svg);
});

// ---------------------------------------------------------------------------
// GET /fabrics/:id/tile-image.png — rasterized PNG version of the SVG tile.
// The browser caches this for 1 year (immutable). Use this instead of the
// SVG endpoint wherever the tile fills a <pattern> inside an SVG canvas,
// because a raster PNG is a single GPU texture (zero per-path layout cost),
// while an inlined SVG pattern expands into thousands of DOM path nodes at
// scale and causes scroll/zoom jank in the block designer and layout composer.
// ---------------------------------------------------------------------------
// Simple in-memory LRU-style cache: keyed by "imagePath:size".
// Each 1024×1024 PNG is ~200–500 kB; cap at 100 entries (~30 MB worst case).
const _pngCache = new Map<string, Buffer>();
const PNG_CACHE_MAX = 100;
function pngCacheGet(key: string): Buffer | undefined {
  return _pngCache.get(key);
}
function pngCacheSet(key: string, buf: Buffer): void {
  if (_pngCache.size >= PNG_CACHE_MAX) {
    const oldest = _pngCache.keys().next().value;
    if (oldest) _pngCache.delete(oldest);
  }
  _pngCache.set(key, buf);
}

router.get("/fabrics/:id/tile-image.png", async (req, res) => {
  const { id } = GetFabricImageParams.parse(req.params);
  const [row] = await db
    .select({ imagePath: fabrics.imagePath })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const sizeRaw = parseInt(String(req.query.size ?? "1024"), 10);
  const size = Number.isFinite(sizeRaw)
    ? Math.min(2048, Math.max(128, sizeRaw))
    : 1024;

  const cacheKey = `${row.imagePath}:${size}`;
  const cached = pngCacheGet(cacheKey);
  if (cached) {
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.end(cached);
    return;
  }

  const svg = await getCachedProductionFabricTile(
    row.imagePath,
    downloadImageBuffer,
  );

  const { default: sharp } = await import("sharp");
  const png = await sharp(Buffer.from(svg), { density: Math.round(size / 3) })
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 8 })
    .toBuffer();

  pngCacheSet(cacheKey, png);
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.end(png);
});

// ---------------------------------------------------------------------------
// Re-analyze with AI
// ---------------------------------------------------------------------------

router.post("/fabrics/:id/reanalyze", aiLimiter, async (req, res) => {
  const { id } = ReanalyzeFabricParams.parse(req.params);
  const [row] = await db
    .select()
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const supplementalPaths = await db
    .select({
      storagePath: quiltingImages.storagePath,
      position: quiltingImages.position,
    })
    .from(quiltingImages)
    .where(sql`entity_type = 'fabric' AND entity_id = ${id}`)
    .orderBy(quiltingImages.position);

  const allPaths = [
    row.imagePath,
    ...supplementalPaths.map((i) => i.storagePath),
  ].slice(0, MAX_REANALYZE_IMAGES);
  const settled = await Promise.allSettled(
    allPaths.map(downloadImageAsDataUrl),
  );
  const dataUrls = settled
    .filter(
      (s): s is PromiseFulfilledResult<string> => s.status === "fulfilled",
    )
    .map((s) => s.value);
  if (dataUrls.length === 0) {
    res
      .status(422)
      .json({ error: "Could not load any image for this fabric." });
    return;
  }

  const lockedFields = (row.lockedFields as string[]) ?? [];
  const context: AnalysisContext = {
    lockedFields,
    name: row.name,
    lineName: row.lineName,
    designer: row.designer,
    manufacturer: row.manufacturer,
    colorway: row.colorway,
    printType: row.printType,
    fiberContent: row.fiberContent,
    dominantColors: row.dominantColors,
    motifs: row.motifs,
    styleDescriptors: row.styleDescriptors,
  };

  const [analysis, visualEmb] = await Promise.all([
    analyzeImage(dataUrls, context),
    generateVisualEmbedding(dataUrls[0]).catch(() => null),
  ]);
  const embeddingText = buildEmbeddingText(analysis);
  const embedding = await embedText(embeddingText);

  await db
    .update(fabrics)
    .set({
      ...(lockedFields.includes("name") ? {} : { name: analysis.name }),
      ...(lockedFields.includes("lineName")
        ? {}
        : { lineName: analysis.lineName }),
      ...(lockedFields.includes("designer")
        ? {}
        : { designer: analysis.designer }),
      ...(lockedFields.includes("manufacturer")
        ? {}
        : { manufacturer: analysis.manufacturer }),
      ...(lockedFields.includes("colorway")
        ? {}
        : { colorway: analysis.colorway }),
      ...(lockedFields.includes("printType")
        ? {}
        : { printType: analysis.printType }),
      ...(lockedFields.includes("fiberContent")
        ? {}
        : { fiberContent: analysis.fiberContent }),
      aiDescription: analysis.aiDescription,
      ...(lockedFields.includes("dominantColors")
        ? {}
        : { dominantColors: analysis.dominantColors }),
      ...(lockedFields.includes("motifs") ? {} : { motifs: analysis.motifs }),
      ...(lockedFields.includes("styleDescriptors")
        ? {}
        : { styleDescriptors: analysis.styleDescriptors }),
      embedding: sql`${`[${embedding.join(",")}]`}::vector`,
      ...(visualEmb
        ? { visualEmbedding: sql`${`[${visualEmb.join(",")}]`}::vector` }
        : {}),
    })
    .where(eq(fabrics.id, id));

  const [updated] = await db
    .select(fabricColumns)
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  res.json(
    ReanalyzeFabricResponse.parse(
      await serializeFabric(
        updated as Omit<FabricRow, "embedding" | "visualEmbedding">,
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// Bulk re-analyze with AI
// ---------------------------------------------------------------------------

const MAX_BULK_REANALYZE = 20;

/** Re-run AI analysis on a batch of fabrics. Shared by the REST route and
 * Elaine's bulk_reanalyze_quilting action. */
export async function bulkReanalyzeFabrics(
  ids: number[],
): Promise<{ succeeded: number[]; failed: number[] }> {
  const capped = [...new Set(ids)].slice(0, MAX_BULK_REANALYZE);
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (const id of capped) {
    try {
      const [row] = await db
        .select()
        .from(fabrics)
        .where(eq(fabrics.id, id))
        .limit(1);
      if (!row) {
        failed.push(id);
        continue;
      }

      const supplementalPaths = await db
        .select({ storagePath: quiltingImages.storagePath })
        .from(quiltingImages)
        .where(sql`entity_type = 'fabric' AND entity_id = ${id}`)
        .orderBy(quiltingImages.position);

      const allPaths = [
        row.imagePath,
        ...supplementalPaths.map((i) => i.storagePath),
      ].slice(0, MAX_REANALYZE_IMAGES);
      const settled = await Promise.allSettled(
        allPaths.map(downloadImageAsDataUrl),
      );
      const dataUrls = settled
        .filter(
          (s): s is PromiseFulfilledResult<string> => s.status === "fulfilled",
        )
        .map((s) => s.value);
      if (dataUrls.length === 0) {
        failed.push(id);
        continue;
      }

      const lockedFields = (row.lockedFields as string[]) ?? [];
      const context: AnalysisContext = {
        lockedFields,
        name: row.name,
        lineName: row.lineName,
        designer: row.designer,
        manufacturer: row.manufacturer,
        colorway: row.colorway,
        printType: row.printType,
        fiberContent: row.fiberContent,
        dominantColors: row.dominantColors,
        motifs: row.motifs,
        styleDescriptors: row.styleDescriptors,
      };
      const [analysis, visualEmb] = await Promise.all([
        analyzeImage(dataUrls, context),
        generateVisualEmbedding(dataUrls[0]).catch(() => null),
      ]);
      const embedding = await embedText(buildEmbeddingText(analysis));
      await db
        .update(fabrics)
        .set({
          ...(lockedFields.includes("name") ? {} : { name: analysis.name }),
          ...(lockedFields.includes("lineName")
            ? {}
            : { lineName: analysis.lineName }),
          ...(lockedFields.includes("designer")
            ? {}
            : { designer: analysis.designer }),
          ...(lockedFields.includes("manufacturer")
            ? {}
            : { manufacturer: analysis.manufacturer }),
          ...(lockedFields.includes("colorway")
            ? {}
            : { colorway: analysis.colorway }),
          ...(lockedFields.includes("printType")
            ? {}
            : { printType: analysis.printType }),
          ...(lockedFields.includes("fiberContent")
            ? {}
            : { fiberContent: analysis.fiberContent }),
          aiDescription: analysis.aiDescription,
          ...(lockedFields.includes("dominantColors")
            ? {}
            : { dominantColors: analysis.dominantColors }),
          ...(lockedFields.includes("motifs")
            ? {}
            : { motifs: analysis.motifs }),
          ...(lockedFields.includes("styleDescriptors")
            ? {}
            : { styleDescriptors: analysis.styleDescriptors }),
          embedding: sql`${`[${embedding.join(",")}]`}::vector`,
          ...(visualEmb
            ? {
                visualEmbedding: sql`${`[${visualEmb.join(",")}]`}::vector`,
              }
            : {}),
        })
        .where(eq(fabrics.id, id));
      succeeded.push(id);
    } catch {
      failed.push(id);
    }
    if (capped.indexOf(id) < capped.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return { succeeded, failed };
}

router.post("/fabrics/bulk-reanalyze", bulkAiLimiter, async (req, res) => {
  const { ids } = BulkReanalyzeFabricsBody.parse(req.body);
  const { succeeded, failed } = await bulkReanalyzeFabrics(ids);
  res.json(BulkReanalyzeFabricsResponse.parse({ succeeded, failed }));
});

// ---------------------------------------------------------------------------
// Supplemental images
// ---------------------------------------------------------------------------

router.post("/fabrics/:id/images", upload.single("image"), async (req, res) => {
  const { id } = AddFabricImageParams.parse(req.params);
  const body = AddFabricImageBody.parse(req.body);

  // Verify the fabric exists before adding a supplemental image
  const [fabric] = await db
    .select({ id: fabrics.id })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!fabric) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "An image file is required." });
    return;
  }
  let sniffedType: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
  } catch {
    res.status(400).json({ error: "Unsupported image type." });
    return;
  }
  if (!isImageMimeType(sniffedType)) {
    res.status(400).json({ error: "Unsupported image type." });
    return;
  }
  const contentType = sniffedType;
  const cleanBuffer = await stripMetadata(file.buffer, contentType);
  const existing = await db
    .select({ position: quiltingImages.position })
    .from(quiltingImages)
    .where(sql`entity_type = 'fabric' AND entity_id = ${id}`)
    .orderBy(quiltingImages.position);
  if (existing.length >= MAX_SUPPLEMENTAL_IMAGES) {
    res.status(422).json({
      error: `A fabric may have at most ${MAX_SUPPLEMENTAL_IMAGES} supplemental images.`,
    });
    return;
  }
  const nextPosition = (existing[existing.length - 1]?.position ?? 0) + 1;

  const storagePath = await uploadImage(cleanBuffer, contentType);

  const [image] = await db
    .insert(quiltingImages)
    .values({
      entityType: "fabric",
      entityId: id,
      storagePath,
      label: clamp(body.label, MAX_LABEL),
      position: nextPosition,
    })
    .returning();

  res.status(201).json({
    id: image.id,
    url: `/api/quilting/fabrics/${id}/images/${image.id}`,
    label: image.label,
    position: image.position,
  });
});

router.get("/fabrics/:id/images/:imageId", async (req, res) => {
  const { imageId } = UpdateFabricImageParams.parse(req.params);
  const { id } = GetFabricImageParams.parse(req.params);

  // Verify the fabric exists before serving the image
  const [fabric] = await db
    .select({ id: fabrics.id })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!fabric) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const [image] = await db
    .select()
    .from(quiltingImages)
    .where(
      sql`${quiltingImages.id} = ${imageId} AND entity_type = 'fabric' AND entity_id = ${id}`,
    )
    .limit(1);
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(image.storagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.end(buffer);
});

router.patch("/fabrics/:id/images/:imageId", async (req, res) => {
  const { imageId } = UpdateFabricImageParams.parse(req.params);
  const { id } = UpdateFabricParams.parse(req.params);
  const body = UpdateFabricImageBody.parse(req.body);

  // Verify the fabric exists before modifying the supplemental image
  const [fabric] = await db
    .select({ id: fabrics.id })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!fabric) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const [image] = await db
    .update(quiltingImages)
    .set({
      ...(body.label !== undefined
        ? { label: clamp(body.label, MAX_LABEL) }
        : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
    })
    .where(
      sql`${quiltingImages.id} = ${imageId} AND entity_type = 'fabric' AND entity_id = ${id}`,
    )
    .returning();
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  res.json({
    id: image.id,
    url: `/api/quilting/fabrics/${id}/images/${image.id}`,
    label: image.label,
    position: image.position,
  });
});

router.delete("/fabrics/:id/images/:imageId", async (req, res) => {
  const { imageId } = DeleteFabricImageParams.parse(req.params);
  const { id } = DeleteFabricParams.parse(req.params);

  // Verify the fabric exists before deleting the image
  const [fabric] = await db
    .select({ id: fabrics.id })
    .from(fabrics)
    .where(eq(fabrics.id, id))
    .limit(1);
  if (!fabric) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const [image] = await db
    .delete(quiltingImages)
    .where(
      sql`${quiltingImages.id} = ${imageId} AND entity_type = 'fabric' AND entity_id = ${id}`,
    )
    .returning({ storagePath: quiltingImages.storagePath });
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  await deleteImage(image.storagePath);
  res.status(204).end();
});

export default router;
