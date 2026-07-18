import { Router, type IRouter } from "express";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db,
  travelsReservations,
  travelChangeEvents,
  travelMonitoringBaselines,
  travelMonitoringObservations,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { tripExists } from "../../lib/travels/db-helpers";
import { logger } from "../../lib/logger";
import { z } from "zod";

const router: IRouter = Router();
router.use(requireAuth);

// ── GET /trips/:tripId/changes ────────────────────────────────────────────────
router.get("/trips/:tripId/changes", async (req, res) => {
  const tripId = parseInt(req.params["tripId"] ?? "");
  if (isNaN(tripId))
    return void res.status(400).json({ error: "invalid tripId" });
  if (!(await tripExists(tripId)))
    return void res.status(404).json({ error: "trip not found" });

  const { state, severity } = req.query as Record<string, string | undefined>;

  // Fetch reservations for this trip
  const reservations = await db
    .select({ id: travelsReservations.id })
    .from(travelsReservations)
    .where(eq(travelsReservations.tripId, tripId));

  if (reservations.length === 0) return void res.json([]);

  const reservationIds = reservations.map((r) => r.id);

  const conditions = [
    inArray(travelChangeEvents.reservationId, reservationIds),
  ];
  if (state) conditions.push(eq(travelChangeEvents.state, state));
  if (severity) conditions.push(eq(travelChangeEvents.severity, severity));

  const changes = await db
    .select()
    .from(travelChangeEvents)
    .where(and(...conditions))
    .orderBy(desc(travelChangeEvents.createdAt))
    .limit(100);

  res.json(changes);
});

// ── GET /changes/:id ──────────────────────────────────────────────────────────
router.get("/changes/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });

  const [change] = await db
    .select()
    .from(travelChangeEvents)
    .where(eq(travelChangeEvents.id, id));
  if (!change)
    return void res.status(404).json({ error: "change event not found" });

  // Attach reservation + baseline + observations for full context
  const [reservation] = await db
    .select()
    .from(travelsReservations)
    .where(eq(travelsReservations.id, change.reservationId));

  const [baseline] = change.baselineId
    ? await db
        .select()
        .from(travelMonitoringBaselines)
        .where(eq(travelMonitoringBaselines.id, change.baselineId))
    : [undefined];

  const [prevObs] = change.previousObservationId
    ? await db
        .select()
        .from(travelMonitoringObservations)
        .where(
          eq(travelMonitoringObservations.id, change.previousObservationId),
        )
    : [undefined];

  const [newObs] = change.newObservationId
    ? await db
        .select()
        .from(travelMonitoringObservations)
        .where(eq(travelMonitoringObservations.id, change.newObservationId))
    : [undefined];

  res.json({
    ...change,
    reservation,
    baseline,
    previousObservation: prevObs,
    newObservation: newObs,
  });
});

// ── POST /changes/:id/decision ────────────────────────────────────────────────
const DecisionSchema = z.object({
  action: z.enum([
    "accept",
    "reject",
    "keep_current",
    "mark_source_incorrect",
    "disable_monitoring",
  ]),
  notes: z.string().max(500).optional(),
});

router.post("/changes/:id/decision", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });

  const parsed = DecisionSchema.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ error: parsed.error.flatten() });
  const { action, notes } = parsed.data;

  const [change] = await db
    .select()
    .from(travelChangeEvents)
    .where(eq(travelChangeEvents.id, id));
  if (!change)
    return void res.status(404).json({ error: "change event not found" });
  if (
    change.state !== "detected" &&
    change.state !== "under_review" &&
    change.state !== "notified"
  ) {
    return void res
      .status(409)
      .json({ error: `Change is already in state '${change.state}'` });
  }

  let newState: string;
  switch (action) {
    case "accept":
      newState = "accepted";
      break;
    case "reject":
    case "keep_current":
    case "mark_source_incorrect":
      newState = "rejected";
      break;
    case "disable_monitoring":
      newState = "resolved";
      // Also disable monitoring on the reservation
      await db
        .update(travelsReservations)
        .set({ monitoringEnabled: false, updatedAt: new Date() })
        .where(eq(travelsReservations.id, change.reservationId));
      break;
    default:
      newState = "resolved";
  }

  const [updated] = await db
    .update(travelChangeEvents)
    .set({
      state: newState,
      decidedByUserId: req.session.userId,
      decidedAt: new Date(),
      decisionNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(travelChangeEvents.id, id))
    .returning();

  // If accepted and affects schedule — update reservation status
  if (action === "accept" && change.changeType === "cancellation") {
    await db
      .update(travelsReservations)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(travelsReservations.id, change.reservationId));
  }

  logger.info(
    { changeId: id, action, newState },
    "Change event decision recorded",
  );
  res.json(updated);
});

export default router;
