import { Router, type IRouter } from "express";
import { and, asc, eq, count as sqlCount, sql } from "drizzle-orm";
import {
  db,
  quiltingCategories as categories,
  entityCategories,
} from "@workspace/db";
import {
  ListQuiltingCategoriesResponse as ListCategoriesResponse,
  ListQuiltingCategoriesResponseItem as ListCategoriesResponseItem,
  CreateQuiltingCategoryBody as CreateCategoryBody,
  DeleteQuiltingCategoryParams as DeleteCategoryParams,
  RenameQuiltingCategoryParams as RenameCategoryParams,
  RenameQuiltingCategoryBody as RenameCategoryBody,
  MergeQuiltingCategoryBody as MergeCategoryBody,
  UpdateQuiltingCategoryColorsBody as UpdateCategoryColorsBody,
  UpdateQuiltingCategoryColorsParams as UpdateCategoryColorsParams,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

function normalizeCategoryName(raw: string): string {
  const t = raw
    .replace(
      /[\u201C\u201D\u201E\u201F\u2033\u2036\u275D\u275E\u301D\u301E\u02BA\uFF02″]/g,
      '"',
    )
    .replace(
      /[\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u02B9\u02BC\uFF07′]/g,
      "'",
    )
    .replace(/[\u2013\u2014\u2015\u2012]/g, "-")
    .replace(/\u2026/g, "...")
    .trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const router: IRouter = Router();
router.use(requireAuth);

async function fetchWithCount(id: number, userId: number) {
  const [row] = await db
    .select({
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
      count: sqlCount(entityCategories.entityId),
    })
    .from(categories)
    .leftJoin(entityCategories, eq(entityCategories.categoryId, categories.id))
    .where(and(eq(categories.id, id)))
    .groupBy(
      categories.id,
      categories.name,
      categories.bgColor,
      categories.textColor,
    );
  return row ?? null;
}

router.get("/categories", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
      count: sqlCount(entityCategories.entityId),
    })
    .from(categories)
    .leftJoin(entityCategories, eq(entityCategories.categoryId, categories.id))
    
    .groupBy(
      categories.id,
      categories.name,
      categories.bgColor,
      categories.textColor,
    )
    .orderBy(asc(categories.name));
  res.json(ListCategoriesResponse.parse(rows));
});

router.post("/categories", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateCategoryBody.parse(req.body);
  const name = normalizeCategoryName(body.name);
  try {
    const [row] = await db
      .insert(categories)
      .values({
        userId,
        name,
        bgColor: body.bgColor ?? null,
        textColor: body.textColor ?? null,
      })
      .returning({ id: categories.id });
    const withCount = await fetchWithCount(row.id, userId);
    res.status(201).json(ListCategoriesResponseItem.parse(withCount));
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      res
        .status(409)
        .json({ error: "A category with that name already exists." });
      return;
    }
    throw err;
  }
});

router.patch("/categories/:id", async (req, res) => {
  const userId = req.session.userId!;
  const { id } = RenameCategoryParams.parse(req.params);
  const body = RenameCategoryBody.parse(req.body);
  const name = normalizeCategoryName(body.name);
  try {
    const [updated] = await db
      .update(categories)
      .set({ name })
      .where(and(eq(categories.id, id)))
      .returning({ id: categories.id });
    if (!updated) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    const withCount = await fetchWithCount(id, userId);
    res.json(ListCategoriesResponseItem.parse(withCount));
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      res
        .status(409)
        .json({ error: "A category with that name already exists." });
      return;
    }
    throw err;
  }
});

router.put("/categories/:id/colors", async (req, res) => {
  const userId = req.session.userId!;
  const { id } = UpdateCategoryColorsParams.parse(req.params);
  const body = UpdateCategoryColorsBody.parse(req.body);
  const [updated] = await db
    .update(categories)
    .set({ bgColor: body.bgColor ?? null, textColor: body.textColor ?? null })
    .where(and(eq(categories.id, id)))
    .returning({ id: categories.id });
  if (!updated) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  const withCount = await fetchWithCount(id, userId);
  res.json(ListCategoriesResponseItem.parse(withCount));
});

// Must be before DELETE /categories/:id so "unused" is not treated as :id
router.delete("/categories/unused", async (req, res) => {
  const userId = req.session.userId!;

  // Delete categories owned by this user that have no entity_categories reference
  // at all. Using NOT IN on a full-table subquery is safe because
  // entity_categories is the single join table for all entity types (fabric,
  // pattern, quilt, block, layout), so a zero-reference category is genuinely
  // unused regardless of entity type.
  const deletedRows = await db
    .delete(categories)
    .where(
      and(
        sql`${categories.id} NOT IN (
          SELECT DISTINCT category_id FROM quilting_entity_categories
        )`,
      ),
    )
    .returning({ id: categories.id });
  res.json({ deleted: deletedRows.length });
});

router.delete("/categories/:id", async (req, res) => {
  const userId = req.session.userId!;
  const { id } = DeleteCategoryParams.parse(req.params);
  const [row] = await db
    .delete(categories)
    .where(and(eq(categories.id, id)))
    .returning({ id: categories.id });
  if (!row) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  res.status(204).end();
});

router.post("/categories/:id/merge", async (req, res) => {
  const userId = req.session.userId!;
  const { id } = DeleteCategoryParams.parse(req.params);
  const { targetId } = MergeCategoryBody.parse(req.body);

  if (id === targetId) {
    res.status(400).json({ error: "Cannot merge a category into itself." });
    return;
  }

  const [source, target] = await Promise.all([
    db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, id)))
      .then((r) => r[0]),
    db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, targetId)))
      .then((r) => r[0]),
  ]);

  if (!source || !target) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  const sourceAssignments = await db
    .select({
      entityType: entityCategories.entityType,
      entityId: entityCategories.entityId,
    })
    .from(entityCategories)
    .where(eq(entityCategories.categoryId, id));

  if (sourceAssignments.length > 0) {
    await db
      .insert(entityCategories)
      .values(
        sourceAssignments.map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          categoryId: targetId,
        })),
      )
      .onConflictDoNothing();
  }

  await db
    .delete(categories)
    .where(and(eq(categories.id, id)));

  res.json({ merged: sourceAssignments.length });
});

export default router;
