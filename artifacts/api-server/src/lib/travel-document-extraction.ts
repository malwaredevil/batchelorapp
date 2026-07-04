// Shared travel-document AI extraction — used by the manual document upload
// flow (routes/travels/documents.ts) and the Gmail scan flow
// (lib/gmail-scan.ts) so both paths extract identical structured fields from
// a photo/PDF/attachment.
import type OpenAI from "openai";
import { callModelWithAdvisor, MODELS } from "./ai-client";

// Escalation guidance for the openrouter:advisor server tool: extraction
// mistakes here (wrong date, missed return leg) directly corrupt a trip's
// itinerary, so it's worth a stronger model's opinion whenever the
// FAST/SMART vision model is genuinely unsure — but not on every routine,
// clearly-legible document.
const DOCUMENT_ADVISOR_INSTRUCTIONS =
  "You are a meticulous travel-document reviewer. You will be asked to double-check a specific extracted date, time, or field against source text/an image. Read character-by-character, flag any ambiguity (e.g. DD/MM vs MM/DD, transposed digits, issue date vs travel date), and give your best final answer plus a one-line reason.";

const RESPONSE_SCHEMA_BLOCK = `{
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
}`;

const DATE_RULES = `IMPORTANT date-extraction rules:
- Many documents show several dates: the date the ticket/booking was ISSUED or PURCHASED, and the date(s) travel actually OCCURS. "departureDateTime" must be the actual travel departure date/time of the FIRST outbound leg — never the issue date, purchase date, or booking date. If separate "Issued on"/"Booked on" and "Departure"/"Travel date" fields exist, always prefer the travel date.
- If there are multiple flight legs/segments (e.g. a connection or a multi-city itinerary), use the departure date/time of the very first segment for "departureDateTime", and note any later legs in "notes".
- ROUND-TRIP TICKETS: if BOTH an outbound flight and a separate return/inbound flight are shown (a different flight number, and/or "from"/"to" reversed, and/or a later date), you MUST extract the return leg into the separate "returnFlightNumber", "returnFromLocation", "returnToLocation", "returnDepartureDateTime", and "returnArrivalDateTime" fields below — do not leave it only in "notes". Only fill these fields if a genuinely separate return leg is present; leave them out entirely for one-way tickets.
- Read every digit of the date and time carefully, character by character, before writing it out — transposed digits (e.g. reading "10:30" as "01:30", or "14" as "41") are a common and costly mistake. Double-check your extracted value against the source before finalizing it.
- Dates can be written ambiguously (e.g. "03/04/2026"). Use surrounding context (day-of-week labels, month names spelled out, airport/country of origin) to disambiguate DD/MM vs MM/DD. If genuinely ambiguous, state your best guess in "departureDateTime" and mention the ambiguity in "notes".
- Always output "departureDateTime" (and any other date/time field) as a full ISO 8601 string including year. Never omit the year or leave it as the current year by assumption if a different year is printed on the source.`;

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

export async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
): Promise<Record<string, unknown>> {
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const result = await callModelWithAdvisor(
    MODELS.SMART_VISION,
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
              {
                type: "text",
                text: `You are extracting structured information from a travel document (ticket, confirmation, rental agreement, boarding pass, hotel voucher, etc).

If any date, time, or field is genuinely ambiguous or hard to read, consult the advisor tool before finalizing your answer rather than guessing.

Today's date is ${new Date().toISOString().slice(0, 10)}. Use this only to sanity-check plausibility (travel dates are usually in the near future) — always trust the exact year, month, and day printed on the document itself over any assumption.

${DATE_RULES}

Return a JSON object with these fields (include only the ones that are present in the document):
${RESPONSE_SCHEMA_BLOCK}

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

  return parseAiExtractionJson(result);
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

  const result = await callModelWithAdvisor(
    MODELS.SMART_VISION,
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
            content: `You are extracting structured information from travel document text.

If any date, time, or field is genuinely ambiguous or hard to read, consult the advisor tool before finalizing your answer rather than guessing.

Document text:
${text}

Today's date is ${new Date().toISOString().slice(0, 10)}. Use this only to sanity-check plausibility (travel dates are usually in the near future) — always trust the exact year, month, and day printed in the text over any assumption.

${DATE_RULES}

Return a JSON object with these fields (include only the ones that are present):
${RESPONSE_SCHEMA_BLOCK}

Return ONLY valid JSON, no extra text.`,
          },
        ],
        max_tokens: 1000,
      });
      return resp.choices[0]?.message?.content ?? "{}";
    },
  );

  return parseAiExtractionJson(result);
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
  const result = await callModelWithAdvisor(
    MODELS.FAST_VISION,
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
