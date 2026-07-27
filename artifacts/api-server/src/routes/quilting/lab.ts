import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import sharp from "sharp";
import OpenAI, { toFile } from "openai";
import { eq } from "drizzle-orm";
import { db, fabrics } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { callModel, MODELS } from "../../lib/ai-client";
import { downloadImageBuffer } from "../../lib/storage";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

router.use(requireAuth, requireOwner);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DetectCreasesBody = z.object({
  fabricId: z.number().int().positive(),
});

const RemoveCreasesBody = z.object({
  fabricId: z.number().int().positive(),
  maskDataUrl: z.string().min(1),
});

// ---------------------------------------------------------------------------
// POST /lab/detect-creases
// Downloads the fabric image, sends it to the vision model, and returns a
// mask PNG (white-on-transparent) covering the detected crease locations.
// ---------------------------------------------------------------------------

router.post("/lab/detect-creases", async (req, res) => {
  const parsed = DetectCreasesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "fabricId (integer) is required." });
    return;
  }

  const [row] = await db
    .select({ imagePath: fabrics.imagePath })
    .from(fabrics)
    .where(eq(fabrics.id, parsed.data.fabricId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const { buffer, contentType } = await downloadImageBuffer(row.imagePath);
  const imageDataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;

  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;

  let description = "Could not analyse the image.";
  let creases: Array<{
    x1Pct: number;
    y1Pct: number;
    x2Pct: number;
    y2Pct: number;
    widthPct: number;
  }> = [];

  try {
    const raw = await callModel(MODELS.FAST_VISION, async (client, model) => {
      const resp = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUrl } },
              {
                type: "text",
                text: `Examine this fabric photo carefully. Identify every visible fold line, crease, or wrinkle.

Return ONLY valid JSON (no markdown, no explanation):
{
  "description": "One sentence describing the creases you found, or 'No creases detected' if the fabric is flat.",
  "creases": [
    {
      "x1Pct": <number 0-100>,
      "y1Pct": <number 0-100>,
      "x2Pct": <number 0-100>,
      "y2Pct": <number 0-100>,
      "widthPct": <number 2-20>
    }
  ]
}

x1Pct/y1Pct is one end of the crease line as % of image width/height.
x2Pct/y2Pct is the other end as % of image width/height.
widthPct is the crease's thickness as % of the shorter image dimension.
Include all visible creases, including faint ones.`,
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });
      return resp.choices[0]?.message?.content ?? "{}";
    });

    const parsed2 = JSON.parse(raw) as {
      description?: string;
      creases?: unknown[];
    };
    description = parsed2.description ?? description;
    if (Array.isArray(parsed2.creases)) {
      creases = parsed2.creases.filter(
        (c): c is (typeof creases)[number] =>
          c !== null &&
          typeof c === "object" &&
          "x1Pct" in c &&
          "y1Pct" in c &&
          "x2Pct" in c &&
          "y2Pct" in c,
      );
    }
  } catch (err) {
    logger.warn({ err }, "lab/detect-creases: vision call failed");
    description = "Detection failed — you can paint the mask manually.";
  }

  // Build mask PNG from crease line coordinates
  const minDim = Math.min(w, h);
  const svgLines = creases
    .map((c) => {
      const x1 = Math.round((c.x1Pct / 100) * w);
      const y1 = Math.round((c.y1Pct / 100) * h);
      const x2 = Math.round((c.x2Pct / 100) * w);
      const y2 = Math.round((c.y2Pct / 100) * h);
      const sw = Math.max(4, Math.round((c.widthPct / 100) * minDim));
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${sw}" stroke-linecap="round"/>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="black" fill-opacity="0"/>
  ${svgLines}
</svg>`;

  const maskBuffer = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .png()
    .toBuffer();

  res.json({
    description,
    maskDataUrl: `data:image/png;base64,${maskBuffer.toString("base64")}`,
    imageWidth: w,
    imageHeight: h,
    creasesFound: creases.length,
  });
});

// ---------------------------------------------------------------------------
// POST /lab/remove-creases
// Accepts the fabric ID and a user-painted mask (white strokes on transparent
// background). Runs OpenAI gpt-image-1 edit and Replicate FLUX Fill in
// parallel, returns both results independently.
// ---------------------------------------------------------------------------

router.post("/lab/remove-creases", async (req, res) => {
  const parsed = RemoveCreasesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "fabricId and maskDataUrl are required." });
    return;
  }

  const [row] = await db
    .select({ imagePath: fabrics.imagePath })
    .from(fabrics)
    .where(eq(fabrics.id, parsed.data.fabricId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Fabric not found." });
    return;
  }

  const { buffer: imgBuffer } = await downloadImageBuffer(row.imagePath);

  // Parse mask — strip data URL prefix, accept both png and generic
  const maskB64 = parsed.data.maskDataUrl.replace(
    /^data:image\/[a-z]+;base64,/,
    "",
  );
  const maskBuffer = Buffer.from(maskB64, "base64");

  // Resize both to 1024×1024 (DALL-E requires square; FLUX works best at it)
  const [resizedImg, rawMask] = await Promise.all([
    sharp(imgBuffer)
      .resize(1024, 1024, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 255 },
      })
      .ensureAlpha()
      .png()
      .toBuffer(),
    sharp(maskBuffer)
      .resize(1024, 1024, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  // Build OpenAI mask: transparent = inpaint, opaque = keep.
  // User painted white (opaque) where creases are → invert alpha.
  const openaiMaskData = Buffer.from(rawMask.data);
  for (let i = 3; i < openaiMaskData.length; i += 4) {
    const wasOpaque = openaiMaskData[i] > 10;
    openaiMaskData[i] = wasOpaque ? 0 : 255;
    if (!wasOpaque) {
      openaiMaskData[i - 3] = 255;
      openaiMaskData[i - 2] = 255;
      openaiMaskData[i - 1] = 255;
    }
  }
  const openaiMask = await sharp(openaiMaskData, {
    raw: {
      width: rawMask.info.width,
      height: rawMask.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  // Build Replicate mask: white = inpaint, black = keep (no alpha).
  const replMaskData = Buffer.from(rawMask.data);
  for (let i = 0; i < replMaskData.length; i += 4) {
    const alpha = replMaskData[i + 3];
    const painted = alpha > 10;
    replMaskData[i] = painted ? 255 : 0;
    replMaskData[i + 1] = painted ? 255 : 0;
    replMaskData[i + 2] = painted ? 255 : 0;
    replMaskData[i + 3] = 255;
  }
  const replMask = await sharp(replMaskData, {
    raw: {
      width: rawMask.info.width,
      height: rawMask.info.height,
      channels: 4,
    },
  })
    .removeAlpha()
    .png()
    .toBuffer();

  const prompt =
    "flat, smooth fabric with no creases or folds, uniform surface texture, original print pattern preserved exactly";

  const [openaiResult, replicateResult] = await Promise.allSettled([
    runOpenAIEdit(resizedImg, openaiMask, prompt),
    runReplicateFluxFill(resizedImg, replMask, prompt),
  ]);

  res.json({
    openai:
      openaiResult.status === "fulfilled"
        ? { dataUrl: openaiResult.value }
        : {
            error:
              openaiResult.reason instanceof Error
                ? openaiResult.reason.message
                : "OpenAI inpainting failed",
          },
    replicate:
      replicateResult.status === "fulfilled"
        ? { dataUrl: replicateResult.value }
        : {
            error:
              replicateResult.reason instanceof Error
                ? replicateResult.reason.message
                : "Replicate inpainting failed",
          },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runOpenAIEdit(
  imgBuffer: Buffer,
  maskBuffer: Buffer,
  prompt: string,
): Promise<string> {
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  const client = new OpenAI({
    // openai-direct-ok — images.edit not available via OpenRouter
    apiKey: env.openaiApiKey,
    timeout: 90_000,
    maxRetries: 0,
  });

  const response = await client.images.edit({
    model: "gpt-image-1",
    image: await toFile(imgBuffer, "image.png", { type: "image/png" }),
    mask: await toFile(maskBuffer, "mask.png", { type: "image/png" }),
    prompt,
    n: 1,
    size: "1024x1024",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data.");
  return `data:image/png;base64,${b64}`;
}

async function runReplicateFluxFill(
  imgBuffer: Buffer,
  maskBuffer: Buffer,
  prompt: string,
): Promise<string> {
  if (!env.replicateApiToken) {
    throw new Error("REPLICATE_API_TOKEN is not configured.");
  }

  const imgB64 = `data:image/png;base64,${imgBuffer.toString("base64")}`;
  const maskB64 = `data:image/png;base64,${maskBuffer.toString("base64")}`;

  const createResp = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-fill-dev/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.replicateApiToken}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          image: imgB64,
          mask: maskB64,
          prompt,
          num_outputs: 1,
          output_format: "png",
          num_inference_steps: 28,
          guidance_scale: 60,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );

  if (!createResp.ok) {
    const txt = await createResp.text().catch(() => "");
    throw new Error(
      `Replicate API error ${createResp.status}: ${txt.slice(0, 300)}`,
    );
  }

  const prediction = (await createResp.json()) as {
    status?: string;
    output?: string | string[];
    error?: string;
    urls?: { get?: string };
  };

  if (prediction.error) throw new Error(prediction.error);

  // Prefer: wait might return immediately if still processing → poll
  let output = prediction.output;
  if (prediction.status !== "succeeded" && prediction.urls?.get) {
    const pollUrl = prediction.urls.get;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((r) => setTimeout(r, 3_000));
      const pollResp = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${env.replicateApiToken}` },
      });
      const poll = (await pollResp.json()) as {
        status?: string;
        output?: string | string[];
        error?: string;
      };
      if (poll.status === "succeeded") {
        output = poll.output;
        break;
      }
      if (poll.status === "failed") {
        throw new Error(poll.error ?? "Replicate prediction failed.");
      }
    }
  }

  const outputUrl = Array.isArray(output) ? output[0] : output;
  if (!outputUrl) throw new Error("Replicate returned no output URL.");

  const imgResp = await fetch(outputUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!imgResp.ok)
    throw new Error(`Failed to download Replicate output: ${imgResp.status}`);
  const resultBuf = Buffer.from(await imgResp.arrayBuffer());
  return `data:image/png;base64,${resultBuf.toString("base64")}`;
}

export default router;
