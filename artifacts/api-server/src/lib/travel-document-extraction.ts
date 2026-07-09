// Shared travel-document AI extraction — used by the manual document upload
// flow (routes/travels/documents.ts) and the Gmail scan flow
// (lib/gmail-scan.ts) so both paths extract identical structured fields from
// a photo/PDF/attachment.
import type OpenAI from "openai";
import jsQR from "jsqr";
import sharp from "sharp";
import {
  callModelWithAdvisor,
  callFusion,
  getModels,
  getFeatures,
  getThresholds,
} from "./ai-client";

// Best-effort QR decode for uploaded document images. This is purely
// supplementary to the AI vision extraction below — it never blocks or
// replaces it. Two cases where it earns its keep:
//   1. Exact confirmation-number/reference values instead of an OCR guess
//      (barcodes have no character-transposition risk).
//   2. QR codes that encode a URL with no corresponding visible text (e.g.
//      "add to wallet" / check-in links), which vision-only extraction can
//      never recover since there's nothing to read.
// Deliberately image-only (no PDF rasterization) to keep this a lightweight
// add-on rather than a new extraction pipeline; most PDFs already carry a
// text layer that pdf-parse reads directly.
async function decodeQrFromImage(buffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
      info.width,
      info.height,
    );
    return code?.data || null;
  } catch {
    return null;
  }
}

// Escalation guidance for the openrouter:advisor server tool: extraction
// mistakes here (wrong date, missed return leg) directly corrupt a trip's
// itinerary, so it's worth a stronger model's opinion whenever the
// FAST/SMART vision model is genuinely unsure — but not on every routine,
// clearly-legible document.
const DOCUMENT_ADVISOR_INSTRUCTIONS =
  "You are a meticulous travel-document reviewer. You will be asked to double-check a specific extracted date, time, or field against source text/an image. Read character-by-character, flag any ambiguity (e.g. DD/MM vs MM/DD, transposed digits, issue date vs travel date), and give your best final answer plus a one-line reason.";

const RESPONSE_SCHEMA_BLOCK = `{
  "title": "short human-friendly label (e.g. 'BA417 London → Rome · 15 Jul', 'Marriott Florence · 14–17 Jul', 'Europcar Milan pickup · 10 Aug'). Omit document type words like 'Booking' or 'Confirmation'.",
  "documentType": "flight_ticket | boarding_pass | hotel_confirmation | car_rental | train_ticket | bus_ticket | ferry | cruise | travel_insurance | visa | tour | activity | event_ticket | restaurant_reservation | airport_transfer | other",

  "providerName": "airline / hotel / car company / railway / ferry / cruise line / tour operator / restaurant / insurer / venue name",
  "referenceNumber": "booking, confirmation, ticket, or policy number",
  "passengerNames": ["array of passenger or guest names"],

  "fromLocation": "departure city, airport, station, port, venue address, or meeting point",
  "toLocation": "arrival city, airport, station, or drop-off location",

  "departureDateTime": "ISO date-time of first-leg departure / check-in / event / reservation — NOT the issue or purchase date",
  "arrivalDateTime": "ISO date-time of first-leg arrival if present",

  "checkInDate": "hotel/accommodation check-in date",
  "checkOutDate": "hotel/accommodation check-out date",

  "flightNumber": "flight designator (e.g. BA417)",
  "seatNumbers": ["array of seat, berth, or row numbers — flight, train, bus, event"],

  "vehicleClass": "car rental or transfer vehicle class / type (e.g. Economy, SUV)",
  "pickupLocation": "car rental or transfer pickup address / branch",
  "pickupDateTime": "ISO date-time of car rental pickup or transfer pickup",
  "dropoffLocation": "car rental drop-off address / branch",
  "dropoffDateTime": "ISO date-time of car rental drop-off",

  "trainNumber": "train service designator (e.g. IC1234, AVE 3141, TGV 6203, Eurostar 9030)",
  "busNumber": "bus or coach service / route number",
  "departureStation": "railway or bus station name at origin",
  "arrivalStation": "railway or bus station name at destination",
  "coachNumber": "carriage or coach number on a train",

  "ferryName": "vessel name for ferry or water transport",
  "departurePort": "departure port (ferry or cruise)",
  "arrivalPort": "arrival port (ferry)",
  "cabinNumber": "cabin or stateroom number (ferry or cruise)",

  "shipName": "cruise ship name",
  "disembarkationDate": "cruise disembarkation / end date",

  "activityName": "name of the tour, activity, excursion, or experience",
  "duration": "duration of tour or activity (e.g. '3 hours', 'full day')",

  "eventName": "concert, show, exhibition, museum, attraction, or event name",
  "venue": "venue name (events and activities)",

  "partySize": "number of guests for a restaurant reservation or group booking",

  "transferType": "ground transfer type (taxi, shuttle, private car, limousine, minibus)",

  "policyNumber": "insurance policy or certificate number",
  "coverageType": "travel insurance coverage type (e.g. Single Trip, Annual Multi-Trip, Backpacker)",
  "coverageStartDate": "insurance coverage start date",
  "coverageEndDate": "insurance coverage end date",
  "emergencyPhone": "24-hour emergency assistance phone number (insurance documents)",

  "visaType": "visa category (Tourist, Business, Transit, Student, Work, etc.)",
  "entryType": "single or multiple entry",
  "validFrom": "visa validity start date",
  "validTo": "visa validity end date",
  "issuedBy": "issuing country or authority (visa, ETA, ESTA, border pass)",

  "returnFlightNumber": "return/inbound flight number — ONLY if a separate return leg is present",
  "returnFromLocation": "return leg origin — ONLY if a separate return leg is present",
  "returnToLocation": "return leg destination — ONLY if a separate return leg is present",
  "returnDepartureDateTime": "ISO date-time of return leg departure — ONLY if a separate return leg is present",
  "returnArrivalDateTime": "ISO date-time of return leg arrival — ONLY if a separate return leg is present",

  "notes": "any other important information including ambiguities, extra legs, special conditions, or fields that didn't fit above"
}`;

const DATE_RULES = `IMPORTANT extraction rules by document type:

FLIGHTS & BOARDING PASSES: documentType = "flight_ticket" or "boarding_pass". Use "departureDateTime" for the actual travel departure (never the booking/issue date). For round-trips with a separate inbound leg shown, populate all "return*" fields. Multiple intermediate segments → use first segment for departureDateTime, note others.

TRAINS & RAIL: documentType = "train_ticket". Use "departureDateTime"/"arrivalDateTime" for travel times. Put service designator in "trainNumber" (e.g. "IC1234", "AVE 3141", "Eurostar 9032"). Put station names in "departureStation"/"arrivalStation". Do NOT use "flightNumber" for trains.

BUS & COACH: documentType = "bus_ticket". Use "departureDateTime"/"arrivalDateTime". Route or service number → "busNumber". Stop or terminal names → "departureStation"/"arrivalStation".

CAR RENTALS: documentType = "car_rental". Use "pickupDateTime"/"dropoffDateTime" (NOT "departureDateTime"/"arrivalDateTime"). Pickup and drop-off addresses/branch names → "pickupLocation"/"dropoffLocation". If both locations are the same, copy the value to both. Vehicle category → "vehicleClass".

AIRPORT TRANSFERS & TAXIS: documentType = "airport_transfer". Use "pickupDateTime" and "pickupLocation". Destination → "toLocation". Vehicle type → "vehicleClass" or "transferType".

FERRIES & WATER TRANSPORT: documentType = "ferry". Use "departureDateTime"/"arrivalDateTime". Port names → "departurePort"/"arrivalPort". Vessel name → "ferryName". Cabin/berth → "cabinNumber".

CRUISES: documentType = "cruise". Ship name → "shipName". Home port and embarkation date → "departurePort" and "departureDateTime". Disembarkation date → "disembarkationDate". Cabin → "cabinNumber".

HOTELS & ACCOMMODATION (Airbnb, hostel, villa, apartment, guesthouse): documentType = "hotel_confirmation". Check-in and check-out → "checkInDate"/"checkOutDate". Do NOT use "departureDateTime" for hotel dates.

TRAVEL INSURANCE: documentType = "travel_insurance". Policy number → "policyNumber". Insurer → "providerName". Coverage type → "coverageType". Coverage period → "coverageStartDate"/"coverageEndDate". Emergency phone → "emergencyPhone". Do NOT use "departureDateTime" for insurance dates.

VISAS & ENTRY DOCUMENTS (ETA, ESTA, eVisa, border pass): documentType = "visa". Issuing country or authority → "issuedBy". Visa category → "visaType". Entry restriction → "entryType". Validity period → "validFrom"/"validTo". Document number → "referenceNumber".

TOURS, ACTIVITIES & EXCURSIONS: documentType = "tour" or "activity". Activity name → "activityName". Operator → "providerName". Meeting point or address → "fromLocation". Start date/time → "departureDateTime". Duration → "duration" (e.g. "3 hours", "full day").

EVENTS, CONCERTS, SHOWS & ATTRACTIONS (museum, gallery, opera, theatre, festival): documentType = "event_ticket". Event name → "eventName". Venue → "venue". Date/time → "departureDateTime". Seat(s) → "seatNumbers". Organiser or venue operator → "providerName".

RESTAURANT RESERVATIONS: documentType = "restaurant_reservation". Restaurant name → "providerName". Reservation date/time → "departureDateTime". Number of guests → "partySize". Address → "fromLocation".

DATE FORMAT RULES (all document types):
- Never use the booking/issue/purchase date for any date field — always prefer the actual travel/event/stay date.
- Output ALL dates and times as full ISO 8601 strings with year (e.g. "2026-08-14T10:30:00"). Never omit the year.
- Read every digit character-by-character to avoid transpositions (e.g. "10:30" vs "01:30").
- Resolve DD/MM vs MM/DD ambiguity using context: day-of-week labels, month names, country of origin.`;

function parseAiExtractionJson(result: string): Record<string, unknown> {
  try {
    const stripped = result
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    return JSON.parse(stripped);
  } catch {
    return { notes: result };
  }
}

// The single-model extraction pass is considered "thin" (and worth escalating
// to the Fusion panel+judge tier) when it found almost nothing useful — e.g. a
// blurry photo or a document type the fast/smart vision model misread. Only
// count substantive fields, not "notes" (which is often just a raw-text dump
// on failure) or "documentType" (near-always guessable even from a bad read).
function isThinExtraction(fields: Record<string, unknown>): boolean {
  const substantive = Object.keys(fields).filter(
    (k) =>
      k !== "notes" &&
      k !== "documentType" &&
      fields[k] != null &&
      fields[k] !== "",
  );
  return substantive.length < 2;
}

export async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
): Promise<Record<string, unknown>> {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;
  const [models, thresholds, qrText] = await Promise.all([
    getModels(),
    getThresholds(),
    decodeQrFromImage(buffer),
  ]);

  const qrBlock = qrText
    ? `\n\nA QR code was detected on this document and decoded to the following raw value. If it clearly contains a confirmation/reference number, URL, or other structured value, prefer it over an OCR guess for the corresponding field (it's exact, not a visual read) — but only use it where it genuinely matches one of the schema fields below; if it's an unrelated tracking/security code, ignore it:\nDecoded QR value: ${qrText}`
    : "";

  const promptText = `You are extracting structured information from a travel document (ticket, confirmation, rental agreement, boarding pass, hotel voucher, etc).

If any date, time, or field is genuinely ambiguous or hard to read, consult the advisor tool before finalizing your answer rather than guessing.

Today's date is ${new Date().toISOString().slice(0, 10)}. Use this only to sanity-check plausibility (travel dates are usually in the near future) — always trust the exact year, month, and day printed on the document itself over any assumption.

${DATE_RULES}${qrBlock}

Return a JSON object with these fields (include only the ones that are present in the document):
${RESPONSE_SCHEMA_BLOCK}

Return ONLY valid JSON, no extra text.`;

  const result = await callModelWithAdvisor(
    models.smartVision,
    DOCUMENT_ADVISOR_INSTRUCTIONS,
    async (client, model, tools) => {
      const resp = await client.chat.completions.create({
        model,
        ...(tools
          ? {
              tools:
                tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
            }
          : {}),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: thresholds.travelDocExtractionMaxTokens,
      });
      return resp.choices[0]?.message?.content ?? "{}";
    },
  );

  const parsed = parseAiExtractionJson(result);
  const features = await getFeatures();
  if (!features.enableFusionTravelDocFallback || !isThinExtraction(parsed)) {
    return parsed;
  }

  try {
    const fused = await callFusion(
      () => [
        {
          role: "user",
          content: [
            { type: "text", text: promptText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      { maxTokens: thresholds.travelDocExtractionMaxTokens },
    );
    const fusedParsed = parseAiExtractionJson(fused);
    return isThinExtraction(fusedParsed) ? parsed : fusedParsed;
  } catch {
    return parsed;
  }
}

export async function extractFromPdf(
  buffer: Buffer,
): Promise<Record<string, unknown>> {
  let text = "";
  try {
    const pdfParse = await import("pdf-parse");
    const parsed = await pdfParse.default(buffer);
    text = parsed.text.slice(0, 6000);
  } catch {
    return { notes: "Could not parse PDF text" };
  }

  const [models, thresholds] = await Promise.all([
    getModels(),
    getThresholds(),
  ]);
  const promptText = `You are extracting structured information from travel document text.

If any date, time, or field is genuinely ambiguous or hard to read, consult the advisor tool before finalizing your answer rather than guessing.

Document text:
${text}

Today's date is ${new Date().toISOString().slice(0, 10)}. Use this only to sanity-check plausibility (travel dates are usually in the near future) — always trust the exact year, month, and day printed in the text over any assumption.

${DATE_RULES}

Return a JSON object with these fields (include only the ones that are present):
${RESPONSE_SCHEMA_BLOCK}

Return ONLY valid JSON, no extra text.`;

  const result = await callModelWithAdvisor(
    models.smartVision,
    DOCUMENT_ADVISOR_INSTRUCTIONS,
    async (client, model, tools) => {
      const resp = await client.chat.completions.create({
        model,
        ...(tools
          ? {
              tools:
                tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
            }
          : {}),
        messages: [{ role: "user", content: promptText }],
        max_tokens: thresholds.travelDocExtractionMaxTokens,
      });
      return resp.choices[0]?.message?.content ?? "{}";
    },
  );

  const parsed = parseAiExtractionJson(result);
  const features = await getFeatures();
  if (!features.enableFusionTravelDocFallback || !isThinExtraction(parsed)) {
    return parsed;
  }

  try {
    const fused = await callFusion(
      () => [{ role: "user", content: promptText }],
      {
        maxTokens: thresholds.travelDocExtractionMaxTokens,
      },
    );
    const fusedParsed = parseAiExtractionJson(fused);
    return isThinExtraction(fusedParsed) ? parsed : fusedParsed;
  } catch {
    return parsed;
  }
}

/**
 * Extracts structured travel fields from an email's plain-text body (no
 * image/attachment). Same schema as extractFromImage/extractFromPdf, plus a
 * leading isTravelRelated classification so the scanner can cheaply skip
 * non-travel mail without a second AI round-trip.
 */
export async function extractFromEmailText(
  subject: string,
  from: string,
  bodyText: string,
): Promise<Record<string, unknown> & { isTravelRelated: boolean }> {
  const models = await getModels();
  const result = await callModelWithAdvisor(
    models.fastVision,
    DOCUMENT_ADVISOR_INSTRUCTIONS,
    async (client, model, tools) => {
      const resp = await client.chat.completions.create({
        model,
        ...(tools
          ? {
              tools:
                tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
            }
          : {}),
        messages: [
          {
            role: "user",
            content: `You are scanning a household email inbox for travel bookings (flights, trains, hotels, car rentals). Decide whether this email is a genuine travel booking/confirmation, and if so extract structured fields.

Subject: ${subject}
From: ${from}
Body:
${bodyText}

Today's date is ${new Date().toISOString().slice(0, 10)}.

${DATE_RULES}

Return a JSON object with "isTravelRelated" (boolean — true only for actual booking confirmations/itineraries/e-tickets, false for newsletters, ads, receipts for unrelated purchases, or generic "your trip is coming up" marketing with no concrete booking details) plus these fields when isTravelRelated is true (include only the ones present):
${RESPONSE_SCHEMA_BLOCK}

Return ONLY valid JSON, no extra text. If isTravelRelated is false, return just {"isTravelRelated": false}.`,
          },
        ],
        max_tokens: 800,
      });
      return resp.choices[0]?.message?.content ?? "{}";
    },
  );

  const parsed = parseAiExtractionJson(result);
  return { isTravelRelated: false, ...parsed } as Record<string, unknown> & {
    isTravelRelated: boolean;
  };
}
