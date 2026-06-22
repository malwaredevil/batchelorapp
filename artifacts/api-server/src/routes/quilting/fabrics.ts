import { Router, type IRouter } from "express";
import multer from "multer";
import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import {
  db,
  fabrics,
  entityCategories,
  quiltingCategories as categories,
  quiltingImages,
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
import { aiLimiter, bulkAiLimiter } from "../../middleware/rateLimit";
import { sniffImageType, stripImageMetadata, toDataUrl } from "../../lib/image";
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

const {
  embedding: _e,
  visualEmbedding: _ve,
  ...fabricColumns
} = getTableColumns(fabrics);

const MAX_NAME = 200;
const MAX_FIELD = 200;
const MAX_NOTES = 4000;
const MAX_LABEL = 100;

// Hard ceiling on how many supplemental images a single fabric may carry.
// Keeps the per-fabric image count bounded so the reanalyze route cannot be
// turned into an unbounded download/encode/AI fan-out by pre-seeding a fabric
// with many supplemental images.
const MAX_SUPPLEMENTAL_IMAGES = 10;

// How many images (primary + supplemental) the reanalyze route may send to the
// vision model in one call. Mirrors the per-fabric slice used in compare.
const MAX_REANALYZE_IMAGES = 5;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12, fieldSize: 8192 },
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
      const [created] = await db
        .insert(categories)
        .values({ name: trimmed })
        .returning({ id: categories.id });
      ids.push(created.id);
    }
  }
  return ids;
}

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

router.get("/fabrics", async (_req, res) => {
  const rows = await db
    .select(fabricColumns)
    .from(fabrics)
    .orderBy(desc(fabrics.createdAt));
  const items = await serializeFabrics(
    rows as Array<Omit<FabricRow, "embedding" | "visualEmbedding">>,
  );
  res.json(ListFabricsResponse.parse(items));
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

  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
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
    generateVisualEmbedding(cleanBuffer),
  ]);

  const quantity = parseFloat(req.body.quantity ?? "1") || 1;
  const quantityUnit = clamp(req.body.quantityUnit, 20) ?? "yards";
  const widthInches = req.body.widthInches
    ? parseFloat(req.body.widthInches) || null
    : null;

  const [row] = (await db
    .insert(fabrics)
    .values({
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
    generateVisualEmbedding(dataUrls[0]),
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

router.post("/fabrics/bulk-reanalyze", bulkAiLimiter, async (req, res) => {
  const { ids } = BulkReanalyzeFabricsBody.parse(req.body);
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
        generateVisualEmbedding(dataUrls[0]),
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
  }

  res.json(BulkReanalyzeFabricsResponse.parse({ succeeded, failed }));
});

// ---------------------------------------------------------------------------
// Supplemental images
// ---------------------------------------------------------------------------

router.post("/fabrics/:id/images", upload.single("image"), async (req, res) => {
  const { id } = AddFabricImageParams.parse(req.params);
  const body = AddFabricImageBody.parse(req.body);

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
  const contentType = sniffImageType(file.buffer);
  if (!contentType) {
    res.status(400).json({ error: "Unsupported image type." });
    return;
  }
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

  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
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
  const [image] = await db
    .select()
    .from(quiltingImages)
    .where(eq(quiltingImages.id, imageId))
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
  const body = UpdateFabricImageBody.parse(req.body);
  const [image] = await db
    .update(quiltingImages)
    .set({
      ...(body.label !== undefined
        ? { label: clamp(body.label, MAX_LABEL) }
        : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
    })
    .where(eq(quiltingImages.id, imageId))
    .returning();
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const { id: fabricId } = UpdateFabricImageParams.parse(req.params);
  res.json({
    id: image.id,
    url: `/api/quilting/fabrics/${fabricId}/images/${image.id}`,
    label: image.label,
    position: image.position,
  });
});

router.delete("/fabrics/:id/images/:imageId", async (req, res) => {
  const { imageId } = DeleteFabricImageParams.parse(req.params);
  const [image] = await db
    .delete(quiltingImages)
    .where(eq(quiltingImages.id, imageId))
    .returning({ storagePath: quiltingImages.storagePath });
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  await deleteImage(image.storagePath);
  res.status(204).end();
});

export default router;
