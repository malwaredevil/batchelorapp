import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, travelsTripDocuments, travelsTrips } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { buildSaveToWalletUrl } from "../../lib/travels/google-wallet";

const router: IRouter = Router();
router.use(requireAuth);

router.post("/trips/:id/documents/:docId/wallet-pass", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(tripId) || isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [doc] = await db
    .select()
    .from(travelsTripDocuments)
    .where(and(eq(travelsTripDocuments.id, docId), eq(travelsTripDocuments.tripId, tripId)));
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [trip] = await db
    .select({ title: travelsTrips.title, destination: travelsTrips.destination })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  try {
    const saveUrl = await buildSaveToWalletUrl({
      documentId: doc.id,
      documentType: doc.documentType,
      originalFilename: doc.originalFilename,
      tripTitle: trip.title,
      tripDestination: trip.destination,
      extractedData: (doc.extractedData as Record<string, unknown> | null) ?? {},
    });
    res.json({ saveUrl });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not configured")) {
      res.status(503).json({ error: "Google Wallet is not configured" });
      return;
    }
    req.log.error({ err }, "Failed to build Google Wallet pass link");
    res.status(502).json({ error: "Failed to generate Wallet pass" });
  }
});

export default router;
