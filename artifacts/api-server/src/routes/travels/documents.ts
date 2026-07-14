import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import multer from "multer";
import {
  db,
  travelsTrips,
  travelsTripDocuments,
  travelsDocChunks,
  travelsGmailScanDecisions,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { tripExists } from "../../lib/travels/db-helpers";
import {
  uploadDocument,
  downloadDocument,
  deleteDocument,
} from "../../lib/travels-storage";
import {
  extractFromImage,
  extractFromPdf,
} from "../../lib/travel-document-extraction";
import { embedText } from "../../lib/openai";
import { logger } from "../../lib/logger";

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  const clean = text.replace(/\s+/g, " ").trim();
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.trim().length > 20);
}

export async function indexDocumentChunks(
  docId: number,
  rawText: string,
): Promise<void> {
  const chunks = chunkText(rawText);
  if (chunks.length === 0) return;
  try {
    await db
      .delete(travelsDocChunks)
      .where(eq(travelsDocChunks.tripDocumentId, docId));
    const embeddings = await Promise.all(chunks.map((c) => embedText(c)));
    await db.insert(travelsDocChunks).values(
      chunks.map((content, i) => ({
        tripDocumentId: docId,
        chunkIndex: i,
        content,
        embedding: embeddings[i]!,
      })),
    );
  } catch (err) {
    logger.warn({ err, docId }, "doc chunk indexing failed (non-fatal)");
  }
}

const router: IRouter = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

type ItineraryActivity = {
  time: string;
  name: string;
  description: string;
  proximity: string;
  tip: string;
  status?: "tentative" | "confirmed";
  sourceDocumentId?: number;
  sourceField?: string;
};

type ItineraryDay = {
  date: string;
  title: string;
  activities: ItineraryActivity[];
};

type Itinerary = { days: ItineraryDay[] };

function parseDateTime(
  raw: string,
): { dateStr: string; timeStr: string } | null {
  const isoMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?/,
  );
  if (isoMatch) {
    return { dateStr: isoMatch[1]!, timeStr: isoMatch[2] ?? "" };
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    const timeStr =
      parsed.getHours() || parsed.getMinutes()
        ? `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
        : "";
    return { dateStr, timeStr };
  }
  return null;
}

type DocumentActivityCandidate = {
  sourceField: string;
  dateStr: string;
  time: string;
  name: string;
  description: string;
  proximity: string;
  tip: string;
};

function computeDocumentActivities(
  ed: Record<string, unknown>,
): DocumentActivityCandidate[] {
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : "";
  const provider = str(ed.providerName);
  const flightNumber = str(ed.flightNumber);
  const from = str(ed.fromLocation);
  const to = str(ed.toLocation);
  const hotelName = str(ed.hotelName) || provider;
  const notes = str(ed.notes);
  const arrival = str(ed.arrivalDateTime);

  const candidates: DocumentActivityCandidate[] = [];

  const dep = str(ed.departureDateTime)
    ? parseDateTime(str(ed.departureDateTime))
    : null;
  if (dep) {
    const label = flightNumber
      ? `Flight ${flightNumber}`
      : provider
        ? `Departure — ${provider}`
        : "Departure";
    const tipParts = [arrival ? `Arrives ${arrival}` : "", notes].filter(
      Boolean,
    );
    candidates.push({
      sourceField: "departureDateTime",
      dateStr: dep.dateStr,
      time: dep.timeStr,
      name: from && to ? `${label}: ${from} → ${to}` : label,
      description: provider,
      proximity: "✈️",
      tip: tipParts.join(" — "),
    });
  }

  const checkIn = str(ed.checkInDate)
    ? parseDateTime(str(ed.checkInDate))
    : null;
  if (checkIn) {
    candidates.push({
      sourceField: "checkInDate",
      dateStr: checkIn.dateStr,
      time: checkIn.timeStr,
      name: `Hotel check-in${hotelName ? `: ${hotelName}` : ""}`,
      description: provider,
      proximity: "🏨",
      tip: notes,
    });
  }

  const checkOut = str(ed.checkOutDate)
    ? parseDateTime(str(ed.checkOutDate))
    : null;
  if (checkOut) {
    candidates.push({
      sourceField: "checkOutDate",
      dateStr: checkOut.dateStr,
      time: checkOut.timeStr,
      name: `Hotel check-out${hotelName ? `: ${hotelName}` : ""}`,
      description: provider,
      proximity: "🏨",
      tip: notes,
    });
  }

  const pickup = str(ed.pickupDateTime)
    ? parseDateTime(str(ed.pickupDateTime))
    : null;
  if (pickup) {
    candidates.push({
      sourceField: "pickupDateTime",
      dateStr: pickup.dateStr,
      time: pickup.timeStr,
      name: `Rental car pickup${provider ? `: ${provider}` : ""}`,
      description: str(ed.pickupLocation),
      proximity: "🚗",
      tip: notes,
    });
  }

  const dropoff = str(ed.dropoffDateTime)
    ? parseDateTime(str(ed.dropoffDateTime))
    : null;
  if (dropoff) {
    candidates.push({
      sourceField: "dropoffDateTime",
      dateStr: dropoff.dateStr,
      time: dropoff.timeStr,
      name: `Rental car drop-off${provider ? `: ${provider}` : ""}`,
      description: str(ed.dropoffLocation),
      proximity: "🚗",
      tip: notes,
    });
  }

  const returnFlightNumber = str(ed.returnFlightNumber);
  const returnFrom = str(ed.returnFromLocation);
  const returnTo = str(ed.returnToLocation);
  const returnArrival = str(ed.returnArrivalDateTime);

  const returnDep = str(ed.returnDepartureDateTime)
    ? parseDateTime(str(ed.returnDepartureDateTime))
    : null;
  if (returnDep) {
    const label = returnFlightNumber
      ? `Return flight ${returnFlightNumber}`
      : provider
        ? `Return — ${provider}`
        : "Return flight";
    const tipParts = [
      returnArrival ? `Arrives ${returnArrival}` : "",
      notes,
    ].filter(Boolean);
    candidates.push({
      sourceField: "returnDepartureDateTime",
      dateStr: returnDep.dateStr,
      time: returnDep.timeStr,
      name:
        returnFrom && returnTo
          ? `${label}: ${returnFrom} → ${returnTo}`
          : label,
      description: provider,
      proximity: "✈️",
      tip: tipParts.join(" — "),
    });
  }

  return candidates;
}

function isItinerary(value: unknown): value is Itinerary {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { days?: unknown }).days)
  );
}

/**
 * Key that identifies the "same real-world event" across multiple documents.
 * Two activities on the same date with the same sourceField (e.g.
 * "departureDateTime") almost certainly describe the same flight/booking —
 * one from the email body and one from the attached PDF, for example.
 */
function activityDedupeKey(date: string, sourceField: string): string {
  return `${date}::${sourceField}`;
}

/**
 * How "rich" an activity is — more characters in the combined name + tip +
 * description means more extracted detail. Used to pick the winner when two
 * documents both produce an activity for the same real-world event.
 */
function activityRichness(a: ItineraryActivity): number {
  return (
    (a.name?.length ?? 0) + (a.tip?.length ?? 0) + (a.description?.length ?? 0)
  );
}

export async function syncItineraryFromDocument(
  tripId: number,
  docId: number,
  extractedData: Record<string, unknown>,
): Promise<void> {
  const candidates = computeDocumentActivities(extractedData);

  const [trip] = await db
    .select({ itinerary: travelsTrips.itinerary })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  if (!trip) return;

  const itinerary: Itinerary = isItinerary(trip.itinerary)
    ? trip.itinerary
    : { days: [] };

  // Remove all activities previously synced from this document so re-syncing
  // is idempotent (existing behaviour, unchanged).
  itinerary.days = itinerary.days.map((day) => ({
    ...day,
    activities: (day.activities ?? []).filter(
      (a) => a.sourceDocumentId !== docId,
    ),
  }));

  // Build a lookup of existing activities from OTHER documents, keyed by
  // date::sourceField. This lets us detect when two documents describe the
  // same real-world event (e.g. email body + PDF attachment both containing
  // the same flight) and keep only the richer one rather than showing both.
  const existingByKey = new Map<
    string,
    { day: ItineraryDay; activity: ItineraryActivity }
  >();
  for (const day of itinerary.days) {
    for (const a of day.activities) {
      if (a.sourceDocumentId !== undefined && a.sourceField) {
        const key = activityDedupeKey(day.date, a.sourceField);
        existingByKey.set(key, { day, activity: a });
      }
    }
  }

  for (const c of candidates) {
    const key = activityDedupeKey(c.dateStr, c.sourceField);
    const existing = existingByKey.get(key);

    const newActivity: ItineraryActivity = {
      time: c.time,
      name: c.name,
      description: c.description,
      proximity: c.proximity,
      tip: c.tip,
      status: "tentative",
      sourceDocumentId: docId,
      sourceField: c.sourceField,
    };

    if (existing) {
      // Same real-world event from two different documents. Keep the richer
      // one and discard the thinner one — no duplicate in the itinerary.
      if (activityRichness(newActivity) > activityRichness(existing.activity)) {
        // New candidate is richer: replace the existing activity in-place.
        existing.day.activities = existing.day.activities.map((a) =>
          a === existing.activity ? newActivity : a,
        );
        existingByKey.set(key, { day: existing.day, activity: newActivity });
      }
      // Existing is richer (or equal): skip this candidate entirely.
    } else {
      // No duplicate — add normally.
      let day = itinerary.days.find((d) => d.date === c.dateStr);
      if (!day) {
        day = { date: c.dateStr, title: "Travel Day", activities: [] };
        itinerary.days.push(day);
      }
      day.activities.push(newActivity);
      existingByKey.set(key, { day, activity: newActivity });
    }
  }

  itinerary.days = itinerary.days.filter(
    (d) => !(d.title === "Travel Day" && d.activities.length === 0),
  );
  itinerary.days.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  await db
    .update(travelsTrips)
    .set({ itinerary })
    .where(eq(travelsTrips.id, tripId));
}

router.get("/trips/:id/documents", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const docs = await db
    .select()
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.tripId, tripId))
    .orderBy(asc(travelsTripDocuments.createdAt));

  res.json(docs);
});

router.post("/trips/:id/documents", upload.single("file"), async (req, res) => {
  const userId = req.session.userId!;
  const tripId = parseInt(req.params.id as string, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { buffer, mimetype, originalname } = req.file;
  const isPdf = mimetype === "application/pdf";
  const isImage = mimetype.startsWith("image/");

  if (!isPdf && !isImage) {
    res.status(400).json({ error: "Only PDF and image files are supported" });
    return;
  }

  const storagePath = await uploadDocument(buffer, mimetype, originalname);

  let extractedData: Record<string, unknown> = {};
  let rawText: string | null = null;
  try {
    if (isPdf) {
      try {
        const pdfParse = await import("pdf-parse");
        const parsed = await pdfParse.default(buffer);
        rawText = parsed.text.slice(0, 20000) || null;
      } catch {
        // non-fatal
      }
      extractedData = await extractFromPdf(buffer);
    } else {
      extractedData = await extractFromImage(buffer, mimetype);
      // For images, synthesize a text blob from the extracted structured data
      // so semantic search still covers image-based documents.
      const parts = Object.entries(extractedData)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${String(v)}`);
      if (parts.length > 0) rawText = parts.join("\n");
    }
  } catch (err) {
    req.log.warn({ err }, "OCR extraction failed — storing without data");
  }

  const userTitle =
    typeof req.body?.title === "string" && req.body.title.trim()
      ? req.body.title.trim()
      : null;
  const aiTitle = (extractedData.title as string | undefined) ?? null;

  const [doc] = await db
    .insert(travelsTripDocuments)
    .values({
      tripId,
      userId,
      storagePath,
      title: userTitle ?? aiTitle,
      documentType: (extractedData.documentType as string | undefined) ?? null,
      originalFilename: originalname,
      extractedData,
      rawText,
    })
    .returning();

  try {
    await syncItineraryFromDocument(tripId, doc!.id, extractedData);
  } catch (err) {
    req.log.warn({ err }, "Failed to sync itinerary from document");
  }

  // Fire-and-forget: chunk + embed rawText for semantic search (issue #99)
  if (rawText && doc) {
    indexDocumentChunks(doc.id, rawText).catch(() => {});
  }

  res.status(201).json(doc);
});

router.patch("/trips/:id/documents/:docId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(tripId) || isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { extractedData, lockedFields, title, documentType, iconOverride } =
    req.body as {
      extractedData?: Record<string, unknown>;
      lockedFields?: string[];
      title?: string | null;
      documentType?: string | null;
      iconOverride?: string | null;
    };
  const hasTitle = title !== undefined;
  const hasDocumentType = documentType !== undefined;
  const hasIconOverride = iconOverride !== undefined;
  if (
    (!extractedData || typeof extractedData !== "object") &&
    !Array.isArray(lockedFields) &&
    !hasTitle &&
    !hasDocumentType &&
    !hasIconOverride
  ) {
    res.status(400).json({
      error:
        "extractedData object, lockedFields array, title, documentType, or iconOverride is required",
    });
    return;
  }

  const [existing] = await db
    .select()
    .from(travelsTripDocuments)
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const merged = extractedData
    ? {
        ...(existing.extractedData as Record<string, unknown> | null),
        ...extractedData,
      }
    : ((existing.extractedData as Record<string, unknown> | null) ?? {});

  const updateValues: {
    extractedData?: Record<string, unknown>;
    lockedFields?: string[];
    title?: string | null;
    documentType?: string | null;
    iconOverride?: string | null;
  } = {};
  if (extractedData) updateValues.extractedData = merged;
  if (Array.isArray(lockedFields)) updateValues.lockedFields = lockedFields;
  if (hasTitle) updateValues.title = title ?? null;
  if (hasDocumentType) updateValues.documentType = documentType ?? null;
  if (hasIconOverride) updateValues.iconOverride = iconOverride ?? null;

  const [updated] = await db
    .update(travelsTripDocuments)
    .set(updateValues)
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    )
    .returning();

  if (extractedData) {
    try {
      await syncItineraryFromDocument(tripId, docId, merged);
    } catch (err) {
      req.log.warn(
        { err },
        "Failed to re-sync itinerary from corrected document",
      );
    }
  }

  res.json(updated);
});

export type RescanResult =
  | { ok: true; document: typeof travelsTripDocuments.$inferSelect }
  | { ok: false; status: number; error: string };

// Shared by the hand-written route below and the elAIne "rescan_document"
// assistant action so both re-analysis paths stay in lockstep. Never let a
// caller mutate a document outside its own tripId — this only looks up the
// document scoped to the tripId that was passed in.
export async function rescanTripDocument(
  tripId: number,
  docId: number,
  log: { warn: (obj: unknown, msg: string) => void },
): Promise<RescanResult> {
  const [existing] = await db
    .select()
    .from(travelsTripDocuments)
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    );

  if (!existing) {
    return { ok: false, status: 404, error: "Not found" };
  }

  const { buffer, contentType } = await downloadDocument(existing.storagePath);
  const isPdf = contentType === "application/pdf";
  const isImage = contentType.startsWith("image/");

  let freshData: Record<string, unknown> = {};
  try {
    if (isPdf) {
      freshData = await extractFromPdf(buffer);
    } else if (isImage) {
      freshData = await extractFromImage(buffer, contentType);
    } else {
      return {
        ok: false,
        status: 400,
        error: "Unsupported document type for rescan",
      };
    }
  } catch (err) {
    log.warn({ err }, "OCR re-extraction failed");
    return {
      ok: false,
      status: 502,
      error: "AI re-analysis failed, please try again",
    };
  }

  const existingData =
    (existing.extractedData as Record<string, unknown> | null) ?? {};
  const locked = new Set(existing.lockedFields ?? []);

  const merged: Record<string, unknown> = { ...existingData };
  for (const [key, value] of Object.entries(freshData)) {
    if (locked.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    merged[key] = value;
  }

  const freshTitle = (freshData.title as string | undefined) ?? null;
  const [updated] = await db
    .update(travelsTripDocuments)
    .set({
      extractedData: merged,
      documentType: locked.has("documentType")
        ? existing.documentType
        : ((merged.documentType as string | undefined) ??
          existing.documentType),
      title: locked.has("title")
        ? existing.title
        : (freshTitle ?? existing.title),
    })
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    )
    .returning();

  try {
    await syncItineraryFromDocument(tripId, docId, merged);
  } catch (err) {
    log.warn({ err }, "Failed to re-sync itinerary after rescan");
  }

  return { ok: true, document: updated! };
}

router.post("/trips/:id/documents/:docId/rescan", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(tripId) || isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const result = await rescanTripDocument(tripId, docId, req.log);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json(result.document);
});

router.delete("/trips/:id/documents/:docId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(tripId) || isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [doc] = await db
    .select()
    .from(travelsTripDocuments)
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    );

  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    await deleteDocument(doc.storagePath);
  } catch (err) {
    req.log.warn({ err }, "Storage delete failed — removing DB record anyway");
  }

  // Delete embedding chunks first — they have no FK cascade so they would
  // otherwise accumulate as orphans and pollute semantic search results.
  await db
    .delete(travelsDocChunks)
    .where(eq(travelsDocChunks.tripDocumentId, docId));

  await db
    .delete(travelsTripDocuments)
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    );

  // Strip the sourceDocumentId link from any itinerary activities that were
  // derived from this document, but keep the activities themselves — the user
  // may have already confirmed or edited them and shouldn't lose that work.
  try {
    const [tripRow] = await db
      .select({ itinerary: travelsTrips.itinerary })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, tripId));
    if (tripRow && isItinerary(tripRow.itinerary)) {
      const itinerary: Itinerary = {
        days: tripRow.itinerary.days.map((day) => ({
          ...day,
          activities: (day.activities ?? []).map((a) =>
            a.sourceDocumentId === docId
              ? { ...a, sourceDocumentId: undefined, sourceField: undefined }
              : a,
          ),
        })),
      };
      await db
        .update(travelsTrips)
        .set({ itinerary })
        .where(eq(travelsTrips.id, tripId));
    }
  } catch (err) {
    req.log.warn(
      { err },
      "Failed to detach itinerary activities from deleted document",
    );
  }

  // If this document was created by linking a Gmail email, that email's
  // scan-decision row still points at this now-deleted document and keeps
  // status "linked", which makes the email un-re-addable in the inbox
  // browser. Clear the orphaned decision so the email can be linked again.
  // Scoped to the document owner (who is the Gmail decision owner, since
  // Gmail access is always single-owner) plus the exact document id.
  try {
    await db
      .delete(travelsGmailScanDecisions)
      .where(
        and(
          eq(travelsGmailScanDecisions.userId, doc.userId),
          eq(travelsGmailScanDecisions.tripDocumentId, docId),
        ),
      );
  } catch (err) {
    req.log.warn(
      { err },
      "Failed to clear Gmail scan decision for deleted document",
    );
  }

  res.status(204).send();
});

router.get("/trips/:id/documents/:docId/download", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(tripId) || isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [doc] = await db
    .select()
    .from(travelsTripDocuments)
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    );

  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { buffer, contentType } = await downloadDocument(doc.storagePath);
  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${doc.originalFilename ?? "document"}"`,
  );
  res.send(buffer);
});

// -----------------------------------------------------------------------
// Unmatched-documents triage inbox. These are documents that arrived via a
// forwarded booking-confirmation email (source: "email_forward") whose
// attachment couldn't be confidently matched to an existing trip
// (status: "unmatched", tripId: null). Household-shared like everything
// else in travels — any authenticated member can view/assign/discard them,
// not just the household member the email was addressed to.
// -----------------------------------------------------------------------

router.get("/documents/unmatched", async (_req, res) => {
  const docs = await db
    .select()
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.status, "unmatched"))
    .orderBy(asc(travelsTripDocuments.createdAt));
  res.json(docs);
});

router.get("/documents/unmatched/count", async (_req, res) => {
  const docs = await db
    .select({ id: travelsTripDocuments.id })
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.status, "unmatched"));
  res.json({ count: docs.length });
});

router.patch("/documents/:docId/assign", async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  const { tripId } = req.body as { tripId?: number };
  if (isNaN(docId) || typeof tripId !== "number") {
    res.status(400).json({ error: "tripId (number) is required" });
    return;
  }

  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.id, docId));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const [updated] = await db
    .update(travelsTripDocuments)
    .set({ tripId, status: "linked" })
    .where(eq(travelsTripDocuments.id, docId))
    .returning();

  try {
    await syncItineraryFromDocument(
      tripId,
      docId,
      (existing.extractedData as Record<string, unknown> | null) ?? {},
    );
  } catch (err) {
    req.log.warn(
      { err },
      "Failed to sync itinerary after assigning unmatched document",
    );
  }

  res.json(updated);
});

router.delete("/documents/:docId", async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [doc] = await db
    .select()
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.id, docId));
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    await deleteDocument(doc.storagePath);
  } catch (err) {
    req.log.warn({ err }, "Storage delete failed — removing DB record anyway");
  }

  await db
    .delete(travelsTripDocuments)
    .where(eq(travelsTripDocuments.id, docId));

  res.status(204).send();
});

export default router;
