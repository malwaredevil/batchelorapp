import { Router, type IRouter } from "express";
import { asc, eq, count as sqlCount, notInArray } from "drizzle-orm";
import {
  db,
  ornamentsCategories as categories,
  ornamentsItemCategories as itemCategories,
} from "@workspace/db";
import {
  ListOrnamentCategoriesResponse,
  ListOrnamentCategoriesResponseItem,
  CreateOrnamentCategoryBody,
  DeleteOrnamentCategoryParams,
  RenameOrnamentCategoryParams,
  RenameOrnamentCategoryBody,
  MergeOrnamentCategoryBody,
  UpdateOrnamentCategoryColorsBody,
  UpdateOrnamentCategoryColorsParams,
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
  const t = raw.trim().replace(/[″\u201C\u201D]/g, '"');
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const router: IRouter = Router();
router.use(requireAuth);

async function fetchWithCount(id: number) {
  const [row] = await db
    .select({
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
      count: sqlCount(itemCategories.itemId),
    })
    .from(categories)
    .leftJoin(itemCategories, eq(itemCategories.categoryId, categories.id))
    .where(eq(categories.id, id))
    .groupBy(
      categories.id,
      categories.name,
      categories.bgColor,
      categories.textColor,
    );
  return row ?? null;
}

router.get("/categories", async (_req, res) => {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
      count: sqlCount(itemCategories.itemId),
    })
    .from(categories)
    .leftJoin(itemCategories, eq(itemCategories.categoryId, categories.id))
    .groupBy(
      categories.id,
      categories.name,
      categories.bgColor,
      categories.textColor,
    )
    .orderBy(asc(categories.name));
  res.json(ListOrnamentCategoriesResponse.parse(rows));
});

router.post("/categories", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateOrnamentCategoryBody.parse(req.body);
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
    const withCount = await fetchWithCount(row.id);
    res.status(201).json(ListOrnamentCategoriesResponseItem.parse(withCount));
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
  const { id } = RenameOrnamentCategoryParams.parse(req.params);
  const body = RenameOrnamentCategoryBody.parse(req.body);
  const name = normalizeCategoryName(body.name);
  try {
    const [updated] = await db
      .update(categories)
      .set({ name })
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!updated) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    const withCount = await fetchWithCount(id);
    res.json(ListOrnamentCategoriesResponseItem.parse(withCount));
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
  const { id } = UpdateOrnamentCategoryColorsParams.parse(req.params);
  const body = UpdateOrnamentCategoryColorsBody.parse(req.body);
  const [updated] = await db
    .update(categories)
    .set({ bgColor: body.bgColor ?? null, textColor: body.textColor ?? null })
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!updated) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  const withCount = await fetchWithCount(id);
  res.json(ListOrnamentCategoriesResponseItem.parse(withCount));
});

// Must be registered before DELETE /categories/:id so Express doesn't treat
// "unused" as an :id parameter.
router.delete("/categories/unused", async (_req, res) => {
  const usedRows = await db
    .select({ categoryId: itemCategories.categoryId })
    .from(itemCategories);
  const usedIds = [...new Set(usedRows.map((r) => r.categoryId))];

  const deletedRows = await db
    .delete(categories)
    .where(usedIds.length > 0 ? notInArray(categories.id, usedIds) : undefined)
    .returning({ id: categories.id });
  res.json({ deleted: deletedRows.length });
});

router.delete("/categories/:id", async (req, res) => {
  const { id } = DeleteOrnamentCategoryParams.parse(req.params);
  const [row] = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!row) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  res.status(204).end();
});

router.post("/categories/:id/merge", async (req, res) => {
  const { id } = DeleteOrnamentCategoryParams.parse(req.params);
  const { intoId } = MergeOrnamentCategoryBody.parse(req.body);

  if (id === intoId) {
    res.status(400).json({ error: "Cannot merge a category into itself." });
    return;
  }

  const [source, target] = await Promise.all([
    db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, id))
      .then((r) => r[0]),
    db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, intoId))
      .then((r) => r[0]),
  ]);

  if (!source || !target) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  const sourceItems = await db
    .select({ itemId: itemCategories.itemId })
    .from(itemCategories)
    .where(eq(itemCategories.categoryId, id));

  if (sourceItems.length > 0) {
    await db
      .insert(itemCategories)
      .values(
        sourceItems.map((r) => ({ itemId: r.itemId, categoryId: intoId })),
      )
      .onConflictDoNothing();
  }

  await db.delete(categories).where(eq(categories.id, id));
  res.status(204).end();
});

export default router;
