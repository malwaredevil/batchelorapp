import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, travelsTrips, travelsReminders } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

const CreateReminderBody = z.object({
  title: z.string().min(1),
  dueDate: z.string().optional(),
});

const UpdateReminderBody = z.object({
  title: z.string().min(1).optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
});

async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}

// GET /reminders — all pending (or all) reminders across all trips (for Dashboard)
router.get("/reminders", async (req, res) => {
  const pending = req.query.pending === "true";

  const rows = await db
    .select()
    .from(travelsReminders)
    .where(pending ? eq(travelsReminders.done, false) : undefined)
    .orderBy(asc(travelsReminders.dueDate), asc(travelsReminders.createdAt));

  res.json(rows);
});

// GET /trips/:id/reminders
router.get("/trips/:id/reminders", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (isNaN(tripId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await tripExists(tripId))) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db
    .select()
    .from(travelsReminders)
    .where(eq(travelsReminders.tripId, tripId))
    .orderBy(asc(travelsReminders.dueDate), asc(travelsReminders.createdAt));

  res.json(rows);
});

// POST /trips/:id/reminders
router.post("/trips/:id/reminders", async (req, res) => {
  const userId = req.session.userId!;
  const tripId = parseInt(req.params.id, 10);
  if (isNaN(tripId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await tripExists(tripId))) { res.status(404).json({ error: "Not found" }); return; }

  const body = CreateReminderBody.parse(req.body);
  const [row] = await db
    .insert(travelsReminders)
    .values({
      tripId,
      userId,
      title: body.title,
      dueDate: body.dueDate ?? null,
      done: false,
    })
    .returning();

  res.status(201).json(row);
});

// PATCH /trips/:id/reminders/:reminderId
router.patch("/trips/:id/reminders/:reminderId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const reminderId = parseInt(req.params.reminderId, 10);
  if (isNaN(tripId) || isNaN(reminderId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = UpdateReminderBody.parse(req.body);
  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.dueDate !== undefined) updateData.dueDate = body.dueDate;
  if (body.done !== undefined) updateData.done = body.done;

  const [updated] = await db
    .update(travelsReminders)
    .set(updateData)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    )
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// DELETE /trips/:id/reminders/:reminderId
router.delete("/trips/:id/reminders/:reminderId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const reminderId = parseInt(req.params.reminderId, 10);
  if (isNaN(tripId) || isNaN(reminderId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db
    .select({ id: travelsReminders.id })
    .from(travelsReminders)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    );

  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db
    .delete(travelsReminders)
    .where(
      and(
        eq(travelsReminders.id, reminderId),
        eq(travelsReminders.tripId, tripId),
      ),
    );
  res.status(204).send();
});

export default router;
