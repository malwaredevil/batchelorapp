/**
 * Recycle bin router — household-wide view of all soft-deleted items plus
 * restore + permanent-delete endpoints.
 *
 * Mounted at /api/recycle-bin (via routes/index.ts).
 * All routes require an authenticated session (requireAuth applied at mount).
 *
 * Purge policy: items with deleted_at older than 30 days are eligible for
 * permanent deletion by the purge job (see lib/purge-deleted.ts).
 */
import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  potteryItems,
  potteryImages,
  fabrics,
  quiltingImages,
  quiltPatterns,
  finishedQuilts,
  travelsTrips,
  travelsTripPhotos,
  travelsTripDocuments,
  reminders,
  ornamentsItems,
  ornamentsImages,
} from "@workspace/db";
import { logActivity } from "../lib/soft-delete";

const router: IRouter = Router();

// Scope requireAuth to /recycle-bin paths only. This router is mounted without
// a path prefix in routes/index.ts (router.use(recycleBinRouter)), so a blanket
// router.use(requireAuth) would intercept every request that flows through the
// routes chain — including unauthenticated webhook routes (/elaine/email-webhook,
// /agentphone/webhook) that are mounted later. See the "Global requireAuth bug
// in Express sub-routers" memory note.
router.use("/recycle-bin", requireAuth);

const PURGE_DAYS = 30;

/**
 * GET /recycle-bin
 * Returns all soft-deleted items across every app, newest-deleted first.
 * Optional query param: ?entityType=pottery_item|fabric|pattern|quilt|trip|trip_photo|trip_document|reminder|ornament
 */
router.get("/recycle-bin", async (req, res) => {
  const entityTypeFilter =
    typeof req.query.entityType === "string" ? req.query.entityType : undefined;

  type BinItem = {
    entityType: string;
    entityId: number;
    entityLabel: string | null;
    thumbnailPath: string | null;
    deletedAt: Date;
    expiresAt: Date;
  };

  const items: BinItem[] = [];

  const addExpiry = (deletedAt: Date): Date => {
    const d = new Date(deletedAt);
    d.setDate(d.getDate() + PURGE_DAYS);
    return d;
  };

  if (!entityTypeFilter || entityTypeFilter === "pottery_item") {
    const rows = await db
      .select({
        id: potteryItems.id,
        imagePath: potteryItems.imagePath,
        deletedAt: potteryItems.deletedAt,
      })
      .from(potteryItems)
      .where(isNotNull(potteryItems.deletedAt))
      .orderBy(potteryItems.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "pottery_item",
        entityId: r.id,
        entityLabel: null,
        thumbnailPath: r.imagePath,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "fabric") {
    const rows = await db
      .select({
        id: fabrics.id,
        name: fabrics.name,
        imagePath: fabrics.imagePath,
        deletedAt: fabrics.deletedAt,
      })
      .from(fabrics)
      .where(isNotNull(fabrics.deletedAt))
      .orderBy(fabrics.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "fabric",
        entityId: r.id,
        entityLabel: r.name,
        thumbnailPath: r.imagePath,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "pattern") {
    const rows = await db
      .select({
        id: quiltPatterns.id,
        name: quiltPatterns.name,
        imagePath: quiltPatterns.imagePath,
        deletedAt: quiltPatterns.deletedAt,
      })
      .from(quiltPatterns)
      .where(isNotNull(quiltPatterns.deletedAt))
      .orderBy(quiltPatterns.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "pattern",
        entityId: r.id,
        entityLabel: r.name,
        thumbnailPath: r.imagePath ?? null,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "quilt") {
    const rows = await db
      .select({
        id: finishedQuilts.id,
        name: finishedQuilts.name,
        imagePath: finishedQuilts.imagePath,
        deletedAt: finishedQuilts.deletedAt,
      })
      .from(finishedQuilts)
      .where(isNotNull(finishedQuilts.deletedAt))
      .orderBy(finishedQuilts.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "quilt",
        entityId: r.id,
        entityLabel: r.name,
        thumbnailPath: r.imagePath,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "trip") {
    const rows = await db
      .select({
        id: travelsTrips.id,
        destination: travelsTrips.destination,
        deletedAt: travelsTrips.deletedAt,
      })
      .from(travelsTrips)
      .where(isNotNull(travelsTrips.deletedAt))
      .orderBy(travelsTrips.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "trip",
        entityId: r.id,
        entityLabel: r.destination,
        thumbnailPath: null,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "trip_photo") {
    const rows = await db
      .select({
        id: travelsTripPhotos.id,
        caption: travelsTripPhotos.caption,
        storagePath: travelsTripPhotos.storagePath,
        deletedAt: travelsTripPhotos.deletedAt,
      })
      .from(travelsTripPhotos)
      .where(isNotNull(travelsTripPhotos.deletedAt))
      .orderBy(travelsTripPhotos.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "trip_photo",
        entityId: r.id,
        entityLabel: r.caption ?? null,
        thumbnailPath: r.storagePath,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "trip_document") {
    const rows = await db
      .select({
        id: travelsTripDocuments.id,
        originalFilename: travelsTripDocuments.originalFilename,
        storagePath: travelsTripDocuments.storagePath,
        deletedAt: travelsTripDocuments.deletedAt,
      })
      .from(travelsTripDocuments)
      .where(isNotNull(travelsTripDocuments.deletedAt))
      .orderBy(travelsTripDocuments.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "trip_document",
        entityId: r.id,
        entityLabel: r.originalFilename ?? null,
        thumbnailPath: null,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "reminder") {
    const rows = await db
      .select({
        id: reminders.id,
        title: reminders.title,
        deletedAt: reminders.deletedAt,
      })
      .from(reminders)
      .where(and(eq(reminders.entityType, "travels_trip"), isNotNull(reminders.deletedAt)))
      .orderBy(reminders.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "reminder",
        entityId: r.id,
        entityLabel: r.title,
        thumbnailPath: null,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  if (!entityTypeFilter || entityTypeFilter === "ornament") {
    const rows = await db
      .select({
        id: ornamentsItems.id,
        name: ornamentsItems.name,
        imagePath: ornamentsItems.imagePath,
        deletedAt: ornamentsItems.deletedAt,
      })
      .from(ornamentsItems)
      .where(isNotNull(ornamentsItems.deletedAt))
      .orderBy(ornamentsItems.deletedAt);
    for (const r of rows) {
      items.push({
        entityType: "ornament",
        entityId: r.id,
        entityLabel: r.name,
        thumbnailPath: r.imagePath,
        deletedAt: r.deletedAt!,
        expiresAt: addExpiry(r.deletedAt!),
      });
    }
  }

  // Sort all results newest-deleted-first.
  items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  res.json({ items, total: items.length });
});

/**
 * POST /recycle-bin/:entityType/:id/restore
 * Restores a soft-deleted item by clearing its deleted_at column.
 * Also cascades to restore child images / related rows deleted at the same time.
 */
router.post("/recycle-bin/:entityType/:id/restore", async (req, res) => {
  const { entityType, id: idStr } = req.params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = req.session.userId!;

  switch (entityType) {
    case "pottery_item": {
      const [row] = await db
        .select({ id: potteryItems.id })
        .from(potteryItems)
        .where(and(eq(potteryItems.id, id), isNotNull(potteryItems.deletedAt)));
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(potteryImages)
        .set({ deletedAt: null })
        .where(eq(potteryImages.itemId, id));
      await db
        .update(potteryItems)
        .set({ deletedAt: null })
        .where(eq(potteryItems.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_pottery_item",
        entityType: "pottery_item",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "fabric": {
      const [row] = await db
        .select({ id: fabrics.id })
        .from(fabrics)
        .where(and(eq(fabrics.id, id), isNotNull(fabrics.deletedAt)));
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(quiltingImages)
        .set({ deletedAt: null })
        .where(sql`entity_type = 'fabric' AND entity_id = ${id}`);
      await db
        .update(fabrics)
        .set({ deletedAt: null })
        .where(eq(fabrics.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_fabric",
        entityType: "fabric",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "pattern": {
      const [row] = await db
        .select({ id: quiltPatterns.id })
        .from(quiltPatterns)
        .where(
          and(eq(quiltPatterns.id, id), isNotNull(quiltPatterns.deletedAt)),
        );
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(quiltingImages)
        .set({ deletedAt: null })
        .where(sql`entity_type = 'pattern' AND entity_id = ${id}`);
      await db
        .update(quiltPatterns)
        .set({ deletedAt: null })
        .where(eq(quiltPatterns.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_pattern",
        entityType: "pattern",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "quilt": {
      const [row] = await db
        .select({ id: finishedQuilts.id })
        .from(finishedQuilts)
        .where(
          and(eq(finishedQuilts.id, id), isNotNull(finishedQuilts.deletedAt)),
        );
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(quiltingImages)
        .set({ deletedAt: null })
        .where(sql`entity_type = 'quilt' AND entity_id = ${id}`);
      await db
        .update(finishedQuilts)
        .set({ deletedAt: null })
        .where(eq(finishedQuilts.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_quilt",
        entityType: "quilt",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "trip": {
      const [row] = await db
        .select({ id: travelsTrips.id })
        .from(travelsTrips)
        .where(and(eq(travelsTrips.id, id), isNotNull(travelsTrips.deletedAt)));
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      // Restore the trip and all its directly-owned children.
      await db
        .update(travelsTripPhotos)
        .set({ deletedAt: null })
        .where(eq(travelsTripPhotos.tripId, id));
      await db
        .update(travelsTripDocuments)
        .set({ deletedAt: null })
        .where(eq(travelsTripDocuments.tripId, id));
      await db
        .update(reminders)
        .set({ deletedAt: null })
        .where(and(eq(reminders.entityType, "travels_trip"), eq(reminders.entityId, id)));
      await db
        .update(travelsTrips)
        .set({ deletedAt: null })
        .where(eq(travelsTrips.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_trip",
        entityType: "trip",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "trip_photo": {
      const [row] = await db
        .select({ id: travelsTripPhotos.id })
        .from(travelsTripPhotos)
        .where(
          and(
            eq(travelsTripPhotos.id, id),
            isNotNull(travelsTripPhotos.deletedAt),
          ),
        );
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(travelsTripPhotos)
        .set({ deletedAt: null })
        .where(eq(travelsTripPhotos.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_trip_photo",
        entityType: "trip_photo",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "trip_document": {
      const [row] = await db
        .select({ id: travelsTripDocuments.id })
        .from(travelsTripDocuments)
        .where(
          and(
            eq(travelsTripDocuments.id, id),
            isNotNull(travelsTripDocuments.deletedAt),
          ),
        );
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(travelsTripDocuments)
        .set({ deletedAt: null })
        .where(eq(travelsTripDocuments.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_trip_document",
        entityType: "trip_document",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "reminder": {
      const [row] = await db
        .select({ id: reminders.id })
        .from(reminders)
        .where(
          and(
            eq(reminders.id, id),
            eq(reminders.entityType, "travels_trip"),
            isNotNull(reminders.deletedAt),
          ),
        );
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(reminders)
        .set({ deletedAt: null })
        .where(eq(reminders.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_reminder",
        entityType: "reminder",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    case "ornament": {
      const [row] = await db
        .select({ id: ornamentsItems.id })
        .from(ornamentsItems)
        .where(
          and(eq(ornamentsItems.id, id), isNotNull(ornamentsItems.deletedAt)),
        );
      if (!row) {
        res.status(404).json({ error: "Item not found in recycle bin" });
        return;
      }
      await db
        .update(ornamentsImages)
        .set({ deletedAt: null })
        .where(eq(ornamentsImages.itemId, id));
      await db
        .update(ornamentsItems)
        .set({ deletedAt: null })
        .where(eq(ornamentsItems.id, id));
      void logActivity({
        actorUserId: userId,
        actorChannel: "web",
        actionType: "restore_ornament",
        entityType: "ornament",
        entityId: id,
        reversible: false,
      });
      res.json({ ok: true });
      return;
    }

    default:
      res.status(400).json({ error: `Unknown entity type: ${entityType}` });
      return;
  }
});

/**
 * GET /recycle-bin/count
 * Returns a count of all soft-deleted items, useful for badge indicators.
 */
router.get("/recycle-bin/count", async (_req, res) => {
  const tables = [
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(potteryItems)
      .where(isNotNull(potteryItems.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(fabrics)
      .where(isNotNull(fabrics.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(quiltPatterns)
      .where(isNotNull(quiltPatterns.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(finishedQuilts)
      .where(isNotNull(finishedQuilts.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(travelsTrips)
      .where(isNotNull(travelsTrips.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(travelsTripPhotos)
      .where(isNotNull(travelsTripPhotos.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(travelsTripDocuments)
      .where(isNotNull(travelsTripDocuments.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(reminders)
      .where(and(eq(reminders.entityType, "travels_trip"), isNotNull(reminders.deletedAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(ornamentsItems)
      .where(isNotNull(ornamentsItems.deletedAt)),
  ];
  const results = await Promise.all(tables);
  const total = results.reduce((sum, [r]) => sum + (r?.n ?? 0), 0);
  res.json({ total });
});

/**
 * GET /recycle-bin/activity-log
 * Returns a paginated household activity log.
 */
router.get("/recycle-bin/activity-log", async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10) || 50),
  );
  const offset = (page - 1) * pageSize;

  const { householdActivityLog } = await import("@workspace/db");
  const { desc, count: drizzleCount } = await import("drizzle-orm");

  const [{ value: total }] = await db
    .select({ value: drizzleCount() })
    .from(householdActivityLog);

  const rows = await db
    .select()
    .from(householdActivityLog)
    .orderBy(desc(householdActivityLog.occurredAt))
    .limit(pageSize)
    .offset(offset);

  res.json({ items: rows, total, page, pageSize });
});

export default router;
