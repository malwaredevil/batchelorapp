import { callModel, getModels } from "../ai-client";
import { asString, asStringArray, parseJson } from "../ai-parse";
import { resolveOrnamentDimensions } from "./dimensions";

export const EMBEDDING_DIMENSIONS = 1536;

export interface OrnamentAnalysis {
  name: string;
  seriesOrCollection: string | null;
  year: number | null;
  dimensions: string | null;
  dominantColors: string[];
  motifs: string[];
  aiDescription: string | null;
  boxDescription: string | null;
  /**
   * True when boxDescription above could not be transcribed from a legible
   * printed box-back text and was instead written by the AI as a stand-in.
   * False when boxDescription is a verbatim transcription (or null).
   */
  boxDescriptionGenerated: boolean;
  upc: string | null;
}

const ANALYSIS_PROMPT = `You are an expert Hallmark Keepsake ornament collector and cataloguer. You will be given one or more photos of the same Christmas ornament — box, tag, and/or the ornament itself.

Respond with STRICT JSON only, using exactly these keys:
- "name": the ornament's official printed name whenever it is visible. Hallmark boxes almost always print the ornament's name on the FRONT of the box, usually directly below the picture of the ornament (it may also appear on a tag or the box back). If you can read a printed name anywhere in the photos, use that printed name EXACTLY as written (title casing is fine; drop trademark symbols like ™/®) — do not invent your own descriptive name, do not paraphrase it, and do not add extra words. Only if no printed name is legible in any photo, fall back to a concise descriptive name you write yourself (e.g. "Snoopy and Woodstock Skating"). Under 12 words either way.
- "seriesOrCollection": the name of the Hallmark series or collection this ornament belongs to if visible on the box/tag or identifiable (e.g. "Fabulous Decade", "Star Trek", "Frosty Friends"), or null if not part of a numbered series.
- "year": the release/copyright year printed on the ornament, tag, or box (a 4-digit number), or null if not visible/determinable.
- "dimensions": only an explicitly stated physical-ornament measurement visible in the photos (for example printed directly on an ornament tag, or a measured ruler shot whose measurement clearly belongs to the ornament). Format it compactly, such as "3.5 in H × 2 in W × 1.25 in D". Never return a box, package, shipping, display, or unscaled visual estimate. Return null unless the evidence is explicit and reliable.
- "dominantColors": an array of 2-5 colour names describing the ornament, chosen from common colour names (e.g. red, gold, green, silver, white, blue).
- "motifs": an array of key recurring decorative elements or characters depicted (e.g. "Snoopy", "snowman", "holly").
- "aiDescription": 2-4 sentences describing the ornament as if writing a collector's catalogue entry.
- "boxDescription": if one of the photos clearly shows the printed descriptive text on the back or bottom of the box (the little paragraph telling the ornament's story), TRANSCRIBE THAT TEXT VERBATIM — exactly as printed, character for character, with no paraphrasing, summarizing, or added commentary — and set "boxDescriptionGenerated" to false. If no box is visible, or a box is visible but has no such printed text, or the text is present but not legible, DO NOT return null — instead WRITE YOUR OWN short (2-3 sentence) piece of box-style flavor text in the warm, story-telling tone Hallmark typically uses on the back of its ornament boxes, based on what the ornament depicts, and set "boxDescriptionGenerated" to true. Never claim invented text is verbatim.
- "boxDescriptionGenerated": boolean, true only when boxDescription above is text you wrote yourself per the fallback rule, false when it's an exact transcription of real printed text you could read.
- "upc": if a UPC/EAN barcode is visible anywhere in the photos (typically printed on the box, a sticker, or a tag), read the barcode digits underneath it and return them as a string of only digits (usually 12-13 digits). If no barcode is visible, or the digits are not clearly legible, return null. Never guess or fabricate digits.

When you find a printed name on the box, treat it as the authoritative identification and let it guide the rest of your answer — use it (together with your knowledge of the Hallmark Keepsake catalogue) to pin down the series, year, and description rather than guessing from the picture alone.

Do not include any commentary outside the JSON.`;

export async function analyzeOrnamentImage(
  dataUrls: string[],
  options: { resolveDimensions?: boolean } = {},
): Promise<OrnamentAnalysis> {
  const imageContent = dataUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  const models = await getModels();
  const completion = await callModel(models.fastVision, (c, model) =>
    c.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                dataUrls.length > 1
                  ? `Catalogue this Hallmark ornament. All ${dataUrls.length} photos show the same ornament. Respond with JSON only.`
                  : "Catalogue this Hallmark ornament. Respond with JSON only.",
            },
            ...imageContent,
          ],
        },
      ],
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJson(raw);

  const yearRaw = parsed?.["year"];
  const year =
    typeof yearRaw === "number" && Number.isFinite(yearRaw)
      ? Math.trunc(yearRaw)
      : typeof yearRaw === "string" && /^\d{4}$/.test(yearRaw.trim())
        ? parseInt(yearRaw.trim(), 10)
        : null;

  const upcRaw = asString(parsed?.["upc"]);
  const upcDigits = upcRaw ? upcRaw.replace(/\D/g, "") : null;
  const upc =
    upcDigits && upcDigits.length >= 8 && upcDigits.length <= 14
      ? upcDigits
      : null;

  const name = asString(parsed?.["name"]) ?? "Untitled ornament";
  const seriesOrCollection = asString(parsed?.["seriesOrCollection"]);
  const visualDimensions = asString(parsed?.["dimensions"]);
  const dimensions =
    options.resolveDimensions === false
      ? null
      : await resolveOrnamentDimensions({
          visualDimensions,
          identity: { name, seriesOrCollection, year },
        });

  return {
    name,
    seriesOrCollection,
    year,
    dimensions,
    dominantColors: asStringArray(parsed?.["dominantColors"]),
    motifs: asStringArray(parsed?.["motifs"]),
    aiDescription: asString(parsed?.["aiDescription"]),
    boxDescription: asString(parsed?.["boxDescription"]),
    boxDescriptionGenerated: parsed?.["boxDescriptionGenerated"] === true,
    upc,
  };
}

/**
 * Extract a barcode number from a photo using AI vision.
 * Used as the escape hatch when the native BarcodeDetector API and ZXing
 * both fail to scan a barcode from the live camera feed.
 *
 * @param imageDataUrl - A base64 data URL (data:image/jpeg;base64,...)
 * @returns The extracted barcode digits, or null if not found/legible.
 */
export async function extractBarcodeFromPhoto(
  imageDataUrl: string,
): Promise<string | null> {
  const models = await getModels();
  const completion = await callModel(models.fastVision, (c, model) =>
    c.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a barcode reader. Find and read the UPC or EAN barcode in the image.

Rules:
- Look for a 1D barcode (parallel vertical bars) and read the human-readable digits printed directly below or beside it.
- UPC-A barcodes are ALWAYS exactly 12 digits. EAN-13 barcodes are ALWAYS exactly 13 digits. Count every digit carefully — do not drop leading or trailing digits.
- Return the digits EXACTLY as printed. If the printed number has a leading zero or leading digit that is partially obscured, include it.
- Before returning, count the digits in your answer. If you get 11, you likely dropped a leading digit — look again.
- Return JSON with exactly one key: "barcode" — a string of the digit characters only (no spaces, no dashes), or null if no barcode is visible or legible.
- Never guess or fabricate any digit you cannot clearly see.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text: "Read the barcode in this image. Return JSON only.",
            },
            {
              type: "image_url" as const,
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJson(raw);
  const barcodeRaw =
    typeof parsed?.["barcode"] === "string" ? parsed["barcode"] : null;
  const digits = barcodeRaw ? barcodeRaw.replace(/\D/g, "") : null;
  return digits && digits.length >= 4 ? digits : null;
}

const APPRAISAL_PROMPT = `You are an expert Hallmark Keepsake ornament appraiser with deep knowledge of the collector market.

Given the photos and metadata provided, write a concise 2–3 sentence collector's appraisal. You MUST include:
- A specific estimated current market value range in USD (e.g. "$25–$45")
- The key factors driving that estimate (series position, year, condition, demand)
- A brief note on how value may change over time

Be direct and specific. Do not hedge with "it depends" — give your best estimate based on what you can see.
Do not use markdown formatting (no bold, no asterisks, no bullet points). Plain prose only.`;

export interface OrnamentMeta {
  name: string;
  brand: string | null;
  seriesOrCollection: string | null;
  year: number | null;
  condition: string | null;
  aiDescription: string | null;
  description?: string | null;
  barcodeValue?: string | null;
}

export async function appraiseOrnamentImage(
  dataUrls: string[],
  meta: OrnamentMeta,
): Promise<string> {
  const metaText = [
    `Name: ${meta.name}`,
    meta.brand ? `Brand: ${meta.brand}` : null,
    meta.seriesOrCollection ? `Series: ${meta.seriesOrCollection}` : null,
    meta.year ? `Year: ${meta.year}` : null,
    meta.condition ? `Condition: ${meta.condition}` : null,
    meta.aiDescription ? `Description: ${meta.aiDescription}` : null,
    meta.description ? `Box description: ${meta.description}` : null,
    meta.barcodeValue ? `UPC/Barcode: ${meta.barcodeValue}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const models = await getModels();
  const completion = await callModel(models.fastVision, (c, model) =>
    c.chat.completions.create({
      model,
      messages: [
        { role: "system", content: APPRAISAL_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text: `Appraise this ornament:\n\n${metaText}`,
            },
            ...dataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
      max_tokens: 300,
    }),
  );

  return (
    completion.choices[0]?.message?.content?.trim() ??
    "Unable to generate appraisal."
  );
}

// ---------------------------------------------------------------------------
// AI-suggested categories (#1077)
// ---------------------------------------------------------------------------

export interface OrnamentCollectionSignals {
  names: string[];
  series: string[];
  motifs: string[];
  colors: string[];
  brands: string[];
  notes: string[];
}

const CATEGORY_SUGGESTION_PROMPT = `You are helping organize a household's Hallmark ornament collection into browsable categories.

You will be given the distinct names, series/collections, motifs, dominant colors, brands, and notes already recorded across the household's ornaments. Propose a set of concise, reusable category names that reflect RECURRING themes actually present in this specific data — characters/franchises (e.g. "Peanuts", "Star Wars"), holiday motifs (e.g. "Snowmen", "Santas", "Angels"), or notable series names already used in the data.

Rules:
- Each name should be a short, reusable noun phrase (1-3 words) that plausibly applies to more than one ornament — never the specific name of a single ornament.
- Do not propose a category that duplicates or is a trivial variant (different casing, singular/plural, synonym) of one of the "Existing categories" listed below — those are already tracked.
- Only propose a category when you can see it recurring across more than one distinct ornament's data (name, series, or motifs). Do not invent categories with no evidence in the provided data.
- Do not propose vague catch-all categories like "Miscellaneous", "Other", or "Ornaments".
- Propose at most 15 categories, ordered with the ones covering the most ornaments first.

Respond with STRICT JSON only, using exactly this shape: {"categories": ["...", "..."]}. If nothing in the data supports a confident category, return {"categories": []}.`;

/**
 * Ask the model to propose category names for the given collection signals.
 * Pure AI call — the caller is responsible for gathering the signals from the
 * database and for filtering out names that already match an existing
 * category (see `suggestOrnamentCategories` in routes/ornaments/categories.ts).
 */
export async function suggestOrnamentCategoryNames(
  signals: OrnamentCollectionSignals,
  existingCategoryNames: string[],
): Promise<string[]> {
  const describe = (label: string, values: string[]) =>
    `${label}: ${values.length ? values.join(", ") : "(none recorded)"}`;

  const userContent = [
    `Existing categories (do not repeat these): ${
      existingCategoryNames.length
        ? existingCategoryNames.join(", ")
        : "(none yet)"
    }`,
    "",
    "Collection data:",
    describe("Names", signals.names),
    describe("Series/collections", signals.series),
    describe("Motifs", signals.motifs),
    describe("Colors", signals.colors),
    describe("Brands", signals.brands),
    describe("Notes", signals.notes),
    "",
    "Respond with JSON only.",
  ].join("\n");

  const models = await getModels();
  const completion = await callModel(models.fastVision, (c, model) =>
    c.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CATEGORY_SUGGESTION_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 1000,
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJson(raw);
  const arr = parsed?.["categories"];
  if (!Array.isArray(arr)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of arr) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 50) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 15) break;
  }
  return out;
}

export function buildEmbeddingText(analysis: OrnamentAnalysis): string {
  return [
    analysis.name,
    analysis.seriesOrCollection,
    analysis.year ? String(analysis.year) : null,
    ...analysis.motifs,
    ...analysis.dominantColors,
    analysis.aiDescription,
    analysis.boxDescription,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function embedText(text: string): Promise<number[]> {
  const models = await getModels();
  const response = await callModel(models.embedding, (c, model) =>
    c.embeddings.create({ model, input: text || " " }),
  );
  return response.data[0]?.embedding ?? [];
}
