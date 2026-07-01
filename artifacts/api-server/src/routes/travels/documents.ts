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

Return a JSON object with these fields (include only the ones that are present in the document):
{
  "documentType": "flight_ticket | hotel_confirmation | car_rental | train_ticket | boarding_pass | travel_insurance | other",
  "providerName": "airline/hotel/rental company name",
  "referenceNumber": "booking/confirmation/ticket number",
  "passengerNames": ["name1", "name2"],
  "fromLocation": "departure city/airport",
  "toLocation": "destination city/airport",
  "departureDateTime": "ISO date-time string if present",
  "arrivalDateTime": "ISO date-time string if present",
  "checkInDate": "date string for hotels",
  "checkOutDate": "date string for hotels",
  "flightNumber": "flight number if applicable",
  "seatNumbers": ["seat numbers"],
  "vehicleClass": "car class if rental",
  "pickupLocation": "rental pickup location",
  "dropoffLocation": "rental dropoff location",
  "notes": "any other important information"
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

Return a JSON object with these fields (include only the ones that are present):
{
  "documentType": "flight_ticket | hotel_confirmation | car_rental | train_ticket | boarding_pass | travel_insurance | other",
  "providerName": "airline/hotel/rental company name",
  "referenceNumber": "booking/confirmation/ticket number",
  "passengerNames": ["name1", "name2"],
  "fromLocation": "departure city/airport",
  "toLocation": "destination city/airport",
  "departureDateTime": "ISO date-time string if present",
  "arrivalDateTime": "ISO date-time string if present",
  "checkInDate": "date string for hotels",
  "checkOutDate": "date string for hotels",
  "flightNumber": "flight number if applicable",
  "seatNumbers": ["seat numbers"],
  "vehicleClass": "car class if rental",
  "pickupLocation": "rental pickup location",
  "dropoffLocation": "rental dropoff location",
  "notes": "any other important information"
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
