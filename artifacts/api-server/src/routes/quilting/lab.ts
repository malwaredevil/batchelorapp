import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { db, fabrics, quiltingImages } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { downloadImageBuffer, uploadImage } from "../../lib/storage";
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
  buildFullWhiteMaskDataUrl,
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
    // Optional: when omitted the server builds a full-coverage white mask so
    // the AI scans and repairs the entire image without a prior detect step.
    maskDataUrl: z.string().min(1).optional(),
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
// Unified endpoint — runs OpenAI inpainting and returns the result.
// Accepts an optional prompt override; falls back to the shared default.
// ---------------------------------------------------------------------------

router.post("/lab/remove-creases", async (req, res) => {
  const parsed = InpaintBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "fabricId (or sourceDataUrl) is required.",
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
    // When no mask is supplied, cover the whole image so the AI finds and
    // removes any creases without requiring a prior detection step.
    const maskDataUrl =
      parsed.data.maskDataUrl ?? (await buildFullWhiteMaskDataUrl(imgBuffer));
    const dataUrl = await removeCreasesFromBuffer(
      imgBuffer,
      maskDataUrl,
      parsed.data.prompt,
    );
    res.json({ dataUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAI inpainting failed";
    res.status(500).json({ error: msg });
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
      error: "fabricId (or sourceDataUrl) is required.",
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
    // When no mask is supplied, cover the whole image so the AI finds and
    // removes any creases without requiring a prior detection step.
    const maskDataUrl =
      parsed.data.maskDataUrl ?? (await buildFullWhiteMaskDataUrl(imgBuffer));
    const dataUrl = await removeCreasesFromBuffer(
      imgBuffer,
      maskDataUrl,
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
// POST /lab/bulk-crease-fix
// Auto-run crease removal on the default image of each supplied fabric ID.
// Skips the flaky vision-detection step — uses a full-coverage white mask so
// the inpainting model covers the whole image and relies on the prompt alone.
// The processed image is added as a new supplemental photo and immediately set
// as the fabric's new default.  requireAuth + requireOwner inherited from the
// router.use() at the top.
// ---------------------------------------------------------------------------

const BulkCreaseFixBody = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(10, "Send at most 10 fabric IDs per batch."),
});

router.post("/lab/bulk-crease-fix", async (req, res) => {
  const parsed = BulkCreaseFixBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "ids must be a non-empty array of up to 10 fabric IDs." });
    return;
  }

  const { ids } = parsed.data;

  const results = await Promise.allSettled(
    ids.map(async (fabricId) => {
      const [row] = await db
        .select({ imagePath: fabrics.imagePath })
        .from(fabrics)
        .where(eq(fabrics.id, fabricId))
        .limit(1);
      if (!row)
        throw Object.assign(new Error("Fabric not found"), { fabricId });

      const { buffer: imgBuffer } = await downloadImageBuffer(row.imagePath);
      const maskDataUrl = await buildFullWhiteMaskDataUrl(imgBuffer);
      const dataUrl = await removeCreasesFromBuffer(imgBuffer, maskDataUrl);

      const b64 = dataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      const resultBuf = Buffer.from(b64, "base64");
      const storagePath = await uploadImage(resultBuf, "image/png");

      const existing = await db
        .select({ position: quiltingImages.position })
        .from(quiltingImages)
        .where(sql`entity_type = 'fabric' AND entity_id = ${fabricId}`)
        .orderBy(quiltingImages.position);
      const nextPosition = (existing[existing.length - 1]?.position ?? 0) + 1;

      await db.insert(quiltingImages).values({
        entityType: "fabric",
        entityId: fabricId,
        storagePath,
        label: "AI Crease Removed",
        position: nextPosition,
      });

      await db
        .update(fabrics)
        .set({ imagePath: storagePath })
        .where(eq(fabrics.id, fabricId));

      return fabricId;
    }),
  );

  const succeeded: number[] = [];
  const failed: { id: number; error: string }[] = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      succeeded.push(r.value);
    } else {
      const err = r.reason as Error & { fabricId?: number };
      const id = err.fabricId ?? ids[i];
      logger.warn({ fabricId: id, err }, "bulk-crease-fix: fabric failed");
      failed.push({ id, error: err.message ?? "Processing failed" });
    }
  });

  res.json({ succeeded, failed });
});

export default router;
