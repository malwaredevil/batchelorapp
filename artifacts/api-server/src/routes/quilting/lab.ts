import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, fabrics } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { downloadImageBuffer } from "../../lib/storage";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";
import {
  validateSourceDataUrl,
  preprocessForInpaint,
  type CropInfo,
} from "@workspace/ai-actions";
import {
  detectCreasesFromBuffer,
  removeCreasesFromBuffer,
  DEFAULT_INPAINT_PROMPT,
} from "../../lib/crease-removal";

const router: IRouter = Router();

router.use(requireAuth, requireOwner);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DetectCreasesBody = z
  .object({
    fabricId: z.number().int().positive().optional(),
    sourceDataUrl: z.string().min(1).optional(),
  })
  .refine((d) => d.fabricId !== undefined || d.sourceDataUrl !== undefined, {
    message: "Either fabricId or sourceDataUrl is required.",
  });

const InpaintBody = z
  .object({
    fabricId: z.number().int().positive().optional(),
    sourceDataUrl: z.string().min(1).optional(),
    maskDataUrl: z.string().min(1),
    /** Optional caller-supplied inpainting prompt; falls back to the default. */
    prompt: z.string().max(1000).optional(),
  })
  .refine((d) => d.fabricId !== undefined || d.sourceDataUrl !== undefined, {
    message: "Either fabricId or sourceDataUrl is required.",
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSourceBuffer(
  fabricId?: number,
  sourceDataUrl?: string,
): Promise<Buffer> {
  if (sourceDataUrl) {
    return validateSourceDataUrl(sourceDataUrl);
  }
  if (fabricId !== undefined) {
    const [row] = await db
      .select({ imagePath: fabrics.imagePath })
      .from(fabrics)
      .where(eq(fabrics.id, fabricId))
      .limit(1);
    if (!row)
      throw Object.assign(new Error("Fabric not found."), { status: 404 });
    const { buffer } = await downloadImageBuffer(row.imagePath);
    return buffer;
  }
  throw new Error("Either fabricId or sourceDataUrl is required.");
}

// ---------------------------------------------------------------------------
// GET /lab/status
// Returns which AI providers are currently configured, so the frontend can
// surface a targeted banner instead of a generic 500 when keys are absent.
// ---------------------------------------------------------------------------

router.get("/lab/status", (_req, res) => {
  res.json({
    openai: !!env.openaiApiKey,
    replicate: !!env.replicateApiToken,
  });
});

// ---------------------------------------------------------------------------
// POST /lab/detect-creases
// Downloads the fabric image (or uses a supplied sourceDataUrl), sends it to
// the vision model, and returns a mask PNG (white-on-transparent) covering the
// detected crease locations.
// ---------------------------------------------------------------------------

router.post("/lab/detect-creases", async (req, res) => {
  const parsed = DetectCreasesBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Either fabricId or sourceDataUrl is required." });
    return;
  }

  let imgBuffer: Buffer;
  try {
    imgBuffer = await getSourceBuffer(
      parsed.data.fabricId,
      parsed.data.sourceDataUrl,
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error).message });
    return;
  }

  const result = await detectCreasesFromBuffer(imgBuffer);
  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /lab/remove-creases
// Unified orchestration endpoint — runs OpenAI edit and returns result.
// Accepts an optional prompt override; falls back to the shared default.
// ---------------------------------------------------------------------------

router.post("/lab/remove-creases", async (req, res) => {
  const parsed = InpaintBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "fabricId (or sourceDataUrl) and maskDataUrl are required.",
    });
    return;
  }

  let imgBuffer: Buffer;
  try {
    imgBuffer = await getSourceBuffer(
      parsed.data.fabricId,
      parsed.data.sourceDataUrl,
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error).message });
    return;
  }

  try {
    const dataUrl = await removeCreasesFromBuffer(
      imgBuffer,
      parsed.data.maskDataUrl,
      parsed.data.prompt,
    );
    res.json({ openai: { dataUrl } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAI inpainting failed";
    res.status(500).json({ openai: { error: msg } });
  }
});

// ---------------------------------------------------------------------------
// POST /lab/remove-creases/openai
// Per-provider endpoint — runs OpenAI gpt-image-2 edit so the UI can
// resolve this panel independently the moment this model finishes.
// ---------------------------------------------------------------------------

router.post("/lab/remove-creases/openai", async (req, res) => {
  const parsed = InpaintBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "fabricId (or sourceDataUrl) and maskDataUrl are required.",
    });
    return;
  }

  let imgBuffer: Buffer;
  try {
    imgBuffer = await getSourceBuffer(
      parsed.data.fabricId,
      parsed.data.sourceDataUrl,
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error).message });
    return;
  }

  try {
    const dataUrl = await removeCreasesFromBuffer(
      imgBuffer,
      parsed.data.maskDataUrl,
      parsed.data.prompt,
    );
    res.json({ dataUrl });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "OpenAI inpainting failed.";
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /lab/remove-creases/replicate
// Per-provider endpoint — runs Replicate FLUX Fill Dev inpainting.
// ---------------------------------------------------------------------------

router.post("/lab/remove-creases/replicate", async (req, res) => {
  const parsed = InpaintBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "fabricId (or sourceDataUrl) and maskDataUrl are required.",
    });
    return;
  }

  let imgBuffer: Buffer;
  try {
    imgBuffer = await getSourceBuffer(
      parsed.data.fabricId,
      parsed.data.sourceDataUrl,
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error).message });
    return;
  }

  const prompt = parsed.data.prompt ?? DEFAULT_INPAINT_PROMPT;

  try {
    const { resizedImg, replMask, cropInfo } = await preprocessForInpaint(
      imgBuffer,
      parsed.data.maskDataUrl,
    );
    const dataUrl = await runReplicateFluxFill(
      resizedImg,
      replMask,
      prompt,
      cropInfo,
    );
    res.json({ dataUrl });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Replicate inpainting failed.";
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Replicate helper (kept in this file — not shared with Elaine executor)
// ---------------------------------------------------------------------------

async function runReplicateFluxFill(
  imgBuffer: Buffer,
  maskBuffer: Buffer,
  prompt: string,
  cropInfo: CropInfo,
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
          output_format: "webp",
          output_quality: 95,
          num_inference_steps: 28,
          guidance: 30,
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
  if (!outputUrl) {
    logger.warn({ prediction }, "Replicate returned no output URL");
    throw new Error("Replicate returned no output URL.");
  }

  logger.info({ outputUrl: outputUrl.slice(0, 80) }, "Replicate output URL");

  // Output URL may be a data URI (some Replicate model versions return this)
  // or an https URL. Handle both.
  let resultBuf: Buffer;
  if (outputUrl.startsWith("data:")) {
    const b64 = outputUrl.replace(/^data:[^;]+;base64,/, "");
    resultBuf = Buffer.from(b64, "base64");
  } else {
    const imgResp = await fetch(outputUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imgResp.ok)
      throw new Error(`Failed to download Replicate output: ${imgResp.status}`);
    resultBuf = Buffer.from(await imgResp.arrayBuffer());
  }

  // Crop letterbox padding and resize back to original dimensions.
  const cropped = await sharp(resultBuf)
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

export default router;
