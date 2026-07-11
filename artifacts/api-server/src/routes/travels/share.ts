import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod/v4";
import { db, travelsTrips } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitize the stored itinerary JSON for public consumption.
 *
 * The authenticated itinerary can contain fields that must never reach an
 * unauthenticated bearer-token caller:
 *
 *  - `sourceDocumentId` — foreign-key reference to a private travel document.
 *  - `sourceField`      — reveals the internal document extraction schema.
 *  - `tip` (on document-sourced activities) — populated from
 *    `extractedData.notes`, which can contain booking references and other
 *    sensitive details extracted from private files uploaded by the household.
 *
 * User-authored activities (no `sourceDocumentId`) may keep their `tip`
 * because those were typed in manually by the household, not derived from a
 * private document.
 *
 * Only explicitly allow-listed top-level activity fields are forwarded so that
 * any future additions to the stored shape do not silently become public.
 */
const SAFE_EMPTY_ITINERARY = { days: [] as unknown[] };

function sanitizeItineraryForPublicShare(itinerary: unknown): unknown {
  // Fail-closed: anything that is not a plain object with a `days` array is
  // replaced with a safe empty structure so that non-conforming stored shapes
  // (e.g. from an earlier schema, a future write, or an intentionally crafted
  // PATCH body) cannot leak raw private data to unauthenticated callers.
  if (
    !itinerary ||
    typeof itinerary !== "object" ||
    !Array.isArray((itinerary as { days?: unknown }).days)
  ) {
    return SAFE_EMPTY_ITINERARY;
  }
  const { days } = itinerary as { days: unknown[] };
  return {
    days: days.flatMap((day: unknown) => {
      // Non-object day entries are dropped rather than forwarded.
      if (!day || typeof day !== "object") return [];
      const d = day as Record<string, unknown>;
      return [
        {
          date: d["date"],
          title: d["title"],
          activities: Array.isArray(d["activities"])
            ? d["activities"].flatMap((act: unknown) => {
                // Non-object activity entries are dropped rather than forwarded.
                if (!act || typeof act !== "object") return [];
                const a = act as Record<string, unknown>;
                const isDocSourced = a["sourceDocumentId"] != null;
                return [
                  {
                    time: a["time"],
                    name: a["name"],
                    description: a["description"],
                    proximity: a["proximity"],
                    status: a["status"],
                    // Omit tip for document-sourced activities: the value comes
                    // from extractedData.notes and may contain booking details.
                    ...(isDocSourced ? {} : { tip: a["tip"] }),
                  },
                ];
              })
            : [],
        },
      ];
    }),
  };
}

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
    itinerary: sanitizeItineraryForPublicShare(trip.itinerary),
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
