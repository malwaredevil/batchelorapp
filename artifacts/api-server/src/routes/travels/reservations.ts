import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  travelsTrips,
  travelsReservations,
  travelMonitoringBaselines,
  travelMonitoringObservations,
  travelChangeEvents,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { tripExists } from "../../lib/travels/db-helpers";
import {
  createNotification,
  NOTIFICATION_TYPES,
} from "../../lib/notifications";
import { enqueueJob } from "../../lib/jobs/queue";
import { logger } from "../../lib/logger";
import { createHash } from "crypto";
import { z } from "zod";

const router: IRouter = Router();
router.use(requireAuth);

function hashObject(obj: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(obj ?? {}))
    .digest("hex")
    .slice(0, 16);
}

// ── Segment schema ────────────────────────────────────────────────────────────
const SegmentSchema = z
  .object({
    segmentType: z.string().optional(),
    carrier: z.string().optional(),
    flightNumber: z.string().optional(),
    trainNumber: z.string().optional(),
    origin: z.string().optional(),
    destination: z.string().optional(),
    departureTime: z.string().optional(),
    arrivalTime: z.string().optional(),
    cabin: z.string().optional(),
    seatNumbers: z.array(z.string()).optional(),
    duration: z.string().optional(),
  })
  .passthrough();

const UpsertReservationSchema = z.object({
  documentId: z.number().int().optional(),
  reservationType: z
    .enum(["flight", "hotel", "rental_car", "rail", "general"])
    .default("general"),
  providerName: z.string().max(200).optional(),
  confirmationRef: z.string().max(100).optional(),
  passengerNames: z.array(z.string()).default([]),
  segments: z.array(SegmentSchema).default([]),
  checkInDate: z.string().optional(),
  checkOutDate: z.string().optional(),
  destinationIata: z.string().max(10).optional(),
  originIata: z.string().max(10).optional(),
  rawExtracted: z.record(z.unknown()).default({}),
  monitoringEnabled: z.boolean().default(true),
  monitoringPolicy: z
    .enum(["minimal", "standard", "aggressive", "paused"])
    .default("standard"),
});

// ── GET /trips/:tripId/reservations ──────────────────────────────────────────
router.get("/trips/:tripId/reservations", async (req, res) => {
  const tripId = parseInt(req.params["tripId"] ?? "");
  if (isNaN(tripId))
    return void res.status(400).json({ error: "invalid tripId" });
  if (!(await tripExists(tripId)))
    return void res.status(404).json({ error: "trip not found" });

  const rows = await db
    .select()
    .from(travelsReservations)
    .where(eq(travelsReservations.tripId, tripId))
    .orderBy(desc(travelsReservations.createdAt));

  // Attach open change counts
  const ids = rows.map((r) => r.id);
  const changeCounts: Record<number, number> = {};
  if (ids.length > 0) {
    const counts = await db
      .select({
        reservationId: travelChangeEvents.reservationId,
      })
      .from(travelChangeEvents)
      .where(and(eq(travelChangeEvents.state, "detected")));
    for (const c of counts) {
      if (ids.includes(c.reservationId)) {
        changeCounts[c.reservationId] =
          (changeCounts[c.reservationId] ?? 0) + 1;
      }
    }
  }

  res.json(
    rows.map((r) => ({ ...r, openChangeCount: changeCounts[r.id] ?? 0 })),
  );
});

// ── POST /trips/:tripId/reservations ─────────────────────────────────────────
router.post("/trips/:tripId/reservations", async (req, res) => {
  const tripId = parseInt(req.params["tripId"] ?? "");
  if (isNaN(tripId))
    return void res.status(400).json({ error: "invalid tripId" });
  if (!(await tripExists(tripId)))
    return void res.status(404).json({ error: "trip not found" });

  const parsed = UpsertReservationSchema.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const [reservation] = await db
    .insert(travelsReservations)
    .values({
      tripId,
      documentId: data.documentId,
      reservationType: data.reservationType,
      providerName: data.providerName,
      confirmationRef: data.confirmationRef,
      passengerNames: data.passengerNames,
      segments: data.segments,
      checkInDate: data.checkInDate,
      checkOutDate: data.checkOutDate,
      destinationIata: data.destinationIata,
      originIata: data.originIata,
      rawExtracted: data.rawExtracted,
      monitoringEnabled: data.monitoringEnabled,
      monitoringPolicy: data.monitoringPolicy,
      createdByUserId: req.session.userId!,
    })
    .returning();

  // Automatically establish a baseline from the provided data
  if (reservation) {
    const normalizedData = {
      reservationType: reservation.reservationType,
      providerName: reservation.providerName,
      confirmationRef: reservation.confirmationRef,
      segments: reservation.segments,
      checkInDate: reservation.checkInDate,
      checkOutDate: reservation.checkOutDate,
      status: reservation.status,
      passengerNames: reservation.passengerNames,
    };
    const contentHash = hashObject(normalizedData);

    await db.insert(travelMonitoringBaselines).values({
      reservationId: reservation.id,
      normalizedData,
      contentHash,
      confirmedBy: "auto",
      confirmedByUserId: req.session.userId,
      sourceRefs: data.documentId ? [`document:${data.documentId}`] : [],
    });

    await db
      .update(travelsReservations)
      .set({ lastBaselineAt: new Date() })
      .where(eq(travelsReservations.id, reservation.id));
  }

  res.status(201).json(reservation);
});

// ── GET /reservations/:id ─────────────────────────────────────────────────────
router.get("/reservations/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });

  const [reservation] = await db
    .select()
    .from(travelsReservations)
    .where(eq(travelsReservations.id, id));
  if (!reservation)
    return void res.status(404).json({ error: "reservation not found" });

  const [baseline] = await db
    .select()
    .from(travelMonitoringBaselines)
    .where(eq(travelMonitoringBaselines.reservationId, id))
    .orderBy(desc(travelMonitoringBaselines.effectiveAt))
    .limit(1);

  const observations = await db
    .select()
    .from(travelMonitoringObservations)
    .where(eq(travelMonitoringObservations.reservationId, id))
    .orderBy(desc(travelMonitoringObservations.observedAt))
    .limit(10);

  const changes = await db
    .select()
    .from(travelChangeEvents)
    .where(eq(travelChangeEvents.reservationId, id))
    .orderBy(desc(travelChangeEvents.createdAt))
    .limit(20);

  res.json({
    ...reservation,
    baseline,
    recentObservations: observations,
    changes,
  });
});

// ── PATCH /reservations/:id ───────────────────────────────────────────────────
router.patch("/reservations/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });

  const [existing] = await db
    .select()
    .from(travelsReservations)
    .where(eq(travelsReservations.id, id));
  if (!existing)
    return void res.status(404).json({ error: "reservation not found" });

  const PatchSchema = UpsertReservationSchema.partial();
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ error: parsed.error.flatten() });

  const [updated] = await db
    .update(travelsReservations)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(travelsReservations.id, id))
    .returning();

  res.json(updated);
});

// ── DELETE /reservations/:id ──────────────────────────────────────────────────
router.delete("/reservations/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });

  const [existing] = await db
    .select({ id: travelsReservations.id })
    .from(travelsReservations)
    .where(eq(travelsReservations.id, id));
  if (!existing)
    return void res.status(404).json({ error: "reservation not found" });

  await db.delete(travelsReservations).where(eq(travelsReservations.id, id));
  res.status(204).end();
});

// ── POST /reservations/:id/monitoring ────────────────────────────────────────
// Toggle or update monitoring policy for a reservation
router.post("/reservations/:id/monitoring", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });

  const Schema = z.object({
    monitoringEnabled: z.boolean().optional(),
    monitoringPolicy: z
      .enum(["minimal", "standard", "aggressive", "paused"])
      .optional(),
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ error: parsed.error.flatten() });

  const [updated] = await db
    .update(travelsReservations)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(travelsReservations.id, id))
    .returning();

  if (!updated)
    return void res.status(404).json({ error: "reservation not found" });
  res.json(updated);
});

// ── POST /reservations/:id/check-now ─────────────────────────────────────────
// Manually enqueue a monitoring check for this reservation
router.post("/reservations/:id/check-now", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "");
  if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });

  const [reservation] = await db
    .select()
    .from(travelsReservations)
    .where(eq(travelsReservations.id, id));
  if (!reservation)
    return void res.status(404).json({ error: "reservation not found" });

  if (!reservation.monitoringEnabled) {
    return void res
      .status(409)
      .json({ error: "monitoring is disabled for this reservation" });
  }

  try {
    const jobId = await enqueueJob({
      type: "travels.monitoring-check",
      payload: { reservationId: id },
      idempotencyKey: `monitoring-check:${id}:${Date.now()}`,
      createdByUserId: req.session.userId,
      domain: "travels",
    });

    await db
      .update(travelsReservations)
      .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(travelsReservations.id, id));

    res.json({ jobId, message: "Monitoring check enqueued" });
  } catch (err) {
    logger.warn(
      { err, reservationId: id },
      "Failed to enqueue monitoring check",
    );
    res.status(500).json({ error: "Failed to enqueue check" });
  }
});

export default router;
