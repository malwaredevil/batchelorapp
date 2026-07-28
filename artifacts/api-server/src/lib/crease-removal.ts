/**
 * Shared helpers for fabric crease detection and AI inpainting.
 * Used by both the /quilting/lab/* HTTP routes and the Elaine action executor.
 */
import sharp from "sharp";
import OpenAI, { toFile } from "openai";
import { callModel, MODELS } from "./ai-client";
import { env } from "./env";
import { logger } from "./logger";
import {
  preprocessForInpaint,
  buildCreaseMaskDataUrl,
  DEFAULT_INPAINT_PROMPT,
} from "@workspace/ai-actions";

export type { CropInfo } from "@workspace/ai-actions";
export { DEFAULT_INPAINT_PROMPT } from "@workspace/ai-actions";

export interface DetectedCrease {
  x1Pct: number;
  y1Pct: number;
  x2Pct: number;
  y2Pct: number;
  widthPct: number;
}

export interface DetectCreasesResult {
  description: string;
  creases: DetectedCrease[];
  maskDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  creasesFound: number;
}

const DETECT_VISION_PROMPT = `You are analysing a fabric photo to find PHYSICAL FOLD LINES — the actual crease lines left when fabric is stored folded on a bolt or fat quarter.

## The one key test: does the line run continuously edge-to-edge?
A physical bolt fold is a straight or nearly-straight band that runs continuously from near one edge of the image to near the other, crossing through ALL printed motifs it encounters — the pattern continues normally on both sides, but the fabric surface itself is bent so there is a subtle shadow or lighter ridge at that line.

A printed design element (stripe, motif outline, border, grid in the pattern) STOPS at the edges of individual motifs — it is part of the design, not a continuous surface deformation.

Apply this test: can you trace a continuous tonal shift (a narrow band that is slightly darker or lighter than the surrounding fabric) all the way across the image, cutting through multiple separate printed motifs? If yes → mark it. If the line stops or starts within individual motifs → skip it.

## Rules
- Only mark lines that are HORIZONTAL or VERTICAL (±20°). Diagonal lines almost always follow the printed design — skip them.
- Maximum 4 creases total. Store fabric folds in 1–4 long straight lines. If you are seeing more than 4, you are detecting the print.
- Short partial creases are fine — a crease doesn't have to run the full length. A crease that runs 20-30% across the fabric from a fold point is still a real crease worth marking.
- Skip the fabric edge/selvage, any shadow from behind/below the fabric, or any line that is bolder or more saturated than the surrounding fabric (bold = print, not crease).

## Output
Return ONLY valid JSON (no markdown, no explanation):
{
  "description": "One sentence describing the physical fold lines found (their direction and position), or 'No fold lines detected' if the fabric is flat.",
  "creases": [
    {
      "x1Pct": <number 0-100>,
      "y1Pct": <number 0-100>,
      "x2Pct": <number 0-100>,
      "y2Pct": <number 0-100>,
      "widthPct": <number 2-10>
    }
  ]
}

x1Pct/y1Pct: one end of the crease line as % of image width/height.
x2Pct/y2Pct: the other end (must be on the opposite or far side of the image).
widthPct: the crease band thickness as % of the shorter image dimension.
If a line fails the edge-to-edge or horizontal/vertical tests, omit it — not the whole array.`;

/**
 * Auto-detect physical crease lines in a fabric image using the vision model.
 * Returns detected creases as percentage-based coordinates plus a ready-to-use
 * white-on-transparent mask PNG encoded as a data URL.
 */
export async function detectCreasesFromBuffer(
  imgBuffer: Buffer,
): Promise<DetectCreasesResult> {
  const meta = await sharp(imgBuffer).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;
  const imageDataUrl = `data:image/png;base64,${imgBuffer.toString("base64")}`;

  let description = "Could not analyse the image.";
  let creases: DetectedCrease[] = [];

  try {
    const raw = await callModel(MODELS.FAST_VISION, async (client, model) => {
      const resp = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUrl } },
              { type: "text", text: DETECT_VISION_PROMPT },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });
      return resp.choices[0]?.message?.content ?? "{}";
    });

    const parsed = JSON.parse(raw) as {
      description?: string;
      creases?: unknown[];
    };
    description = parsed.description ?? description;
    if (Array.isArray(parsed.creases)) {
      creases = parsed.creases.filter(
        (c): c is DetectedCrease =>
          c !== null &&
          typeof c === "object" &&
          "x1Pct" in c &&
          "y1Pct" in c &&
          "x2Pct" in c &&
          "y2Pct" in c,
      );
    }
  } catch (err) {
    logger.warn({ err }, "crease-removal: vision call failed");
    description = "Detection failed — you can paint the mask manually.";
  }

  const maskDataUrl =
    creases.length > 0
      ? await buildCreaseMaskDataUrl(creases, w, h)
      : `data:image/png;base64,${(
          await sharp({
            create: {
              width: w,
              height: h,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .png()
            .toBuffer()
        ).toString("base64")}`;

  return {
    description,
    creases,
    maskDataUrl,
    imageWidth: w,
    imageHeight: h,
    creasesFound: creases.length,
  };
}

/**
 * Build a full-coverage white mask (same dimensions as the source image) as a
 * data URL. Used for bulk crease-fix where auto-detection is skipped — the
 * whole image is presented to the inpainting model and the prompt guides it to
 * repair crease artefacts while preserving the fabric pattern.
 */
export async function buildFullWhiteMaskDataUrl(
  imgBuffer: Buffer,
): Promise<string> {
  const meta = await sharp(imgBuffer).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;
  const mask = await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${mask.toString("base64")}`;
}

/**
 * Run OpenAI gpt-image-2 inpainting to remove creases from a fabric image.
 * Returns the result as a base64 data URL, cropped and resized back to the
 * original image dimensions.
 */
export async function removeCreasesFromBuffer(
  imgBuffer: Buffer,
  maskDataUrl: string,
  prompt?: string,
): Promise<string> {
  if (!env.openaiApiKey) {
    throw Object.assign(new Error("OPENAI_API_KEY is not configured."), {
      status: 503,
    });
  }

  const { resizedImg, openaiMask, cropInfo } = await preprocessForInpaint(
    imgBuffer,
    maskDataUrl,
  );

  const client = new OpenAI({
    apiKey: env.openaiApiKey, // openai-direct-ok — images.edit not available via OpenRouter
    timeout: 90_000,
    maxRetries: 0,
  });

  const response = await client.images.edit({
    model: "gpt-image-2",
    image: await toFile(resizedImg, "image.png", { type: "image/png" }),
    mask: await toFile(openaiMask, "mask.png", { type: "image/png" }),
    prompt: prompt ?? DEFAULT_INPAINT_PROMPT,
    n: 1,
    size: "1024x1024",
    output_format: "png",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data.");

  const cropped = await sharp(Buffer.from(b64, "base64"))
    .extract({
      left: cropInfo.left,
      top: cropInfo.top,
      width: cropInfo.width,
      height: cropInfo.height,
    })
    .resize(cropInfo.origW, cropInfo.origH)
    .png()
    .toBuffer();

  return `data:image/png;base64,${cropped.toString("base64")}`;
}
