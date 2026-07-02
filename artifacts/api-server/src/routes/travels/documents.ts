import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import multer from "multer";
import { db, travelsTrips, travelsTripDocuments } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import {
  uploadDocument,
  downloadDocument,
  deleteDocument,
} from "../../lib/travels-storage";
import { callModel, MODELS } from "../../lib/ai-client";

const router: IRouter = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

async function extractFromImage(buffer: Buffer, mimeType: string) {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const result = await callModel(MODELS.SMART_VISION, async (client, model) => {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are extracting structured information from a travel document (ticket, confirmation, rental agreement, boarding pass, hotel voucher, etc).

IMPORTANT date-extraction rules:
- Many documents show several dates: the date the ticket/booking was ISSUED or PURCHASED, and the date(s) travel actually OCCURS. "departureDateTime" must be the actual travel departure date/time of the FIRST outbound leg — never the issue date, purchase date, or booking date. If the document has separate "Issued on"/"Booked on" and "Departure"/"Travel date" fields, always prefer the travel date.
- If there are multiple flight legs/segments (e.g. a connection or a multi-city itinerary), use the departure date/time of the very first segment for "departureDateTime", and note any later legs in "notes".
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
  "dropoffLocation": "rental dropoff location",
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
  });

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

  const result = await callModel(MODELS.SMART_VISION, async (client, model) => {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: `You are extracting structured information from travel document text.

Document text:
${text}

IMPORTANT date-extraction rules:
- Many documents show several dates: the date the ticket/booking was ISSUED or PURCHASED, and the date(s) travel actually OCCURS. "departureDateTime" must be the actual travel departure date/time of the FIRST outbound leg — never the issue date, purchase date, or booking date. If the text has separate "Issued on"/"Booked on" and "Departure"/"Travel date" fields, always prefer the travel date.
- If there are multiple flight legs/segments (e.g. a connection or a multi-city itinerary), use the departure date/time of the very first segment for "departureDateTime", and note any later legs in "notes".
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
  "dropoffLocation": "rental dropoff location",
  "notes": "any other important information, including any date ambiguity or additional legs"
}

Return ONLY valid JSON, no extra text.`,
        },
      ],
      max_tokens: 1000,
    });
    return resp.choices[0]?.message?.content ?? "{}";
  });

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

  const { extractedData } = req.body as { extractedData?: Record<string, unknown> };
  if (!extractedData || typeof extractedData !== "object") {
    res.status(400).json({ error: "extractedData object is required" });
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

  const merged = {
    ...(existing.extractedData as Record<string, unknown> | null),
    ...extractedData,
  };

  const [updated] = await db
    .update(travelsTripDocuments)
    .set({ extractedData: merged })
    .where(
      and(
        eq(travelsTripDocuments.id, docId),
        eq(travelsTripDocuments.tripId, tripId),
      ),
    )
    .returning();

  res.json(updated);
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
