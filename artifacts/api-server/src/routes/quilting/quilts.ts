import { Router, type IRouter } from "express";
import multer from "multer";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  finishedQuilts,
  entityCategories,
  quiltingCategories as categories,
  quiltingImages,
  quiltFabricLinks,
  quiltPatternLinks,
  fabrics,
  quiltPatterns,
  type FinishedQuiltRow,
} from "@workspace/db";
import {
  ListQuiltsResponse,
  GetQuiltParams,
  GetQuiltResponse,
  UpdateQuiltParams,
  UpdateQuiltBody,
  UpdateQuiltResponse,
  DeleteQuiltParams,
  GetQuiltImageParams,
  ReanalyzeQuiltParams,
  ReanalyzeQuiltResponse,
  BulkReanalyzeQuiltsBody,
  BulkReanalyzeQuiltsResponse,
  AddQuiltImageParams,
  AddQuiltImageBody,
  UpdateQuiltImageParams,
  UpdateQuiltImageBody,
  DeleteQuiltImageParams,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter, bulkAiLimiter } from "../../middleware/rateLimit";
import { sniffImageType, stripImageMetadata } from "../../lib/image";
import {
  uploadImage,
  deleteImage,
  downloadImageBuffer,
  downloadImageAsDataUrl,
} from "../../lib/storage";
import { analyzeQuiltImage } from "../../lib/openai";
import { serializeQuilt, serializeQuilts } from "../../lib/serialize";

const MAX_NAME = 200;
const MAX_NOTES = 4000;
const MAX_LABEL = 100;
const MAX_CATEGORIES = 50;
const MAX_CATEGORY_NAME = 100;

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

function parseIntArray(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => !isNaN(n));
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.map(Number).filter((n) => !isNaN(n));
    } catch {
      return raw
        .split(",")
        .map((s) => parseInt(s.trim()))
        .filter((n) => !isNaN(n));
    }
  }
  return [];
}

/**
 * Filter a list of fabric IDs to those actually owned by userId.
 * Prevents horizontal privilege escalation via linked-fabric insertion.
 */
async function filterOwnedFabricIds(
  ids: number[],
  userId: number,
): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: fabrics.id })
    .from(fabrics)
    .where(and(inArray(fabrics.id, ids), eq(fabrics.userId, userId)));
  return rows.map((r) => r.id);
}

/**
 * Filter a list of pattern IDs to those actually owned by userId.
 */
async function filterOwnedPatternIds(
  ids: number[],
  userId: number,
): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: quiltPatterns.id })
    .from(quiltPatterns)
    .where(
      and(inArray(quiltPatterns.id, ids), eq(quiltPatterns.userId, userId)),
    );
  return rows.map((r) => r.id);
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

/**
 * Resolve category names → IDs for a specific user, creating per-user
 * categories as needed. Names already taken globally by another user are
 * silently skipped.
 */
async function resolveOrCreateCategories(
  names: string[],
  userId: number,
): Promise<number[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, MAX_CATEGORY_NAME);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length >= MAX_CATEGORIES) break;
  }
  if (unique.length === 0) return [];

  // One batched lookup for names that already exist for this user
  const existing = await db
    .select({ name: categories.name, id: categories.id })
    .from(categories)
    .where(
      and(inArray(categories.name, unique), eq(categories.userId, userId)),
    );
  const existingNames = new Set(existing.map((c) => c.name));
  const existingIds = existing.map((c) => c.id);

  // Insert missing names for this user
  const missing = unique.filter((n) => !existingNames.has(n));
  if (missing.length > 0) {
    try {
      await db
        .insert(categories)
        .values(missing.map((name) => ({ name, userId })))
        .onConflictDoNothing();
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
    }
  }

  // Final batched lookup
  const all = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(inArray(categories.name, unique), eq(categories.userId, userId)),
    );
  return [...new Set([...existingIds, ...all.map((c) => c.id)])];
}

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

router.get("/quilts", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(finishedQuilts)
    .where(eq(finishedQuilts.userId, userId))
    .orderBy(desc(finishedQuilts.createdAt));
  const items = await serializeQuilts(rows);
  res.json(ListQuiltsResponse.parse(items));
});

// ---------------------------------------------------------------------------
// Get one
// ---------------------------------------------------------------------------

router.get("/quilts/:id", async (req, res) => {
  const { id } = GetQuiltParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .select()
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Quilt not found." });
    return;
  }
  res.json(GetQuiltResponse.parse(await serializeQuilt(row)));
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

router.post("/quilts", upload.single("image"), async (req, res) => {
  const userId = req.session.userId!;
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

  const name = clamp(req.body.name, MAX_NAME);
  if (!name) {
    res.status(400).json({ error: "Quilt name is required." });
    return;
  }

  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
  const imagePath = await uploadImage(cleanBuffer, contentType);

  const sizeWidth = req.body.sizeWidth
    ? parseFloat(req.body.sizeWidth) || null
    : null;
  const sizeHeight = req.body.sizeHeight
    ? parseFloat(req.body.sizeHeight) || null
    : null;

  const [row] = await db
    .insert(finishedQuilts)
    .values({
      userId,
      name,
      dateCompleted: clamp(req.body.dateCompleted, 20),
      sizeWidth,
      sizeHeight,
      recipient: clamp(req.body.recipient, 200),
      notes: clamp(req.body.notes, MAX_NOTES),
      imagePath,
    })
    .returning();

  const categoryNames = parseStringArray(req.body.categories);
  const rawLinkedFabricIds = parseIntArray(req.body.linkedFabricIds);
  const rawLinkedPatternIds = parseIntArray(req.body.linkedPatternIds);

  // Validate ownership of linked entities before inserting links — prevents
  // horizontal privilege escalation via arbitrary IDs in the request body.
  const [linkedFabricIds, linkedPatternIds] = await Promise.all([
    filterOwnedFabricIds(rawLinkedFabricIds, userId),
    filterOwnedPatternIds(rawLinkedPatternIds, userId),
  ]);

  const categoryTask = async () => {
    if (categoryNames.length > 0) {
      const catIds = await resolveOrCreateCategories(categoryNames, userId);
      if (catIds.length > 0) {
        await db
          .insert(entityCategories)
          .values(
            catIds.map((cid) => ({
              entityType: "quilt" as const,
              entityId: row.id,
              categoryId: cid,
            })),
          )
          .onConflictDoNothing();
      }
    }
  };

  await Promise.all([
    categoryTask(),
    linkedFabricIds.length > 0
      ? db
          .insert(quiltFabricLinks)
          .values(
            linkedFabricIds.map((fid) => ({ quiltId: row.id, fabricId: fid })),
          )
          .onConflictDoNothing()
      : Promise.resolve(),
    linkedPatternIds.length > 0
      ? db
          .insert(quiltPatternLinks)
          .values(
            linkedPatternIds.map((pid) => ({
              quiltId: row.id,
              patternId: pid,
            })),
          )
          .onConflictDoNothing()
      : Promise.resolve(),
  ]);

  res.status(201).json(await serializeQuilt(row));
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

router.patch("/quilts/:id", async (req, res) => {
  const { id } = UpdateQuiltParams.parse(req.params);
  const userId = req.session.userId!;
  const body = UpdateQuiltBody.parse(req.body);

  const [existing] = await db
    .select({ id: finishedQuilts.id })
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Quilt not found." });
    return;
  }

  const updates: Partial<typeof finishedQuilts.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.slice(0, MAX_NAME);
  if (body.dateCompleted !== undefined)
    updates.dateCompleted = body.dateCompleted;
  if (body.sizeWidth !== undefined) updates.sizeWidth = body.sizeWidth;
  if (body.sizeHeight !== undefined) updates.sizeHeight = body.sizeHeight;
  if (body.recipient !== undefined) updates.recipient = body.recipient;
  if (body.notes !== undefined)
    updates.notes = body.notes?.slice(0, MAX_NOTES) ?? null;
  if (body.lockedFields !== undefined) updates.lockedFields = body.lockedFields;

  if (Object.keys(updates).length > 0) {
    await db
      .update(finishedQuilts)
      .set(updates)
      .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)));
  }

  if (body.categories !== undefined) {
    await db
      .delete(entityCategories)
      .where(sql`entity_type = 'quilt' AND entity_id = ${id}`);
    const catIds = await resolveOrCreateCategories(body.categories, userId);
    if (catIds.length > 0) {
      await db
        .insert(entityCategories)
        .values(
          catIds.map((cid) => ({
            entityType: "quilt" as const,
            entityId: id,
            categoryId: cid,
          })),
        )
        .onConflictDoNothing();
    }
  }

  if (body.linkedFabricIds !== undefined) {
    await db.delete(quiltFabricLinks).where(eq(quiltFabricLinks.quiltId, id));
    const ownedFabricIds = await filterOwnedFabricIds(
      body.linkedFabricIds,
      userId,
    );
    if (ownedFabricIds.length > 0) {
      await db
        .insert(quiltFabricLinks)
        .values(ownedFabricIds.map((fid) => ({ quiltId: id, fabricId: fid })))
        .onConflictDoNothing();
    }
  }

  if (body.linkedPatternIds !== undefined) {
    await db.delete(quiltPatternLinks).where(eq(quiltPatternLinks.quiltId, id));
    const ownedPatternIds = await filterOwnedPatternIds(
      body.linkedPatternIds,
      userId,
    );
    if (ownedPatternIds.length > 0) {
      await db
        .insert(quiltPatternLinks)
        .values(ownedPatternIds.map((pid) => ({ quiltId: id, patternId: pid })))
        .onConflictDoNothing();
    }
  }

  const [updated] = await db
    .select()
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  res.json(UpdateQuiltResponse.parse(await serializeQuilt(updated)));
});

// ---------------------------------------------------------------------------
// Re-analyze with AI
// ---------------------------------------------------------------------------

const MAX_REANALYZE_IMAGES = 5;
const MAX_BULK_REANALYZE = 20;

router.post("/quilts/:id/reanalyze", aiLimiter, async (req, res) => {
  const { id } = ReanalyzeQuiltParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .select()
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Quilt not found." });
    return;
  }

  const supplementalPaths = await db
    .select({
      storagePath: quiltingImages.storagePath,
      position: quiltingImages.position,
    })
    .from(quiltingImages)
    .where(sql`entity_type = 'quilt' AND entity_id = ${id}`)
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
    res.status(422).json({ error: "Could not load any image for this quilt." });
    return;
  }

  const lockedFields = (row.lockedFields as string[]) ?? [];
  const analysis = await analyzeQuiltImage(dataUrls, lockedFields, {
    name: row.name,
  });

  await db
    .update(finishedQuilts)
    .set({
      ...(lockedFields.includes("name") ? {} : { name: analysis.name }),
      ...(lockedFields.includes("notes") ? {} : { notes: analysis.notes }),
    })
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)));

  const [updated] = await db
    .select()
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  res.json(ReanalyzeQuiltResponse.parse(await serializeQuilt(updated)));
});

router.post("/quilts/bulk-reanalyze", bulkAiLimiter, async (req, res) => {
  const { ids } = BulkReanalyzeQuiltsBody.parse(req.body);
  const userId = req.session.userId!;
  const capped = [...new Set(ids)].slice(0, MAX_BULK_REANALYZE);
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (const id of capped) {
    try {
      const [row] = await db
        .select()
        .from(finishedQuilts)
        .where(
          and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)),
        )
        .limit(1);
      if (!row) {
        failed.push(id);
        continue;
      }

      const supplementalPaths = await db
        .select({ storagePath: quiltingImages.storagePath })
        .from(quiltingImages)
        .where(sql`entity_type = 'quilt' AND entity_id = ${id}`)
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
      const analysis = await analyzeQuiltImage(dataUrls, lockedFields, {
        name: row.name,
      });
      await db
        .update(finishedQuilts)
        .set({
          ...(lockedFields.includes("name") ? {} : { name: analysis.name }),
          ...(lockedFields.includes("notes") ? {} : { notes: analysis.notes }),
        })
        .where(
          and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)),
        );
      succeeded.push(id);
    } catch {
      failed.push(id);
    }
  }

  res.json(BulkReanalyzeQuiltsResponse.parse({ succeeded, failed }));
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

router.delete("/quilts/:id", async (req, res) => {
  const { id } = DeleteQuiltParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .select({ imagePath: finishedQuilts.imagePath })
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Quilt not found." });
    return;
  }

  const supplementalImages = await db
    .select({ storagePath: quiltingImages.storagePath })
    .from(quiltingImages)
    .where(sql`entity_type = 'quilt' AND entity_id = ${id}`);

  await db
    .delete(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)));
  await Promise.allSettled([
    deleteImage(row.imagePath),
    ...supplementalImages.map((img) => deleteImage(img.storagePath)),
  ]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Primary image
// ---------------------------------------------------------------------------

router.get("/quilts/:id/image", async (req, res) => {
  const { id } = GetQuiltImageParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .select({ imagePath: finishedQuilts.imagePath })
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Quilt not found." });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(row.imagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=3600");
  res.end(buffer);
});

// ---------------------------------------------------------------------------
// Supplemental images
// ---------------------------------------------------------------------------

router.post("/quilts/:id/images", upload.single("image"), async (req, res) => {
  const { id } = AddQuiltImageParams.parse(req.params);
  const userId = req.session.userId!;
  const body = AddQuiltImageBody.parse(req.body);

  // Verify quilt ownership
  const [quilt] = await db
    .select({ id: finishedQuilts.id })
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!quilt) {
    res.status(404).json({ error: "Quilt not found." });
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
  const cleanBuffer = await stripImageMetadata(file.buffer, contentType);
  const storagePath = await uploadImage(cleanBuffer, contentType);

  const existing = await db
    .select({ position: quiltingImages.position })
    .from(quiltingImages)
    .where(sql`entity_type = 'quilt' AND entity_id = ${id}`)
    .orderBy(quiltingImages.position);
  const nextPosition = (existing[existing.length - 1]?.position ?? 0) + 1;

  const [image] = await db
    .insert(quiltingImages)
    .values({
      entityType: "quilt",
      entityId: id,
      storagePath,
      label: clamp(body.label, MAX_LABEL),
      position: nextPosition,
    })
    .returning();

  res.status(201).json({
    id: image.id,
    url: `/api/quilting/quilts/${id}/images/${image.id}`,
    label: image.label,
    position: image.position,
  });
});

router.get("/quilts/:id/images/:imageId", async (req, res) => {
  const { imageId } = UpdateQuiltImageParams.parse(req.params);
  const { id } = GetQuiltImageParams.parse(req.params);
  const userId = req.session.userId!;

  // Verify quilt ownership before serving image
  const [quilt] = await db
    .select({ id: finishedQuilts.id })
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!quilt) {
    res.status(404).json({ error: "Quilt not found." });
    return;
  }

  const [image] = await db
    .select()
    .from(quiltingImages)
    .where(
      sql`${quiltingImages.id} = ${imageId} AND entity_type = 'quilt' AND entity_id = ${id}`,
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

router.patch("/quilts/:id/images/:imageId", async (req, res) => {
  const { imageId } = UpdateQuiltImageParams.parse(req.params);
  const { id } = UpdateQuiltParams.parse(req.params);
  const userId = req.session.userId!;
  const body = UpdateQuiltImageBody.parse(req.body);

  // Verify quilt ownership before modifying image
  const [quilt] = await db
    .select({ id: finishedQuilts.id })
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!quilt) {
    res.status(404).json({ error: "Quilt not found." });
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
      sql`${quiltingImages.id} = ${imageId} AND entity_type = 'quilt' AND entity_id = ${id}`,
    )
    .returning();
  if (!image) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  res.json({
    id: image.id,
    url: `/api/quilting/quilts/${id}/images/${image.id}`,
    label: image.label,
    position: image.position,
  });
});

router.delete("/quilts/:id/images/:imageId", async (req, res) => {
  const { imageId } = DeleteQuiltImageParams.parse(req.params);
  const { id } = DeleteQuiltParams.parse(req.params);
  const userId = req.session.userId!;

  // Verify quilt ownership BEFORE deleting the image
  const [quilt] = await db
    .select({ id: finishedQuilts.id })
    .from(finishedQuilts)
    .where(and(eq(finishedQuilts.id, id), eq(finishedQuilts.userId, userId)))
    .limit(1);
  if (!quilt) {
    res.status(404).json({ error: "Quilt not found." });
    return;
  }

  const [image] = await db
    .delete(quiltingImages)
    .where(
      sql`${quiltingImages.id} = ${imageId} AND entity_type = 'quilt' AND entity_id = ${id}`,
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
