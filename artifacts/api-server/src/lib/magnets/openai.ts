/**
 * Magnet-specific AI vision helper.
 *
 * Inspects one or more photos of a souvenir/refrigerator magnet and returns
 * structured metadata suitable for auto-populating the item record. Borrows
 * the same callModel/getModels conventions used by the ornaments and quilting
 * AI helpers.
 */
import { callModel, getModels } from "../ai-client";
import { asString, asStringArray, parseJson } from "../ai-parse";

export interface MagnetAnalysis {
  name: string;
  description: string | null;
  /** 2-5 dominant colour names (e.g. "red", "gold"). */
  dominantColors: string[];
  /** Key decorative elements, subjects, or themes visible on the magnet. */
  motifs: string[];
  /** Suggested category names derived from the subject/theme/origin. */
  categories: string[];
}

const ANALYSIS_PROMPT = `You are an expert collector and cataloguer of souvenir and refrigerator magnets.
You will receive one or more photos of the same magnet.

Respond with STRICT JSON only, using exactly these keys:
- "name": a concise, accurate name for the magnet (under 12 words). If legible text printed on the magnet identifies it (e.g. a city name, landmark, or product name), use that. Otherwise write a brief descriptive name such as "Paris Eiffel Tower Photo Magnet" or "Vintage Coca-Cola Bottle Cap Magnet".
- "description": 1-3 sentences describing the magnet as if writing a collector's catalogue entry — cover the design, subject, style, and any notable features. Null only if the image is completely unrecognisable.
- "dominantColors": an array of 2-5 colour names visible on the magnet face (e.g. ["red", "white", "blue"]).
- "motifs": an array of up to 6 key subjects or decorative elements visible (e.g. ["Eiffel Tower", "Paris", "skyline"] or ["cartoon cat", "polka dots"]).
- "categories": an array of 1-4 short category labels that best classify this magnet, chosen from themes such as destination, landmark, pop culture, food, vintage, animal, sports, holiday, nature, artistic, novelty, or promotional. Keep each label concise (1-3 words, title case). Do not invent highly specific labels — prefer broad, reusable category names.

Do not include any commentary outside the JSON.`;

export async function analyzeMagnetImage(
  dataUrls: string[],
  lockedFields: string[],
): Promise<MagnetAnalysis> {
  void lockedFields; // reserved for future field-hint injection

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
                  ? `Catalogue this magnet. All ${dataUrls.length} photos show the same item. Respond with JSON only.`
                  : "Catalogue this magnet. Respond with JSON only.",
            },
            ...imageContent,
          ],
        },
      ],
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJson(raw);

  return {
    name: asString(parsed["name"]) ?? "Untitled magnet",
    description: asString(parsed["description"]),
    dominantColors: asStringArray(parsed["dominantColors"]),
    motifs: asStringArray(parsed["motifs"]),
    categories: asStringArray(parsed["categories"]).slice(0, 4),
  };
}
