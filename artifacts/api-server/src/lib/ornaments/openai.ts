import { callModel, getModels } from "../ai-client";
import { asString, asStringArray, parseJson } from "../ai-parse";

export const EMBEDDING_DIMENSIONS = 1536;

export interface OrnamentAnalysis {
  name: string;
  seriesOrCollection: string | null;
  year: number | null;
  dimensions: string | null;
  dominantColors: string[];
  motifs: string[];
  aiDescription: string | null;
  upc: string | null;
}

const ANALYSIS_PROMPT = `You are an expert Hallmark Keepsake ornament collector and cataloguer. You will be given one or more photos of the same Christmas ornament — box, tag, and/or the ornament itself.

Respond with STRICT JSON only, using exactly these keys:
- "name": a concise, descriptive name for the ornament (e.g. "Snoopy and Woodstock Skating" or "1998 Fabulous Decade Snowman"). Under 12 words.
- "seriesOrCollection": the name of the Hallmark series or collection this ornament belongs to if visible on the box/tag or identifiable (e.g. "Fabulous Decade", "Star Trek", "Frosty Friends"), or null if not part of a numbered series.
- "year": the release/copyright year printed on the ornament, tag, or box (a 4-digit number), or null if not visible/determinable.
- "dimensions": approximate size if a ruler/reference is visible, otherwise null.
- "dominantColors": an array of 2-5 colour names describing the ornament, chosen from common colour names (e.g. red, gold, green, silver, white, blue).
- "motifs": an array of key recurring decorative elements or characters depicted (e.g. "Snoopy", "snowman", "holly").
- "aiDescription": 2-4 sentences describing the ornament as if writing a collector's catalogue entry.
- "upc": if a UPC/EAN barcode is visible anywhere in the photos (typically printed on the box, a sticker, or a tag), read the barcode digits underneath it and return them as a string of only digits (usually 12-13 digits). If no barcode is visible, or the digits are not clearly legible, return null. Never guess or fabricate digits.

Do not include any commentary outside the JSON.`;

export async function analyzeOrnamentImage(
  dataUrls: string[],
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

  return {
    name: asString(parsed?.["name"]) ?? "Untitled ornament",
    seriesOrCollection: asString(parsed?.["seriesOrCollection"]),
    year,
    dimensions: asString(parsed?.["dimensions"]),
    dominantColors: asStringArray(parsed?.["dominantColors"]),
    motifs: asStringArray(parsed?.["motifs"]),
    aiDescription: asString(parsed?.["aiDescription"]),
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
          content: `You are a barcode reader. Find and read the UPC or EAN barcode in the image. Look for 1D barcodes (parallel vertical bars) and read the digits printed below or next to them. Return JSON with exactly one key: "barcode" — a string containing only the barcode digits (typically 12–13 digits for UPC/EAN), or null if no barcode is visible or the digits cannot be clearly read. Never guess or fabricate digits.`,
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

export function buildEmbeddingText(analysis: OrnamentAnalysis): string {
  return [
    analysis.name,
    analysis.seriesOrCollection,
    analysis.year ? String(analysis.year) : null,
    ...analysis.motifs,
    ...analysis.dominantColors,
    analysis.aiDescription,
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
