import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsDiaryEntries } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { tripExists } from "../../lib/travels/db-helpers";

const router: IRouter = Router();
router.use(requireAuth);

// ── GET /trips/:tripId/diary ───────────────────────────────────────────────────
// Returns all diary entries for a trip, newest entry date first.

router.get("/trips/:tripId/diary", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  const entries = await db
    .select()
    .from(travelsDiaryEntries)
    .where(eq(travelsDiaryEntries.tripId, tripId))
    .orderBy(desc(travelsDiaryEntries.entryDate), desc(travelsDiaryEntries.id));
  res.json(entries);
});

// ── POST /trips/:tripId/diary ──────────────────────────────────────────────────

const CreateEntryBody = z.object({
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD"),
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(20000),
});

router.post("/trips/:tripId/diary", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  const parsed = CreateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    res.status(400).json({ error: "Invalid request.", details });
    return;
  }
  const body = parsed.data;
  const userId = req.session.userId!;

  const [entry] = await db
    .insert(travelsDiaryEntries)
    .values({
      tripId,
      entryDate: body.entryDate,
      title: body.title ?? null,
      body: body.body,
      addedByUserId: userId,
    })
    .returning();
  res.status(201).json(entry);
});

// ── PATCH /trips/:tripId/diary/:entryId ────────────────────────────────────────

const UpdateEntryBody = z.object({
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD")
    .optional(),
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(20000).optional(),
});

router.patch("/trips/:tripId/diary/:entryId", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(tripId) || isNaN(entryId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    res.status(400).json({ error: "Invalid request.", details });
    return;
  }
  const body = parsed.data;
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(travelsDiaryEntries)
    .set({ ...body, updatedAt: new Date() })
    .where(
      and(
        eq(travelsDiaryEntries.id, entryId),
        eq(travelsDiaryEntries.tripId, tripId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Diary entry not found" });
    return;
  }
  res.json(updated);
});

// ── DELETE /trips/:tripId/diary/:entryId ───────────────────────────────────────

router.delete("/trips/:tripId/diary/:entryId", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(tripId) || isNaN(entryId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const result = await db
    .delete(travelsDiaryEntries)
    .where(
      and(
        eq(travelsDiaryEntries.id, entryId),
        eq(travelsDiaryEntries.tripId, tripId),
      ),
    )
    .returning({ id: travelsDiaryEntries.id });
  if (!result[0]) {
    res.status(404).json({ error: "Diary entry not found" });
    return;
  }
  res.status(204).send();
});

export default router;
