import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db, shoppingItems } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

const STATUS_VALUES = ["want", "ordered", "bought"] as const;

const CreateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .transform((s: string) => s.trim()),
  notes: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  estimatedPriceUsd: z.number().nullable().optional(),
  actualPriceUsd: z.number().nullable().optional(),
  store: z.string().nullable().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.number().int().optional(),
});

const UpdateSchema = CreateSchema.partial();

function serialize(row: typeof shoppingItems.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    url: row.url,
    quantity: row.quantity,
    unit: row.unit,
    estimatedPriceUsd: row.estimatedPriceUsd,
    actualPriceUsd: row.actualPriceUsd,
    store: row.store,
    status: row.status as "want" | "ordered" | "bought",
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/shopping", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(shoppingItems)
    .where(eq(shoppingItems.userId, userId))
    .orderBy(desc(shoppingItems.priority), desc(shoppingItems.createdAt));
  res.json(rows.map(serialize));
});

router.get("/shopping/stats", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(shoppingItems)
    .where(eq(shoppingItems.userId, userId));
  const stats = {
    totalItems: rows.length,
    wantCount: rows.filter((r) => r.status === "want").length,
    orderedCount: rows.filter((r) => r.status === "ordered").length,
    boughtCount: rows.filter((r) => r.status === "bought").length,
    totalEstimatedUsd: rows.reduce((s, r) => s + (r.estimatedPriceUsd ?? 0), 0),
    totalSpentUsd: rows.reduce(
      (s, r) =>
        s +
        (r.status === "bought"
          ? (r.actualPriceUsd ?? r.estimatedPriceUsd ?? 0)
          : 0),
      0,
    ),
  };
  res.json(stats);
});

router.post("/shopping", async (req, res) => {
  const userId = req.session.userId!;
  const data = CreateSchema.parse(req.body);
  const [row] = await db
    .insert(shoppingItems)
    .values({
      userId,
      name: data.name,
      notes: data.notes ?? null,
      url: data.url ?? null,
      quantity: data.quantity ?? null,
      unit: data.unit ?? "yards",
      estimatedPriceUsd: data.estimatedPriceUsd ?? null,
      actualPriceUsd: data.actualPriceUsd ?? null,
      store: data.store ?? null,
      status: data.status ?? "want",
      priority: data.priority ?? 0,
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.get("/shopping/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(shoppingItems)
    .where(and(eq(shoppingItems.id, id), eq(shoppingItems.userId, userId)));
  if (!row) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(serialize(row));
});

router.patch("/shopping/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const data = UpdateSchema.parse(req.body);
  const update: Partial<typeof shoppingItems.$inferInsert> = {};
  if (data.name !== undefined) update.name = data.name;
  if ("notes" in data) update.notes = data.notes ?? null;
  if ("url" in data) update.url = data.url ?? null;
  if ("quantity" in data) update.quantity = data.quantity ?? null;
  if ("unit" in data) update.unit = data.unit ?? null;
  if ("estimatedPriceUsd" in data)
    update.estimatedPriceUsd = data.estimatedPriceUsd ?? null;
  if ("actualPriceUsd" in data)
    update.actualPriceUsd = data.actualPriceUsd ?? null;
  if ("store" in data) update.store = data.store ?? null;
  if (data.status !== undefined) update.status = data.status;
  if (data.priority !== undefined) update.priority = data.priority;
  const [row] = await db
    .update(shoppingItems)
    .set(update)
    .where(and(eq(shoppingItems.id, id), eq(shoppingItems.userId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(serialize(row));
});

router.delete("/shopping/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(shoppingItems)
    .where(and(eq(shoppingItems.id, id), eq(shoppingItems.userId, userId)))
    .returning({ id: shoppingItems.id });
  if (!row) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.status(204).send();
});

export default router;
