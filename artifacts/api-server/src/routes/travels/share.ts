import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod/v4";
import { db, travelsTrips } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();

// ── Public — no requireAuth ───────────────────────────────────────────────────

// GET /trips/:id/share?token=<token> — read-only itinerary view, no session required.
// Returns only the fields safe to show publicly (no user_id, no chatHistory,
// no documents, no private notes beyond trip-level notes).
router.get("/trips/:id/share", async (req, res) => {
  const token = String(req.query["token"] ?? "");
  if (!token) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  const [trip] = await db
    .select()
    .from(travelsTrips)
    .where(eq(travelsTrips.shareToken, token));

  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
    travellerCount: trip.travellerCount,
    notes: trip.notes,
    itinerary: trip.itinerary,
    theOneThing: trip.theOneThing,
    transportTo: trip.transportTo,
    accommodationName: trip.accommodationName,
    accommodationArea: trip.accommodationArea,
  });
});

// ── Authenticated ─────────────────────────────────────────────────────────────
//
// Security note: these endpoints intentionally do NOT perform a per-user
// ownership check on the trip before generating or revoking a share token.
// Travels data is fully household-shared by design (see threat_model.md §
// "Household-sharing boundary"): every authenticated household member may
// view, create, edit, and delete ANY trip record.  The correct access
// boundary here is authentication (requireAuth), not per-row user ownership.
// The user_id column on trips is attribution-only and is never used as a
// read/write gate.

// POST /trips/:id/share — generate (or return existing) share token.
router.post("/trips/:id/share", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [trip] = await db
    .select({ id: travelsTrips.id, shareToken: travelsTrips.shareToken })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, id));

  if (!trip) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (trip.shareToken) {
    res.json({ shareToken: trip.shareToken });
    return;
  }

  const token = crypto.randomBytes(16).toString("hex");
  await db
    .update(travelsTrips)
    .set({ shareToken: token })
    .where(eq(travelsTrips.id, id));

  res.json({ shareToken: token });
});

// DELETE /trips/:id/share — revoke (clear) the share token.
router.delete("/trips/:id/share", requireAuth, async (req, res) => {
  const body = z.object({ confirm: z.boolean() }).safeParse(req.body);
  if (!body.success || !body.data.confirm) {
    res.status(400).json({ error: "Send { confirm: true } to revoke" });
    return;
  }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .update(travelsTrips)
    .set({ shareToken: null })
    .where(eq(travelsTrips.id, id));
  res.status(204).send();
});

export default router;
