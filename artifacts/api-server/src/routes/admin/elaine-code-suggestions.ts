/**
 * Elaine code-diagnosis suggestions (#895/#913) — owner-only.
 *
 * Lists suggestions Elaine generated after a self-heal behavioral lesson
 * recurred enough times to warrant a bounded, read-only look at the actual
 * source code (see lib/elaine-code-diagnosis.ts). Nothing here is ever
 * auto-applied.
 *
 * POST /:id/create-task  — one-click: accepts the suggestion AND creates an
 *   elaine_code_tasks row pre-filled with the pattern/hypothesis, storing the
 *   auto-generated "#<id>" ref back on the suggestion row so the panel can
 *   immediately show "→ Task #NNN" without any manual step (#913).
 *
 * POST /:id/decision     — accept or dismiss (no task creation).
 * PATCH /:id/linked-task — manual recovery: link an existing task ref to an
 *   already-accepted suggestion that has no linked task yet.
 */

import { Router } from "express";
import { z } from "zod/v4";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { adminLimiter } from "../../middleware/rateLimit";
import { getAuthenticatedUserId } from "../../lib/auth-context";
import {
  createTaskFromSuggestion,
  decideElaineCodeSuggestion,
  linkTaskToSuggestion,
  listElaineCodeSuggestions,
  reopenElaineCodeSuggestion,
  writeSuggestionPlanFile,
} from "../../lib/elaine-code-diagnosis";

const router = Router();
router.use(adminLimiter, requireAuth, requireOwner);

const ListQuery = z.object({
  status: z.enum(["pending", "accepted", "dismissed"]).optional(),
});

router.get("/", async (req, res) => {
  const query = ListQuery.parse(req.query);
  const suggestions = await listElaineCodeSuggestions(query.status);
  res.json({ suggestions });
});

// ---------------------------------------------------------------------------
// POST /:id/create-task — PRIMARY one-click flow (#913)
// Accepts the pending suggestion, creates an elaine_code_tasks row, and
// stores the auto-generated "#<task.id>" ref on the suggestion in one shot.
// ---------------------------------------------------------------------------

router.post("/:id/create-task", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid suggestion id" });
    return;
  }

  const userId = getAuthenticatedUserId(req);
  const result = await createTaskFromSuggestion({
    suggestionId: id,
    userId,
  });

  if (!result) {
    res.status(404).json({ error: "Suggestion not found or already decided" });
    return;
  }

  // Write a plan file as a bonus convenience — best-effort, never blocks.
  const planFilePath = writeSuggestionPlanFile(result.suggestion);

  res.json({
    suggestion: result.suggestion,
    task: result.task,
    planFilePath,
  });
});

// ---------------------------------------------------------------------------
// POST /:id/decision — accept or dismiss without creating a task
// ---------------------------------------------------------------------------

const DecisionBody = z.object({
  decision: z.enum(["accepted", "dismissed"]),
});

router.post("/:id/decision", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid suggestion id" });
    return;
  }

  const body = DecisionBody.parse(req.body);
  const decidedByUserId = getAuthenticatedUserId(req);

  const updated = await decideElaineCodeSuggestion({
    id,
    decision: body.decision,
    decidedByUserId,
  });

  if (!updated) {
    res.status(404).json({ error: "Suggestion not found or already decided" });
    return;
  }

  // When the owner accepts via this endpoint (not the create-task path), still
  // write the plan file so they have pre-filled task content to work from.
  let planFilePath: string | null = null;
  if (body.decision === "accepted") {
    planFilePath = writeSuggestionPlanFile(updated);
  }

  res.json({ suggestion: updated, planFilePath });
});

// ---------------------------------------------------------------------------
// POST /:id/reopen — reset a dismissed suggestion back to pending
// ---------------------------------------------------------------------------

router.post("/:id/reopen", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid suggestion id" });
    return;
  }

  const updated = await reopenElaineCodeSuggestion(id);

  if (!updated) {
    res
      .status(404)
      .json({ error: "Suggestion not found or not in dismissed state" });
    return;
  }

  res.json({ suggestion: updated });
});

// ---------------------------------------------------------------------------
// PATCH /:id/linked-task — manual recovery: link a ref to an accepted row
// ---------------------------------------------------------------------------

const LinkTaskBody = z.object({
  linkedTaskRef: z.string().trim().min(1).max(50),
});

router.patch("/:id/linked-task", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid suggestion id" });
    return;
  }

  const body = LinkTaskBody.parse(req.body);
  const updated = await linkTaskToSuggestion(id, body.linkedTaskRef);

  if (!updated) {
    res
      .status(404)
      .json({ error: "Suggestion not found or not in accepted state" });
    return;
  }

  res.json({ suggestion: updated });
});

export default router;
