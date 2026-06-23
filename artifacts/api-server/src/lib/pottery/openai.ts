import OpenAI from "openai";
import { callModel, MODELS, getOpenAIClient } from "../ai-client";
import { classifyGlazeType } from "../visual-embed";
import {
  asString,
  asStringArray,
  asVerdict,
  parseJson,
  type Verdict,
} from "../ai-parse";

const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export type { Verdict };

// ---------------------------------------------------------------------------
// Surface zone analysis types
// ---------------------------------------------------------------------------

export interface PotterySurfaceZone {
  name: string;
  pattern: string | null;
  motifs: string[];
  symmetry: string | null;
}

export interface SurfaceZoneAnalysis {
  zones: PotterySurfaceZone[];
  patternComplexity: "plain" | "simple" | "moderate" | "complex";
  hasRepeatPattern: boolean;
  dominantZone: string | null;
}

// ---------------------------------------------------------------------------
// Main cataloguing types
// ---------------------------------------------------------------------------

export interface VisionAnalysis {
  name: string;
  patternDescription: string | null;
  style: string | null;
  shape: string | null;
  maker: string | null;
  makerInfo: string | null;
  dimensions: string | null;
  dominantColors: string[];
  motifs: string[];
  aiDescription: string | null;
  glazeType: string | null;
}

const ANALYSIS_PROMPT = `You are an expert ceramics and pottery cataloguer. You will be given one or more photos of the same pottery piece — different angles, front and back, or close-ups. Use every photo to build the most accurate assessment you can.

Respond with STRICT JSON only, using exactly these keys:
- "name": a concise, descriptive name that combines size (if measurable), the dominant decorative attribute, and the item type — in that order. The size you use in the name MUST be copied exactly from your "dimensions" answer — use the same snapped or rounded values, never different ones. Each inch value MUST use the ″ symbol followed immediately by its metric equivalent in parentheses, rounded to the nearest whole centimetre (1 inch = 2.54 cm). Use ONLY the ″ symbol for inches — never the word "in" or "inch". Choose the format that matches the piece type: (A) Single circular dimension (plates, bowls, round platters): '11″ (28 cm) Blue Willow Dinner Plate'. (B) Non-circular flat piece, top view only (trays, baking dishes, rectangular platters): '12″ (30 cm) × 8″ (20 cm) Blue Willow Serving Tray'. (C) Non-circular flat piece with depth measured from a side shot: '14″ (36 cm) × 6″ (15 cm) × 3″ (8 cm) Floral Oval Baking Dish'. (D) Upright vessel (mug, cup, vase, jug, pitcher) — diameter from top shot × height from side shot: '3″ (8 cm) × 5″ (13 cm) Blue Willow Mug'. If only one dimension is measurable, use that alone. (E) 3D sculptural piece with a circular footprint (round-base figurine, animal, bust) — diameter from top × height from front/side: '5″ (13 cm) × 10″ (25 cm) Snowman Figurine'. (F) 3D sculptural piece with a non-circular footprint — L × W from top × height from front/side: '6″ (15 cm) × 4″ (10 cm) × 9″ (23 cm) Cat Figurine'. Omit size entirely when no measurement is available (e.g. 'Spongeware Mixing Bowl'). Keep it concise — under 12 words including the size.
- "patternDescription": a detailed description of the decorative surface pattern and decoration. Focus on the pattern itself so two pieces with the same pattern would read alike. Use null if the piece is plain/undecorated.
- "style": the decorative style or technique (e.g. "Hand-painted Folk", "Blue-and-white Transferware", "Studio Stoneware") in Title Case, or null.
- "shape": the form of the piece (e.g. "Mug", "Dinner Plate", "Vase", "Bowl") in Title Case, or null.
- "maker": describe exactly what you can see in the maker's mark — any text, numbers, symbols, country of origin text, or stamp shape visible on the piece. Write in Title Case (e.g. "Johnson Brothers England" not "JOHNSON BROTHERS ENGLAND") even if the mark itself is stamped in capitals. Use null if no mark is visible.
- "makerInfo": using the mark you described in "maker" plus the piece's style, decoration, shape, and any other clues, write 2–5 sentences about the manufacturer: who they were, where and roughly when they operated, what they were known for, and anything notable about this specific pattern or range if you recognise it. Draw on your full knowledge of pottery history, manufacturers, and backstamp dating. Be honest about uncertainty — use "likely", "possibly", or "consistent with" when not certain. Use null only if no mark is visible and the piece gives no useful clues about its origin.
- "dimensions": if a Fiskars-style self-healing cutting mat is visible in any of the photos, measure the piece using the printed axis numbers. IMPORTANT — a back-of-piece shot (piece lying face-down on the mat, underside up) often shows the full footprint most clearly and is the best photo to use for sizing plates and bowls; prefer it over a face-up shot when both are available. Method: (1) Major grid lines = 1 inch (2.54 cm) apart; fine dot subdivisions = ⅛ inch (0.318 cm). (2) Top-down or bottom-up shot — SHAPE MATTERS: for circular/round pieces (plates, bowls, round platters) report diameter only; for non-circular pieces (rectangular, square, oval, trays, baking dishes, butter dishes, etc.) read the longest edge (length) AND the perpendicular edge (width), report as "L × W". (3) Side-on or front-on shots — apply the rule for the piece type: (a) Upright vessels (mugs, cups, vases, jugs, pitchers): side shot gives height. If a top-shot diameter was already measured, combine as "diameter × H". (b) Non-circular flat pieces (trays, baking dishes, casseroles): side or front shot gives depth — add as the third value so the result is "L × W × H" (depth is typically the smallest of the three). (c) 3D sculptural pieces (figurines, animals, character pieces, busts, statues): a front or side shot gives height (the tallest visible dimension); a second shot at roughly 90° to the first gives depth if it is visibly different from the width already measured from the top. Combine all available measurements: round footprint → "diameter × H"; non-round footprint → "L × W × H" where H is the tallest dimension (often the largest of the three). Ignore any hand visible in the frame — measure the ceramic only. (4) HOW TO MEASURE — a size is ALWAYS the DIFFERENCE between two axis readings, never a single axis number. Use null if no cutting mat is visible.
- "dominantColors": an array of 2-5 colour names chosen ONLY from this fixed palette: white, cream, ivory, beige, tan, brown, dark brown, terracotta, gold, yellow, orange, red, burgundy, pink, lavender, purple, light blue, sky blue, blue, cobalt blue, navy, teal, turquoise, green, sage, olive, grey, black. Pick the closest match from the palette — do not invent new names or use names not in this list.
- "motifs": an array of the key recurring decorative elements (e.g. "blue floral", "vine border", "geometric bands"). Empty array if plain.
- "aiDescription": write 2-4 sentences describing the piece as a whole — its appearance, character, and any notable features — as if writing a catalogue entry for a collector.

Do not include any commentary outside the JSON.`;

/** Unicode fraction → decimal inch value. */
const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

/**
 * Finds every inch measurement in a generated name (e.g. `11"`, `10½″`)
 * and ensures it is followed by the correct cm equivalent in parentheses.
 */
function addMetricToName(name: string): string {
  return name.replace(
    /(\d+)([½¼¾⅓⅔⅛⅜⅝⅞]?)([″"])\s*(?:\(\d+\s*cm\))?/g,
    (_match, whole: string, frac: string) => {
      const inches = parseInt(whole, 10) + (UNICODE_FRACTIONS[frac] ?? 0);
      const cm = Math.round(inches * 2.54);
      return `${whole}${frac}" (${cm} cm)`;
    },
  );
}

/**
 * Existing field values passed to the AI during re-analysis so it can use
 * user-confirmed ("locked") facts as bedrock context.
 */
export interface AnalysisContext {
  lockedFields: string[];
  name?: string | null;
  patternDescription?: string | null;
  style?: string | null;
  shape?: string | null;
  maker?: string | null;
  makerInfo?: string | null;
  dimensions?: string | null;
  dominantColors?: unknown;
  motifs?: unknown;
  glazeType?: string | null;
}

function buildContextBlock(ctx: AnalysisContext): string {
  const locked = new Set(ctx.lockedFields);

  const entries: Array<{ key: string; label: string; raw: unknown }> = [
    { key: "maker", label: "maker / backstamp", raw: ctx.maker },
    { key: "makerInfo", label: "maker background", raw: ctx.makerInfo },
    { key: "name", label: "name", raw: ctx.name },
    {
      key: "patternDescription",
      label: "pattern description",
      raw: ctx.patternDescription,
    },
    { key: "style", label: "style", raw: ctx.style },
    { key: "shape", label: "shape", raw: ctx.shape },
    { key: "dimensions", label: "dimensions", raw: ctx.dimensions },
    {
      key: "dominantColors",
      label: "dominant colours",
      raw: ctx.dominantColors,
    },
    { key: "motifs", label: "motifs", raw: ctx.motifs },
    { key: "glazeType", label: "glaze / decoration type", raw: ctx.glazeType },
  ];

  const lockedLines: string[] = [];
  const knownLines: string[] = [];

  for (const { key, label, raw } of entries) {
    if (raw == null) continue;
    if (Array.isArray(raw) && raw.length === 0) continue;
    if (typeof raw === "string" && raw.trim() === "") continue;

    let display: string;
    if (Array.isArray(raw)) {
      const strings = raw.filter(
        (v): v is string => typeof v === "string" && v.trim() !== "",
      );
      if (strings.length === 0) continue;
      display = strings.join(", ");
    } else if (typeof raw === "string") {
      display = raw.length > 600 ? raw.slice(0, 600) + "…" : raw;
    } else {
      continue;
    }

    const line = `  • ${label}: "${display}"`;
    if (locked.has(key)) {
      lockedLines.push(line);
    } else {
      knownLines.push(line);
    }
  }

  if (lockedLines.length === 0 && knownLines.length === 0) return "";

  const parts: string[] = [
    "EXISTING RECORD — use this as context when cataloguing:",
  ];

  if (lockedLines.length > 0) {
    parts.push(
      `\nLOCKED (user-confirmed hard truths — treat as certain facts; use them as bedrock to enrich all other fields):\n${lockedLines.join("\n")}`,
    );
  }
  if (knownLines.length > 0) {
    parts.push(
      `\nPREVIOUSLY KNOWN (AI-generated; keep if still accurate, improve if the photos show something better):\n${knownLines.join("\n")}`,
    );
  }

  return parts.join("\n");
}

export async function analyzeImage(
  dataUrls: string[],
  context?: AnalysisContext,
): Promise<VisionAnalysis> {
  const imageContent = dataUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  const contextBlock = context ? buildContextBlock(context) : "";
  const baseInstruction =
    dataUrls.length > 1
      ? `Catalogue this pottery piece. All ${dataUrls.length} photos show the same piece from different angles — use them all. Respond with JSON only.`
      : "Catalogue this pottery piece. Respond with JSON only.";
  const userText = contextBlock
    ? `${contextBlock}\n\n${baseInstruction}`
    : baseInstruction;

  const glazeIsLocked = context?.lockedFields.includes("glazeType") ?? false;

  const [completion, clipGlazeType] = await Promise.all([
    callModel(MODELS.FAST_VISION, (c, model) =>
      c.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ANALYSIS_PROMPT },
          {
            role: "user",
            content: [{ type: "text", text: userText }, ...imageContent],
          },
        ],
      }),
    ),
    glazeIsLocked
      ? Promise.resolve(null)
      : classifyGlazeType(dataUrls[0] ?? "").catch(() => null),
  ]);

  const raw = parseJson(completion.choices[0]?.message?.content ?? null);
  return {
    name: addMetricToName(asString(raw.name) ?? "Untitled piece"),
    patternDescription: asString(raw.patternDescription),
    style: asString(raw.style),
    shape: asString(raw.shape),
    maker: asString(raw.maker),
    makerInfo: asString(raw.makerInfo),
    dimensions: asString(raw.dimensions),
    dominantColors: asStringArray(raw.dominantColors),
    motifs: asStringArray(raw.motifs),
    aiDescription: asString(raw.aiDescription),
    glazeType: clipGlazeType ?? null,
  };
}

export function buildEmbeddingText(analysis: VisionAnalysis): string {
  return [
    analysis.patternDescription ?? "Plain undecorated pottery",
    analysis.style ? `Style: ${analysis.style}` : "",
    analysis.shape ? `Shape: ${analysis.shape}` : "",
    analysis.glazeType ? `Glaze: ${analysis.glazeType}` : "",
    analysis.motifs.length ? `Motifs: ${analysis.motifs.join(", ")}` : "",
    analysis.dominantColors.length
      ? `Colours: ${analysis.dominantColors.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(". ");
}

export async function embedText(text: string): Promise<number[]> {
  const response = await getOpenAIClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Surface zone analysis
// ---------------------------------------------------------------------------

const ZONE_ANALYSIS_PROMPT = `You are an expert ceramics analyst. Examine this pottery piece and analyse its decorative surface zones.

Identify each distinct zone of the piece that is visible. Only include zones with meaningful decoration or noteworthy characteristics.

Respond with STRICT JSON only:
{
  "zones": [
    {
      "name": "body",
      "pattern": "Blue Willow transfer-print scene with willow tree, bridge, and pagoda",
      "motifs": ["willow tree", "bridge", "pagoda", "birds"],
      "symmetry": "non-repeating"
    }
  ],
  "patternComplexity": "complex",
  "hasRepeatPattern": false,
  "dominantZone": "body"
}

Rules:
- "name" must be one of: rim, body, shoulder, foot, interior, handle, spout
- "pattern" describes the specific decoration in that zone — null if plain/undecorated
- "motifs" lists the distinct design elements visible in that zone — empty array if none
- "symmetry" is one of: radial, bilateral, all-over, non-repeating — null if plain
- "patternComplexity" is one of: plain (undecorated), simple (one motif), moderate (2-3 motifs), complex (intricate scene or dense pattern)
- "hasRepeatPattern" is true if the same design element repeats around or across the surface
- "dominantZone" is the zone name with the most significant decoration — null if wholly undecorated

Do not include any commentary outside the JSON.`;

export async function analyzePotteryZones(
  dataUrls: string[],
): Promise<SurfaceZoneAnalysis | null> {
  const imageContent = dataUrls.slice(0, 3).map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  try {
    const completion = await callModel(MODELS.SMART_VISION, (c, model) =>
      c.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        max_tokens: 1024,
        messages: [
          { role: "system", content: ZONE_ANALYSIS_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyse the decorative zones of this pottery piece. Respond with JSON only.",
              },
              ...imageContent,
            ],
          },
        ],
      }),
    );

    const raw = parseJson(completion.choices[0]?.message?.content ?? null);
    if (!raw || typeof raw !== "object") return null;

    const rawZones = Array.isArray(raw.zones) ? raw.zones : [];
    const zones: PotterySurfaceZone[] = rawZones
      .filter(
        (z): z is Record<string, unknown> =>
          z != null && typeof z === "object",
      )
      .map((z) => ({
        name: asString(z.name) ?? "body",
        pattern: asString(z.pattern),
        motifs: asStringArray(z.motifs),
        symmetry: asString(z.symmetry),
      }));

    const complexity = asString(raw.patternComplexity);
    const validComplexities = ["plain", "simple", "moderate", "complex"] as const;
    const patternComplexity = validComplexities.includes(
      complexity as (typeof validComplexities)[number],
    )
      ? (complexity as SurfaceZoneAnalysis["patternComplexity"])
      : "simple";

    return {
      zones,
      patternComplexity,
      hasRepeatPattern: raw.hasRepeatPattern === true,
      dominantZone: asString(raw.dominantZone),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Backstamp-focused maker identification
// ---------------------------------------------------------------------------

const BACKSTAMP_PROMPT = `You are an expert ceramics appraiser specialising in pottery maker's marks and backstamps.

Examine all photos carefully — especially any shot showing the underside or bottom of the piece. Focus specifically on:
- Printed or transfer-printed backstamps
- Impressed or incised marks in the clay
- Hand-painted marks or signatures
- Country of origin text (e.g. "Made in England", "Bavaria")
- Pattern names, numbers, or series codes

Respond with STRICT JSON only:
{
  "backstampFound": true,
  "maker": "Full description of the mark exactly as it appears — e.g. 'Royal Doulton England' or 'Johnson Brothers Made in England'. Title Case even if the mark is in capitals.",
  "makerInfo": "2–5 sentences about the manufacturer: who they were, where they operated, roughly when, and anything notable about this specific mark or pattern if identifiable. Use 'likely', 'possibly', or 'consistent with' for uncertainty."
}

If no mark is visible in any photo, respond:
{ "backstampFound": false, "maker": null, "makerInfo": null }

Do not include any commentary outside the JSON.`;

/**
 * Focused backstamp identification pass — runs when the main analysis found
 * no maker information. Asks the model to concentrate specifically on maker's
 * marks. Returns null when nothing is identified or on any error.
 */
export async function locateBackstampAndEnhanceMaker(
  dataUrls: string[],
): Promise<{ maker: string | null; makerInfo: string | null } | null> {
  const imageContent = dataUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  try {
    const completion = await callModel(MODELS.SMART_VISION, (c, model) =>
      c.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        max_tokens: 512,
        messages: [
          { role: "system", content: BACKSTAMP_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Focus on any maker's mark or backstamp visible on this piece. Respond with JSON only.",
              },
              ...imageContent,
            ],
          },
        ],
      }),
    );

    const raw = parseJson(completion.choices[0]?.message?.content ?? null);
    if (!raw || raw.backstampFound !== true) return null;

    const maker = asString(raw.maker);
    if (!maker) return null;

    return {
      maker,
      makerInfo: asString(raw.makerInfo),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Collection comparison
// ---------------------------------------------------------------------------

export interface CompareMatchInput {
  index: number;
  imageUrl: string;
  extraImageUrls: string[];
  name: string;
  patternDescription: string | null;
  style: string | null;
  motifs: string[];
  similarity: number;
}

export interface CompareMatchVerdict {
  samePattern: Verdict;
  exactPiece: Verdict;
  explanation: string;
}

export interface CompareVerdictResult {
  summary: string;
  ownsSamePattern: Verdict;
  ownsExactPiece: Verdict;
  perMatch: Record<number, CompareMatchVerdict>;
}

const COMPARE_PROMPT = `You are a specialist pottery appraiser comparing a CANDIDATE photo against pieces in a private collection. Your job is to give the owner a confident, useful answer — not a vague hedge.

Each existing piece is labelled with a PATTERN SIMILARITY SCORE (0–1) computed from AI-extracted textual descriptions of both pieces. Use these scores as your primary guide:
- Score ≥ 0.80: very strong evidence the patterns are the same. You should say "yes" for samePattern unless the photos show clearly different decoration.
- Score 0.60–0.79: good evidence. Look carefully at the photos to confirm or rule out a pattern match.
- Score < 0.50: patterns are probably different, but still examine the photos.

Differences in photo angle, lighting, background, or framing do NOT indicate different pieces. Ignore photographic conditions — focus only on the decoration, pattern, colours, and form of the pottery itself.

For EACH existing piece, give:
- "samePattern": "yes" — the decorative pattern visually matches; "no" — it clearly does not; "maybe" — reserved for genuine ambiguity only (e.g. the candidate photo is blurry or partially obscures the pattern). Do NOT use "maybe" as a default or safety blanket.
- "exactPiece": "yes" — same pattern AND same shape/size (likely the same physical object); "no" — same pattern but different form, or clearly different piece; "maybe" — same pattern but shape or size is inconclusive from the photos.
- "explanation": one or two specific, concrete sentences. Reference what you actually see (colours, motifs, border style, shape). A non-expert should be able to read this and understand exactly why you reached your verdict.

Then give an overall verdict:
- "ownsSamePattern": "yes" if any perMatch is "yes"; "maybe" only if all pattern matches are "maybe"; "no" if none match.
- "ownsExactPiece": same logic across the exactPiece verdicts.
- "summary": 1–3 direct sentences. If the owner already owns this pattern or piece, say so plainly. If not, say so. Mention that exact-piece judgements from photos carry some uncertainty.

Respond with STRICT JSON only:
{
  "summary": string,
  "ownsSamePattern": "yes"|"maybe"|"no",
  "ownsExactPiece": "yes"|"maybe"|"no",
  "matches": { "<index>": { "samePattern": ..., "exactPiece": ..., "explanation": ... } }
}
The <index> keys must match the indices labelled in the message.`;

export async function compareWithMatches(params: {
  candidateDataUrl: string;
  candidate: VisionAnalysis;
  matches: CompareMatchInput[];
}): Promise<CompareVerdictResult> {
  const { candidateDataUrl, candidate, matches } = params;

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `CANDIDATE piece attributes:\n${JSON.stringify(
        {
          patternDescription: candidate.patternDescription,
          style: candidate.style,
          shape: candidate.shape,
          motifs: candidate.motifs,
          dominantColors: candidate.dominantColors,
          glazeType: candidate.glazeType,
        },
        null,
        2,
      )}\nCandidate photo:`,
    },
    { type: "image_url", image_url: { url: candidateDataUrl } },
  ];

  for (const match of matches) {
    const photoCount = 1 + match.extraImageUrls.length;
    content.push({
      type: "text",
      text: `Existing piece index ${match.index} — "${match.name}" (pattern similarity score ${match.similarity.toFixed(
        2,
      )}). Stored attributes: ${JSON.stringify({
        patternDescription: match.patternDescription,
        style: match.style,
        motifs: match.motifs,
      })}. ${photoCount > 1 ? `${photoCount} photos follow (different angles of the same piece):` : "Photo:"}`,
    });
    content.push({ type: "image_url", image_url: { url: match.imageUrl } });
    for (const extra of match.extraImageUrls) {
      content.push({ type: "image_url", image_url: { url: extra } });
    }
  }

  const completion = await callModel(MODELS.SMART_VISION, (c, model) =>
    c.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: COMPARE_PROMPT },
        { role: "user", content },
      ],
    }),
  );

  const raw = parseJson(completion.choices[0]?.message?.content ?? null);
  const rawMatches =
    typeof raw.matches === "object" && raw.matches !== null
      ? (raw.matches as Record<string, unknown>)
      : {};

  const perMatch: Record<number, CompareMatchVerdict> = {};
  for (const match of matches) {
    const entry = rawMatches[String(match.index)];
    const obj =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : {};
    perMatch[match.index] = {
      samePattern: asVerdict(obj.samePattern),
      exactPiece: asVerdict(obj.exactPiece),
      explanation:
        asString(obj.explanation) ??
        "No detailed comparison was available for this piece.",
    };
  }

  return {
    summary:
      asString(raw.summary) ?? "Compared the photo against your collection.",
    ownsSamePattern: asVerdict(raw.ownsSamePattern),
    ownsExactPiece: asVerdict(raw.ownsExactPiece),
    perMatch,
  };
}
