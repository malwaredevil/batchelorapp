import { Router, type IRouter } from "express";
import {
  ListNotesResponse,
  CreateNoteBody,
  UpdateNoteParams,
  UpdateNoteBody,
  UpdateNoteResponse,
  DeleteNoteParams,
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import {
  createOfficeNote,
  deleteOfficeNote,
  listOfficeNotes,
  updateOfficeNote,
} from "../../lib/office-notes";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/notes", async (_req, res) => {
  res.json(ListNotesResponse.parse(await listOfficeNotes()));
});

router.post("/notes", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateNoteBody.parse(req.body);
  const note = await createOfficeNote(body, userId);
  res.status(201).json(UpdateNoteResponse.parse(note));
});

router.patch("/notes/:id", async (req, res) => {
  const { id } = UpdateNoteParams.parse(req.params);
  const body = UpdateNoteBody.parse(req.body);
  const note = await updateOfficeNote(id, body);
  if (!note) {
    res.status(404).json({ error: "Note not found." });
    return;
  }
  res.json(UpdateNoteResponse.parse(note));
});

router.delete("/notes/:id", async (req, res) => {
  const { id } = DeleteNoteParams.parse(req.params);
  if (!(await deleteOfficeNote(id))) {
    res.status(404).json({ error: "Note not found." });
    return;
  }
  res.status(204).end();
});

export default router;
