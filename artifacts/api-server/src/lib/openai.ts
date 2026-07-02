import OpenAI from "openai";
import {
  callModel,
  callModelWithAdvisor,
  callWithFallback,
  getOpenAIClient,
  MODELS,
} from "./ai-client";
import { classifyPrintType } from "./visual-embed";
import {
  asString,
  asStringArray,
  asVerdict,
  parseJson,
  type Verdict,
} from "./ai-parse";

const VISION_MODEL = "gpt-4o-mini";
const COMPARE_MODEL = "gpt-4o";
const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export type { Verdict };

export interface VisionAnalysis {
  name: string;
  lineName: string | null;
  designer: string | null;
  manufacturer: string | null;
  colorway: string | null;
  printType: string | null;
  fiberContent: string | null;
  dominantColors: string[];
  motifs: string[];
  styleDescriptors: string[];
  aiDescription: string | null;
}

const ANALYSIS_PROMPT = `You are an expert quilting fabric cataloguer with deep knowledge of fabric manufacturers, designers, and collections. You will be given one or more photos of the same fabric — different angles, close-ups, or selvage shots. Use every photo to build the most accurate assessment you can.

Respond with STRICT JSON only, using exactly these keys:

- "name": a concise, descriptive name for cataloguing purposes. Combine the most recognisable characteristic with the fabric type, e.g. "Blue Floral Batik", "Red and White Plaid Shirting", "Modern Geometric Cotton Print". If you can identify the fabric line or collection name, lead with that, e.g. "Moda Sanctuary Floral". Keep it under 10 words.

- "lineName": the fabric line or collection name if visible on the selvage or recognisable from the print (e.g. "Sanctuary", "Grunge", "Bella Solids"), or null if not identifiable.

- "designer": the designer's name if visible on the selvage or recognisable (e.g. "Zen Chic", "Bonnie & Camille", "Tula Pink"), or null if not identifiable.

- "manufacturer": the fabric manufacturer or brand if visible on the selvage or recognisable (e.g. "Moda", "Riley Blake", "Robert Kaufman", "Free Spirit"), or null if not identifiable.

- "colorway": the specific colourway name or description if visible on the selvage (e.g. "Bluebell", "Crimson"), or a short descriptive colour combination if not (e.g. "navy and cream"), or null.

- "printType": the primary print/design type. Choose the single best match from: solid, print, geometric, floral, stripe, plaid, check, batik, novelty, abstract, watercolour, text, animal, holiday, landscape, other.

- "fiberContent": the fibre content if visible on the selvage (e.g. "100% cotton", "cotton/linen blend"), or your best assessment from the fabric's appearance (e.g. "likely 100% cotton"), or null.

- "dominantColors": an array of 2–5 colour names chosen ONLY from this fixed palette: white, cream, ivory, beige, tan, brown, dark brown, gold, yellow, orange, red, burgundy, pink, lavender, purple, light blue, sky blue, blue, cobalt blue, navy, teal, turquoise, green, sage, olive, grey, charcoal, black. Pick the closest match — do not invent names outside this list.

- "motifs": an array of the key recurring design elements visible in the fabric (e.g. "roses", "geometric triangles", "text", "cats", "chevrons", "polka dots"). Empty array if solid or if no distinct motifs.

- "styleDescriptors": an array of 1–3 style words that best describe this fabric's aesthetic. Choose from: modern, traditional, vintage, rustic, whimsical, elegant, bold, subtle, masculine, feminine, gender-neutral, juvenile, holiday, coastal, farmhouse, boho, art-deco, minimalist, maximalist.

- "aiDescription": write 2–3 sentences describing the fabric as a whole — its visual character, likely uses in quilting, and any notable features — as if writing a catalogue entry for a quilter.

Do not include any commentary outside the JSON.`;

export interface AnalysisContext {
  lockedFields: string[];
  name?: string | null;
  lineName?: string | null;
  designer?: string | null;
  manufacturer?: string | null;
  colorway?: string | null;
  printType?: string | null;
  fiberContent?: string | null;
  dominantColors?: unknown;
  motifs?: unknown;
  styleDescriptors?: unknown;
}

function buildContextBlock(ctx: AnalysisContext): string {
  const locked = new Set(ctx.lockedFields);

  const entries: Array<{ key: string; label: string; raw: unknown }> = [
    { key: "lineName", label: "fabric line / collection", raw: ctx.lineName },
    { key: "designer", label: "designer", raw: ctx.designer },
    { key: "manufacturer", label: "manufacturer", raw: ctx.manufacturer },
    { key: "colorway", label: "colorway", raw: ctx.colorway },
    { key: "name", label: "name", raw: ctx.name },
    { key: "printType", label: "print type", raw: ctx.printType },
    { key: "fiberContent", label: "fibre content", raw: ctx.fiberContent },
    {
      key: "dominantColors",
      label: "dominant colours",
      raw: ctx.dominantColors,
    },
    { key: "motifs", label: "motifs", raw: ctx.motifs },
    {
      key: "styleDescriptors",
      label: "style descriptors",
      raw: ctx.styleDescriptors,
    },
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
      display = raw.length > 400 ? raw.slice(0, 400) + "…" : raw;
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
      `\nLOCKED (user-confirmed hard truths — treat as certain facts):\n${lockedLines.join("\n")}`,
    );
  }
  if (knownLines.length > 0) {
    parts.push(
      `\nPREVIOUSLY KNOWN (AI-generated; keep if still accurate, improve if photos show something better):\n${knownLines.join("\n")}`,
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
      ? `Catalogue this quilt fabric. All ${dataUrls.length} photos show the same fabric — use them all, including any selvage shots that show manufacturer/designer information. Respond with JSON only.`
      : "Catalogue this quilt fabric. Respond with JSON only.";
  const userText = contextBlock
    ? `${contextBlock}\n\n${baseInstruction}`
    : baseInstruction;

  // Run GPT analysis and CLIP zero-shot print-type classification in parallel.
  // CLIP result wins when available; GPT extraction is the fallback.
  const clipIsLocked = context?.lockedFields.includes("printType") ?? false;
  const [completion, clipPrintType] = await Promise.all([
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
    clipIsLocked
      ? Promise.resolve(null)
      : classifyPrintType(dataUrls[0] ?? "").catch(() => null),
  ]);

  const raw = parseJson(completion.choices[0]?.message?.content ?? null);
  return {
    name: asString(raw.name) ?? "Untitled fabric",
    lineName: asString(raw.lineName),
    designer: asString(raw.designer),
    manufacturer: asString(raw.manufacturer),
    colorway: asString(raw.colorway),
    printType: clipPrintType ?? asString(raw.printType),
    fiberContent: asString(raw.fiberContent),
    dominantColors: asStringArray(raw.dominantColors),
    motifs: asStringArray(raw.motifs),
    styleDescriptors: asStringArray(raw.styleDescriptors),
    aiDescription: asString(raw.aiDescription),
  };
}

export function buildEmbeddingText(analysis: VisionAnalysis): string {
  return [
    analysis.printType ? `Print type: ${analysis.printType}` : "",
    analysis.lineName ? `Line: ${analysis.lineName}` : "",
    analysis.designer ? `Designer: ${analysis.designer}` : "",
    analysis.manufacturer ? `Manufacturer: ${analysis.manufacturer}` : "",
    analysis.colorway ? `Colorway: ${analysis.colorway}` : "",
    analysis.motifs.length ? `Motifs: ${analysis.motifs.join(", ")}` : "",
    analysis.dominantColors.length
      ? `Colours: ${analysis.dominantColors.join(", ")}`
      : "",
    analysis.styleDescriptors.length
      ? `Style: ${analysis.styleDescriptors.join(", ")}`
      : "",
    analysis.fiberContent ? `Fibre: ${analysis.fiberContent}` : "",
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
// Pattern image analysis
// ---------------------------------------------------------------------------

export interface PatternAnalysis {
  name: string;
  designer: string | null;
  blockSize: string | null;
  difficulty: string | null;
  notes: string | null;
}

const PATTERN_ANALYSIS_PROMPT = `You are an expert quilt pattern cataloguer. You will be given a photo of a quilt pattern — it may be a block diagram, a finished quilt that showcases a pattern, or a pattern booklet.

Respond with STRICT JSON only, using exactly these keys:

- "name": a concise descriptive name for this pattern, e.g. "Flying Geese", "Log Cabin", "Half Square Triangle Star". Keep it under 10 words.

- "designer": the pattern designer's name if visible or recognisable, or null.

- "blockSize": the block size if visible or inferrable (e.g. "6 inch", "12 inch blocks"), or null.

- "difficulty": the difficulty level — choose one of: beginner, intermediate, advanced — or null if you cannot assess.

- "notes": 1-2 sentences describing the pattern's visual character and techniques required, or null.

Do not include any commentary outside the JSON.`;

export async function analyzePatternImage(
  dataUrls: string[],
  lockedFields: string[],
  existing?: {
    name?: string | null;
    designer?: string | null;
    blockSize?: string | null;
    difficulty?: string | null;
  },
): Promise<PatternAnalysis> {
  const imageContent = dataUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));
  const locked = new Set(lockedFields);
  const contextLines: string[] = [];
  if (existing) {
    const fields: Array<[string, string | null | undefined]> = [
      ["name", existing.name],
      ["designer", existing.designer],
      ["blockSize", existing.blockSize],
      ["difficulty", existing.difficulty],
    ];
    for (const [key, val] of fields) {
      if (!val) continue;
      contextLines.push(
        locked.has(key)
          ? `  • ${key}: "${val}" (LOCKED — preserve exactly)`
          : `  • ${key}: "${val}" (improve if the photo reveals better information)`,
      );
    }
  }
  const contextBlock =
    contextLines.length > 0
      ? `Existing record — use as context:\n${contextLines.join("\n")}\n\n`
      : "";

  const completion = await callModelWithAdvisor(
    MODELS.FAST_VISION,
    "You are a quilting-pattern expert. You will be asked to double-check an ambiguous or partially-legible pattern name, designer credit, or block size printed on a quilt pattern. Give your best identification and a one-line reason, or say clearly if it's genuinely unidentifiable.",
    (c, model, tools) =>
      c.chat.completions.create({
        model,
        ...(tools ? { tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PATTERN_ANALYSIS_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${contextBlock}Analyse this quilt pattern image and respond with JSON only. If the pattern name, designer, or block size is unclear or ambiguous, consult the advisor tool before finalizing.`,
              },
              ...imageContent,
            ],
          },
        ],
        max_tokens: 512,
      }),
  );

  const raw = parseJson(completion.choices[0]?.message?.content ?? null);
  return {
    name: locked.has("name")
      ? (existing?.name ?? "Untitled pattern")
      : (asString(raw.name) ?? existing?.name ?? "Untitled pattern"),
    designer: locked.has("designer")
      ? (existing?.designer ?? null)
      : asString(raw.designer),
    blockSize: locked.has("blockSize")
      ? (existing?.blockSize ?? null)
      : asString(raw.blockSize),
    difficulty: locked.has("difficulty")
      ? (existing?.difficulty ?? null)
      : asString(raw.difficulty),
    notes: locked.has("notes") ? null : asString(raw.notes),
  };
}

// ---------------------------------------------------------------------------
// Quilt image analysis
// ---------------------------------------------------------------------------

export interface QuiltAnalysis {
  name: string;
  notes: string | null;
}

const QUILT_ANALYSIS_PROMPT = `You are an expert quilter cataloguing a finished quilt from a photo.

Respond with STRICT JSON only, using exactly these keys:

- "name": a concise, descriptive name for this quilt, e.g. "Blue Star Sampler", "Scrappy Log Cabin Throw", "Pink Baby Quilt". Keep it under 10 words.

- "notes": 1-2 sentences describing the quilt's colour palette, pattern style, and approximate size if estimable, or null.

Do not include any commentary outside the JSON.`;

export async function analyzeQuiltImage(
  dataUrls: string[],
  lockedFields: string[],
  existing?: { name?: string | null },
): Promise<QuiltAnalysis> {
  const imageContent = dataUrls.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));
  const locked = new Set(lockedFields);
  const contextLines: string[] = [];
  if (existing?.name) {
    contextLines.push(
      locked.has("name")
        ? `  • name: "${existing.name}" (LOCKED — preserve exactly)`
        : `  • name: "${existing.name}" (may update if photo suggests a better name)`,
    );
  }
  const contextBlock =
    contextLines.length > 0
      ? `Existing record:\n${contextLines.join("\n")}\n\n`
      : "";

  const completion = await callModel(MODELS.FAST_VISION, (c, model) =>
    c.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: QUILT_ANALYSIS_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${contextBlock}Analyse this finished quilt image and respond with JSON only.`,
            },
            ...imageContent,
          ],
        },
      ],
      max_tokens: 256,
    }),
  );

  const raw = parseJson(completion.choices[0]?.message?.content ?? null);
  return {
    name: locked.has("name")
      ? (existing?.name ?? "Untitled quilt")
      : (asString(raw.name) ?? existing?.name ?? "Untitled quilt"),
    notes: locked.has("notes") ? null : asString(raw.notes),
  };
}

// ---------------------------------------------------------------------------
// Fabric comparison
// ---------------------------------------------------------------------------

export interface CompareMatchInput {
  index: number;
  imageUrl: string;
  extraImageUrls: string[];
  name: string;
  lineName: string | null;
  designer: string | null;
  printType: string | null;
  motifs: string[];
  dominantColors: string[];
  similarity: number;
}

export interface CompareMatchVerdict {
  samePattern: Verdict;
  exactFabric: Verdict;
  explanation: string;
}

export interface CompareVerdictResult {
  summary: string;
  ownsSamePattern: Verdict;
  ownsExactFabric: Verdict;
  perMatch: Record<number, CompareMatchVerdict>;
}

const COMPARE_PROMPT = `You are a specialist quilting fabric expert comparing a CANDIDATE fabric photo against fabrics in a private collection. Your job is to give the owner a confident, useful answer — not a vague hedge.

The owner wants to know: "Do I already own this fabric?" This matters because buying duplicate fabrics is wasteful and frustrating.

Each existing fabric is labelled with a PATTERN SIMILARITY SCORE (0–1) computed from AI-extracted textual descriptions:
- Score ≥ 0.80: very strong evidence the fabrics are the same print/pattern. Say "yes" for samePattern unless photos clearly show different decoration.
- Score 0.60–0.79: good evidence. Look carefully at the photos to confirm or rule out a match.
- Score < 0.50: patterns are probably different, but still examine the photos.

Differences in photo angle, lighting, or folding do NOT indicate different fabrics. Focus on the print design, colours, motifs, and style.

For EACH existing fabric, give:
- "samePattern": "yes" — same print/design; "no" — clearly different; "maybe" — only for genuine ambiguity (blurry photo, obscured pattern). Do NOT use "maybe" as a default.
- "exactFabric": "yes" — same print AND same colourway (same fabric, possibly even the same bolt); "no" — same print but different colourway, or clearly different; "maybe" — same print but colourway is inconclusive.
- "explanation": one or two specific, concrete sentences referencing what you actually see (colours, motifs, print structure). A non-expert quilter should understand exactly why you reached your verdict.

Then give an overall verdict:
- "ownsSamePattern": "yes" if any perMatch samePattern is "yes"; "maybe" only if all are "maybe"; "no" if none match.
- "ownsExactFabric": same logic across exactFabric verdicts.
- "summary": 1–3 direct sentences. If the owner already owns this fabric, say so plainly. If not, say so clearly.

Respond with STRICT JSON only:
{
  "summary": string,
  "ownsSamePattern": "yes"|"maybe"|"no",
  "ownsExactFabric": "yes"|"maybe"|"no",
  "matches": { "<index>": { "samePattern": ..., "exactFabric": ..., "explanation": ... } }
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
      text: `CANDIDATE fabric attributes:\n${JSON.stringify(
        {
          printType: candidate.printType,
          lineName: candidate.lineName,
          designer: candidate.designer,
          motifs: candidate.motifs,
          dominantColors: candidate.dominantColors,
          styleDescriptors: candidate.styleDescriptors,
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
      text: `Existing fabric index ${match.index} — "${match.name}" (pattern similarity score ${match.similarity.toFixed(
        2,
      )}). Stored attributes: ${JSON.stringify({
        lineName: match.lineName,
        designer: match.designer,
        printType: match.printType,
        motifs: match.motifs,
        dominantColors: match.dominantColors,
      })}. ${photoCount > 1 ? `${photoCount} photos follow (different angles of the same fabric):` : "Photo:"}`,
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
      exactFabric: asVerdict(obj.exactFabric),
      explanation:
        asString(obj.explanation) ??
        "No detailed comparison was available for this fabric.",
    };
  }

  return {
    summary:
      asString(raw.summary) ?? "Compared the photo against your collection.",
    ownsSamePattern: asVerdict(raw.ownsSamePattern),
    ownsExactFabric: asVerdict(raw.ownsExactFabric),
    perMatch,
  };
}

// ---------------------------------------------------------------------------
// Block seam detection
// ---------------------------------------------------------------------------

export interface DetectedSeam {
  axis: "h" | "v";
  pos: number;
  cellIdx: number;
}

export interface DetectedDiagSeam {
  diagType: "nwse" | "nesw";
  row: number;
  col: number;
}

export interface DetectSeamsResult {
  seams: DetectedSeam[];
  diagSeams: DetectedDiagSeam[];
}

export async function detectBlockSeams(
  imageDataUrl: string,
  gridW: number,
  gridH: number,
): Promise<DetectSeamsResult> {
  const response = await callModel(MODELS.FAST_VISION, (c, model) =>
    c.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "high" },
            },
            {
              type: "text",
              text: `This is a photo of a quilt block. Imagine a ${gridW}-column × ${gridH}-row grid of equal cells overlaid on the image, columns 1–${gridW} left-to-right, rows 1–${gridH} top-to-bottom.

Find all visible fabric seam lines (stitched boundaries between fabric pieces) and report them as JSON:

- "h": horizontal boundary numbers (1–${gridH - 1}) where a seam runs across the full row width. Boundary N = line between rows N and N+1.
- "v": vertical boundary numbers (1–${gridW - 1}) where a seam runs the full column height. Boundary N = line between columns N and N+1.
- "nwse": list of [row, col] pairs (1-indexed) for cells with a visible diagonal seam from the cell's NW corner to its SE corner.
- "nesw": list of [row, col] pairs for cells with a diagonal seam from the NE corner to the SW corner.

Important rules:
- The image may be slightly off-centre or rotated — use the dominant fabric pattern to infer the grid.
- Diagonal seams in cells typically form diamond or triangle shapes.
- Only include entries you are confident about.

Return ONLY valid JSON, no markdown, no commentary:
{"h":[...],"v":[...],"nwse":[[row,col],...],"nesw":[[row,col],...]}

If no seams are visible return {"h":[],"v":[],"nwse":[],"nesw":[]}.`,
            },
          ],
        },
      ],
    }),
  );

  const raw = parseJson(response.choices[0]?.message.content ?? null);

  const hBounds = Array.isArray(raw.h)
    ? (raw.h as unknown[]).filter(
        (n): n is number =>
          typeof n === "number" &&
          Number.isInteger(n) &&
          n >= 1 &&
          n <= gridH - 1,
      )
    : [];
  const vBounds = Array.isArray(raw.v)
    ? (raw.v as unknown[]).filter(
        (n): n is number =>
          typeof n === "number" &&
          Number.isInteger(n) &&
          n >= 1 &&
          n <= gridW - 1,
      )
    : [];

  function isPair(x: unknown): x is [number, number] {
    return (
      Array.isArray(x) &&
      x.length === 2 &&
      typeof x[0] === "number" &&
      typeof x[1] === "number"
    );
  }

  const nwsePairs = Array.isArray(raw.nwse)
    ? (raw.nwse as unknown[])
        .filter(isPair)
        .filter(([r, c]) => r >= 1 && r <= gridH && c >= 1 && c <= gridW)
    : [];
  const neswPairs = Array.isArray(raw.nesw)
    ? (raw.nesw as unknown[])
        .filter(isPair)
        .filter(([r, c]) => r >= 1 && r <= gridH && c >= 1 && c <= gridW)
    : [];

  const seams: DetectedSeam[] = [];
  for (const b of hBounds) {
    for (let col = 0; col < gridW; col++) {
      seams.push({ axis: "h", pos: b * 2, cellIdx: col });
    }
  }
  for (const b of vBounds) {
    for (let row = 0; row < gridH; row++) {
      seams.push({ axis: "v", pos: b * 2, cellIdx: row });
    }
  }

  const diagSeams: DetectedDiagSeam[] = [
    ...nwsePairs.map(([row, col]) => ({ diagType: "nwse" as const, row, col })),
    ...neswPairs.map(([row, col]) => ({ diagType: "nesw" as const, row, col })),
  ];

  return { seams, diagSeams };
}

// ---------------------------------------------------------------------------
// Pattern metadata enrichment via Perplexity (through OpenRouter) / GPT-4o-mini
// ---------------------------------------------------------------------------

export interface PatternEnrichment {
  designerBio: string | null;
  designerWebsite: string | null;
  publicationName: string | null;
  publicationYear: string | null;
}

const ENRICHMENT_PROMPT = `You are a quilt pattern research assistant. Find factual information about the given quilt pattern designer or pattern publication. Respond with STRICT JSON only using exactly these keys:
- "designerBio": a 2-3 sentence biography of the designer focused on their quilting work, or null if not found
- "designerWebsite": the designer's official website URL (e.g. "https://example.com"), or null if not found
- "publicationName": the name of the book, magazine, or pattern company that published this pattern, or null if not known
- "publicationYear": the year the pattern was first published as a string (e.g. "2019"), or null if not known

Respond ONLY with the JSON object. No markdown, no commentary.`;

export async function enrichPatternMetadata(
  patternName: string,
  designerName: string | null,
): Promise<PatternEnrichment> {
  const query = designerName
    ? `Quilt pattern designer: "${designerName}". Pattern: "${patternName}". Find their biography, website, and this pattern's publication details.`
    : `Quilt pattern: "${patternName}". Find the designer biography, website, and publication details.`;

  const raw = await callModel(
    { openrouter: "perplexity/sonar", openai: "gpt-4o-mini" },
    async (client, model) => {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: ENRICHMENT_PROMPT },
          { role: "user", content: query },
        ],
        response_format: { type: "json_object" },
        max_tokens: 512,
      });
      return parseJson(completion.choices[0]?.message?.content ?? null);
    },
  );

  return {
    designerBio: asString(raw.designerBio),
    designerWebsite: asString(raw.designerWebsite),
    publicationName: asString(raw.publicationName),
    publicationYear: asString(raw.publicationYear),
  };
}

// ---------------------------------------------------------------------------
// Pattern image → block schema extraction (#90)
// ---------------------------------------------------------------------------

export interface ExtractedBlockDef {
  gridSize: number;
  cells: string[];
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

const BLOCK_EXTRACT_PROMPT = `You are an expert quilt block digitiser. Given a photo of a quilt block (or a diagram of one), extract the cell colour pattern for a block designer tool.

The block is represented as a square grid. Each cell is encoded as one of:
- Solid colour: "solid:#RRGGBB"
- Half-square triangle NW→SE diagonal: "nwse:#RRGGBB:#RRGGBB"  (upper-left triangle colour first)
- Half-square triangle NE→SW diagonal: "nesw:#RRGGBB:#RRGGBB"  (upper-right triangle colour first)

Rules:
- Choose the grid size that best captures the block: 4 (simple), 8 (standard), or 12 (complex).
- Cells are listed left-to-right, top-to-bottom (row-major order). Total cells = gridSize × gridSize.
- Use hex colour codes (e.g. "#FFFFFF", "#1A2B3C").
- Use "solid:#RRGGBB" for cells with one fabric colour.
- Use "nwse" or "nesw" for cells with two triangular pieces separated by a diagonal seam.

Respond with STRICT JSON only:
{
  "gridSize": 4 | 8 | 12,
  "cells": ["solid:#RRGGBB", ...],
  "confidence": "high" | "medium" | "low",
  "notes": "any caveats or things the user should check, or null"
}`;

export async function extractBlockFromImage(
  imageDataUrl: string,
): Promise<ExtractedBlockDef> {
  const completion = await callModel(MODELS.FAST_VISION, (c, model) =>
    c.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BLOCK_EXTRACT_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the block grid from this quilt block image. Respond with JSON only.",
            },
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "high" },
            },
          ],
        },
      ],
      max_tokens: 2048,
    }),
  );

  const raw = parseJson(completion.choices[0]?.message?.content ?? null);
  const gridSize =
    raw.gridSize === 4 || raw.gridSize === 8 || raw.gridSize === 12
      ? (raw.gridSize as 4 | 8 | 12)
      : 8;
  const rawCells = Array.isArray(raw.cells) ? (raw.cells as unknown[]) : [];
  const cells = rawCells
    .filter((c): c is string => typeof c === "string")
    .slice(0, gridSize * gridSize);
  const confidence =
    raw.confidence === "high" || raw.confidence === "low"
      ? raw.confidence
      : "medium";

  return {
    gridSize,
    cells,
    confidence,
    notes: asString(raw.notes),
  };
}
