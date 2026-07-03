import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import multer from "multer";
import type OpenAI from "openai";
import { db, travelsTrips, travelsTripDocuments } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  uploadDocument,
  downloadDocument,
  deleteDocument,
} from "../../lib/travels-storage";
import { callModelWithAdvisor, MODELS } from "../../lib/ai-client";

// Escalation guidance for the openrouter:advisor server tool: extraction
// mistakes here (wrong date, missed return leg) directly corrupt a trip's
// itinerary, so it's worth a stronger model's opinion whenever the
// FAST/SMART vision model is genuinely unsure — but not on every routine,
// clearly-legible document.
const DOCUMENT_ADVISOR_INSTRUCTIONS =
  "You are a meticulous travel-document reviewer. You will be asked to double-check a specific extracted date, time, or field against source text/an image. Read character-by-character, flag any ambiguity (e.g. DD/MM vs MM/DD, transposed digits, issue date vs travel date), and give your best final answer plus a one-line reason.";

const router: IRouter = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

async function extractFromImage(buffer: Buffer, mimeType: string) {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const result = await callModelWithAdvisor(
    MODELS.SMART_VISION,
    DOCUMENT_ADVISOR_INSTRUCTIONS,
    async (client, model, tools) => {
      const resp = await client.chat.completions.create({
        model,
        ...(tools ? { tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] } : {}),
        messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are extracting structured information from a travel document (ticket, confirmation, rental agreement, boarding pass, hotel voucher, etc).

If any date, time, or field is genuinely ambiguous or hard to read, consult the advisor tool before finalizing your answer rather than guessing.

Today's date is ${new Date().toISOString().slice(0, 10)}. Use this only to sanity-check plausibility (travel dates are usually in the near future) — always trust the exact year, month, and day printed on the document itself over any assumption.

IMPORTANT date-extraction rules:
- Many documents show several dates: the date the ticket/booking was ISSUED or PURCHASED, and the date(s) travel actually OCCURS. "departureDateTime" must be the actual travel departure date/time of the FIRST outbound leg — never the issue date, purchase date, or booking date. If the document has separate "Issued on"/"Booked on" and "Departure"/"Travel date" fields, always prefer the travel date.
- If there are multiple flight legs/segments (e.g. a connection or a multi-city itinerary), use the departure date/time of the very first segment for "departureDateTime", and note any later legs in "notes".
- ROUND-TRIP TICKETS: if the document shows BOTH an outbound flight and a separate return/inbound flight (a different flight number, and/or "from"/"to" reversed, and/or a later date), you MUST extract the return leg into the separate "returnFlightNumber", "returnFromLocation", "returnToLocation", "returnDepartureDateTime", and "returnArrivalDateTime" fields below — do not leave it only in "notes". Only fill these fields if a genuinely separate return leg is present; leave them out entirely for one-way tickets.
- Read every digit of the date and time carefully, character by character, before writing it out — transposed digits (e.g. reading "10:30" as "01:30", or "14" as "41") are a common and costly mistake. Double-check your extracted value against the source text before finalizing it.
- Dates can be written ambiguously (e.g. "03/04/2026"). Use surrounding context (day-of-week labels, month names spelled out, airport/country of origin) to disambiguate DD/MM vs MM/DD. If genuinely ambiguous, state your best guess in "departureDateTime" and mention the ambiguity in "notes".
- Always output "departureDateTime" (and any other date/time field) as a full ISO 8601 string including year, e.g. "2026-08-14T10:30:00". Never omit the year or leave it as the current year by assumption if a different year is printed on the document.

Return a JSON object with these fields (include only the ones that are present in the document):
{
  "documentType": "flight_ticket | hotel_confirmation | car_rental | train_ticket | boarding_pass | travel_insurance | other",
  "providerName": "airline/hotel/rental company name",
  "referenceNumber": "booking/confirmation/ticket number",
  "passengerNames": ["name1", "name2"],
  "fromLocation": "departure city/airport",
  "toLocation": "destination city/airport",
  "departureDateTime": "ISO date-time string of the actual first-leg travel departure (NOT the issue/booking date)",
  "arrivalDateTime": "ISO date-time string if present",
  "checkInDate": "date string for hotels",
  "checkOutDate": "date string for hotels",
  "flightNumber": "flight number if applicable",
  "seatNumbers": ["seat numbers"],
  "vehicleClass": "car class if rental",
  "pickupLocation": "rental pickup location",
  "pickupDateTime": "ISO date-time string for rental pickup if present",
  "dropoffLocation": "rental dropoff location",
  "dropoffDateTime": "ISO date-time string for rental drop-off if present",
  "returnFlightNumber": "return/inbound flight number, ONLY if a separate return leg is present",
  "returnFromLocation": "return leg departure city/airport, ONLY if a separate return leg is present",
  "returnToLocation": "return leg destination city/airport, ONLY if a separate return leg is present",
  "returnDepartureDateTime": "ISO date-time string of the return leg departure, ONLY if a separate return leg is present",
  "returnArrivalDateTime": "ISO date-time string of the return leg arrival, ONLY if a separate return leg is present",
  "notes": "any other important information, including any date ambiguity or additional legs"
}

Return ONLY valid JSON, no extra text.`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
        ],
        max_tokens: 1000,
      });
      return resp.choices[0]?.message?.content ?? "{}";
    },
  );

  try {
    const stripped = result.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(stripped);
  } catch {
    return { notes: result };
  }
}

async function extractFromPdf(buffer: Buffer) {
  let text = "";
  try {
    const pdfParse = await import("pdf-parse");
    const parsed = await pdfParse.default(buffer);
    text = parsed.text.slice(0, 6000);
  } catch {
    return { notes: "Could not parse PDF text" };
  }

  const result = await callModelWithAdvisor(
    MODELS.SMART_VISION,
    DOCUMENT_ADVISOR_INSTRUCTIONS,
    async (client, model, tools) => {
      const resp = await client.chat.completions.create({
        model,
        ...(tools ? { tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] } : {}),
        messages: [
        {
          role: "user",
          content: `You are extracting structured information from travel document text.

If any date, time, or field is genuinely ambiguous or hard to read, consult the advisor tool before finalizing your answer rather than guessing.

Document text:
${text}

Today's date is ${new Date().toISOString().slice(0, 10)}. Use this only to sanity-check plausibility (travel dates are usually in the near future) — always trust the exact year, month, and day printed in the text over any assumption.

IMPORTANT date-extraction rules:
- Many documents show several dates: the date the ticket/booking was ISSUED or PURCHASED, and the date(s) travel actually OCCURS. "departureDateTime" must be the actual travel departure date/time of the FIRST outbound leg — never the issue date, purchase date, or booking date. If the text has separate "Issued on"/"Booked on" and "Departure"/"Travel date" fields, always prefer the travel date.
- If there are multiple flight legs/segments (e.g. a connection or a multi-city itinerary), use the departure date/time of the very first segment for "departureDateTime", and note any later legs in "notes".
- ROUND-TRIP TICKETS: if the text shows BOTH an outbound flight and a separate return/inbound flight (a different flight number, and/or "from"/"to" reversed, and/or a later date), you MUST extract the return leg into the separate "returnFlightNumber", "returnFromLocation", "returnToLocation", "returnDepartureDateTime", and "returnArrivalDateTime" fields below — do not leave it only in "notes". Only fill these fields if a genuinely separate return leg is present; leave them out entirely for one-way tickets.
- Read every digit of the date and time carefully, character by character, before writing it out — transposed digits (e.g. reading "10:30" as "01:30", or "14" as "41") are a common and costly mistake. Double-check your extracted value against the source text before finalizing it.
- Dates can be written ambiguously (e.g. "03/04/2026"). Use surrounding context (day-of-week labels, month names spelled out, airport/country of origin) to disambiguate DD/MM vs MM/DD. If genuinely ambiguous, state your best guess in "departureDateTime" and mention the ambiguity in "notes".
- Always output "departureDateTime" (and any other date/time field) as a full ISO 8601 string including year, e.g. "2026-08-14T10:30:00". Never omit the year or leave it as the current year by assumption if a different year is printed in the text.

Return a JSON object with these fields (include only the ones that are present):
{
  "documentType": "flight_ticket | hotel_confirmation | car_rental | train_ticket | boarding_pass | travel_insurance | other",
  "providerName": "airline/hotel/rental company name",
  "referenceNumber": "booking/confirmation/ticket number",
  "passengerNames": ["name1", "name2"],
  "fromLocation": "departure city/airport",
  "toLocation": "destination city/airport",
  "departureDateTime": "ISO date-time string of the actual first-leg travel departure (NOT the issue/booking date)",
  "arrivalDateTime": "ISO date-time string if present",
  "checkInDate": "date string for hotels",
  "checkOutDate": "date string for hotels",
  "flightNumber": "flight number if applicable",
  "seatNumbers": ["seat numbers"],
  "vehicleClass": "car class if rental",
  "pickupLocation": "rental pickup location",
  "pickupDateTime": "ISO date-time string for rental pickup if present",
  "dropoffLocation": "rental dropoff location",
  "dropoffDateTime": "ISO date-time string for rental drop-off if present",
  "returnFlightNumber": "return/inbound flight number, ONLY if a separate return leg is present",
  "returnFromLocation": "return leg departure city/airport, ONLY if a separate return leg is present",
  "returnToLocation": "return leg destination city/airport, ONLY if a separate return leg is present",
  "returnDepartureDateTime": "ISO date-time string of the return leg departure, ONLY if a separate return leg is present",
  "returnArrivalDateTime": "ISO date-time string of the return leg arrival, ONLY if a separate return leg is present",
  "notes": "any other important information, including any date ambiguity or additional legs"
}

Return ONLY valid JSON, no extra text.`,
        },
        ],
        max_tokens: 1000,
      });
      return resp.choices[0]?.message?.content ?? "{}";
    },
  );

  try {
    const stripped = result.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(stripped);
  } catch {
    return { notes: result };
  }
}

async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}

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

function parseDateTime(raw: string): { dateStr: string; timeStr: string } | null {
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?/);
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
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const provider = str(ed.providerName);
  const flightNumber = str(ed.flightNumber);
  const from = str(ed.fromLocation);
  const to = str(ed.toLocation);
  const hotelName = str(ed.hotelName) || provider;
  const notes = str(ed.notes);
  const arrival = str(ed.arrivalDateTime);

  const candidates: DocumentActivityCandidate[] = [];

  const dep = str(ed.departureDateTime) ? parseDateTime(str(ed.departureDateTime)) : null;
  if (dep) {
    const label = flightNumber ? `Flight ${flightNumber}` : provider ? `Departure — ${provider}` : "Departure";
    const tipParts = [arrival ? `Arrives ${arrival}` : "", notes].filter(Boolean);
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

  const checkIn = str(ed.checkInDate) ? parseDateTime(str(ed.checkInDate)) : null;
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

  const checkOut = str(ed.checkOutDate) ? parseDateTime(str(ed.checkOutDate)) : null;
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

  const pickup = str(ed.pickupDateTime) ? parseDateTime(str(ed.pickupDateTime)) : null;
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

  const dropoff = str(ed.dropoffDateTime) ? parseDateTime(str(ed.dropoffDateTime)) : null;
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
    const tipParts = [returnArrival ? `Arrives ${returnArrival}` : "", notes].filter(Boolean);
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

async function syncItineraryFromDocument(
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

  itinerary.days = itinerary.days.map((day) => ({
    ...day,
    activities: (day.activities ?? []).filter(
      (a) => a.sourceDocumentId !== docId,
    ),
  }));

  for (const c of candidates) {
    let day = itinerary.days.find((d) => d.date === c.dateStr);
    if (!day) {
      day = { date: c.dateStr, title: "Travel Day", activities: [] };
      itinerary.days.push(day);
    }
    day.activities.push({
      time: c.time,
      name: c.name,
      description: c.description,
      proximity: c.proximity,
      tip: c.tip,
      status: "tentative",
      sourceDocumentId: docId,
      sourceField: c.sourceField,
    });
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

router.post(
  "/trips/:id/documents",
  upload.single("file"),
  async (req, res) => {
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
      res
        .status(400)
        .json({ error: "Only PDF and image files are supported" });
      return;
    }

    const storagePath = await uploadDocument(buffer, mimetype, originalname);

    let extractedData: Record<string, unknown> = {};
    try {
      if (isPdf) {
        extractedData = await extractFromPdf(buffer);
      } else {
        extractedData = await extractFromImage(buffer, mimetype);
      }
    } catch (err) {
      req.log.warn({ err }, "OCR extraction failed — storing without data");
    }

    const [doc] = await db
      .insert(travelsTripDocuments)
      .values({
        tripId,
        userId,
        storagePath,
        documentType:
          (extractedData.documentType as string | undefined) ?? null,
        originalFilename: originalname,
        extractedData,
      })
      .returning();

    try {
      await syncItineraryFromDocument(tripId, doc!.id, extractedData);
    } catch (err) {
      req.log.warn({ err }, "Failed to sync itinerary from document");
    }

    res.status(201).json(doc);
  },
);

router.patch("/trips/:id/documents/:docId", async (req, res) => {
  const tripId = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(tripId) || isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { extractedData, lockedFields } = req.body as {
    extractedData?: Record<string, unknown>;
    lockedFields?: string[];
  };
  if (
    (!extractedData || typeof extractedData !== "object") &&
    !Array.isArray(lockedFields)
  ) {
    res
      .status(400)
      .json({ error: "extractedData object or lockedFields array is required" });
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
    : (existing.extractedData as Record<string, unknown> | null) ?? {};

  const updateValues: {
    extractedData?: Record<string, unknown>;
    lockedFields?: string[];
  } = {};
  if (extractedData) updateValues.extractedData = merged;
  if (Array.isArray(lockedFields)) updateValues.lockedFields = lockedFields;

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
      req.log.warn({ err }, "Failed to re-sync itinerary from corrected document");
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
      return { ok: false, status: 400, error: "Unsupported document type for rescan" };
    }
  } catch (err) {
    log.warn({ err }, "OCR re-extraction failed");
    return { ok: false, status: 502, error: "AI re-analysis failed, please try again" };
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

  const [updated] = await db
    .update(travelsTripDocuments)
    .set({
      extractedData: merged,
      documentType: locked.has("documentType")
        ? existing.documentType
        : ((merged.documentType as string | undefined) ?? existing.documentType),
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

  await db
    .delete(travelsTripDocuments)
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    );

  try {
    await syncItineraryFromDocument(tripId, docId, {});
  } catch (err) {
    req.log.warn({ err }, "Failed to purge itinerary entries for deleted document");
  }

  res.status(204).send();
});

router.get(
  "/trips/:id/documents/:docId/download",
  async (req, res) => {
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
  },
);

export default router;
