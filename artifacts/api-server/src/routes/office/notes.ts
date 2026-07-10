import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, officeNotes, appUsers } from "@workspace/db";
import {
  ListNotesResponse,
  CreateNoteBody,
  UpdateNoteParams,
  UpdateNoteBody,
  UpdateNoteResponse,
  DeleteNoteParams,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

async function fetchNote(id: number) {
  const [row] = await db
    .select({
      id: officeNotes.id,
      title: officeNotes.title,
      body: officeNotes.body,
      createdByUserId: officeNotes.createdByUserId,
      createdByName: appUsers.displayName,
      createdByEmail: appUsers.email,
      createdAt: officeNotes.createdAt,
      updatedAt: officeNotes.updatedAt,
    })
    .from(officeNotes)
    .leftJoin(appUsers, eq(appUsers.id, officeNotes.createdByUserId))
    .where(eq(officeNotes.id, id));
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName ?? row.createdByEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/notes", async (_req, res) => {
  const rows = await db
    .select({
      id: officeNotes.id,
      title: officeNotes.title,
      body: officeNotes.body,
      createdByUserId: officeNotes.createdByUserId,
      createdByName: appUsers.displayName,
      createdByEmail: appUsers.email,
      createdAt: officeNotes.createdAt,
      updatedAt: officeNotes.updatedAt,
    })
    .from(officeNotes)
    .leftJoin(appUsers, eq(appUsers.id, officeNotes.createdByUserId))
    .orderBy(desc(officeNotes.updatedAt));
  const mapped = rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName ?? row.createdByEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
  res.json(ListNotesResponse.parse(mapped));
});

router.post("/notes", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateNoteBody.parse(req.body);
  const [row] = await db
    .insert(officeNotes)
    .values({
      title: body.title,
      body: body.body,
      createdByUserId: userId,
    })
    .returning({ id: officeNotes.id });
  const note = await fetchNote(row.id);
  res.status(201).json(UpdateNoteResponse.parse(note));
});

router.patch("/notes/:id", async (req, res) => {
  const { id } = UpdateNoteParams.parse(req.params);
  const body = UpdateNoteBody.parse(req.body);
  const [updated] = await db
    .update(officeNotes)
    .set({ title: body.title, body: body.body, updatedAt: new Date() })
    .where(eq(officeNotes.id, id))
    .returning({ id: officeNotes.id });
  if (!updated) {
    res.status(404).json({ error: "Note not found." });
    return;
  }
  const note = await fetchNote(id);
  res.json(UpdateNoteResponse.parse(note));
});

router.delete("/notes/:id", async (req, res) => {
  const { id } = DeleteNoteParams.parse(req.params);
  const [row] = await db
    .delete(officeNotes)
    .where(eq(officeNotes.id, id))
    .returning({ id: officeNotes.id });
  if (!row) {
    res.status(404).json({ error: "Note not found." });
    return;
  }
  res.status(204).end();
});

export default router;
