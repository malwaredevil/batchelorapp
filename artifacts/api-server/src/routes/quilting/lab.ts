import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import sharp from "sharp";
import { and, eq, sql } from "drizzle-orm";
import { db, fabrics, quiltingImages } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import {
  downloadImageBuffer,
  uploadImage,
  deleteImage,
} from "../../lib/storage";
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

// Scope requireAuth + requireOwner to /lab/* only so other quilting routes
// (e.g. /stats) are not affected by the owner check.
router.use("/lab", requireAuth, requireOwner);

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
    if (!row.imagePath)
      throw Object.assign(
        new Error("Fabric has no image. Upload a photo first."),
        { status: 422 },
      );
    const { buffer } = await downloadImageBuffer(row.imagePath);
    return buffer;
  }
  throw new Error("Either fabricId or sourceDataUrl is required.");
}

/**
 * Decode the base64 portion of a data URL returned by the AI and re-encode it
 * as a true lossless PNG via Sharp.  The AI (gpt-image-2) sometimes returns
 * JPEG-encoded data even when the declared content-type says "image/png".
 * Storing JPEG bytes under an image/png MIME type breaks librsvg (used by
 * Sharp to rasterise block-preview SVGs) because the embedded <image> data URI
 * must match its declared MIME type exactly.
 */
async function dataUrlToPngBuffer(dataUrl: string): Promise<Buffer> {
  const b64 = dataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
  const rawBuf = Buffer.from(b64, "base64");
  return sharp(rawBuf).png().toBuffer();
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
// Unified endpoint — runs OpenAI inpainting and returns the result as a true
// PNG data URL (re-encoded via Sharp regardless of what the AI returned).
// Accepts an optional prompt override; falls back to the shared default.
// ---------------------------------------------------------------------------

router.post("/lab/remove-creases", async (req, res) => {
  const parsed = InpaintBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.maskDataUrl) {
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
    const rawDataUrl = await removeCreasesFromBuffer(
      imgBuffer,
      parsed.data.maskDataUrl,
      parsed.data.prompt,
    );
    // Re-encode as true PNG so callers always receive lossless PNG data.
    const pngBuf = await dataUrlToPngBuffer(rawDataUrl);
    const dataUrl = `data:image/png;base64,${pngBuf.toString("base64")}`;
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
// Returns a true PNG data URL (re-encoded via Sharp).
// ---------------------------------------------------------------------------

router.post("/lab/remove-creases/openai", async (req, res) => {
  const parsed = InpaintBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.maskDataUrl) {
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
    const rawDataUrl = await removeCreasesFromBuffer(
      imgBuffer,
      parsed.data.maskDataUrl,
      parsed.data.prompt,
    );
    // Re-encode as true PNG so callers always receive lossless PNG data.
    const pngBuf = await dataUrlToPngBuffer(rawDataUrl);
    const dataUrl = `data:image/png;base64,${pngBuf.toString("base64")}`;
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
// Skips the flaky vision-detection step — uses a fully-transparent mask so
// the inpainting model covers the whole image and relies on the prompt alone.
// The processed image is re-encoded as a true lossless PNG (Sharp guarantees
// this regardless of whatever format the AI returned), added as a new
// supplemental photo, and immediately set as the fabric's new default.
// requireAuth + requireOwner inherited from the router.use() at the top.
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
      if (!row.imagePath)
        throw Object.assign(new Error("Fabric has no image"), { fabricId });

      const { buffer: imgBuffer } = await downloadImageBuffer(row.imagePath);
      // Use a fully-transparent mask so the inpainting prompt guides gentle
      // smoothing across the whole image — same path as single-item "no
      // detection" — rather than a full-white mask which causes gpt-image-2 to
      // regenerate the entire image (hallucination).
      const meta = await sharp(imgBuffer).metadata();
      const maskDataUrl = `data:image/png;base64,${(
        await sharp({
          create: {
            width: meta.width ?? 1024,
            height: meta.height ?? 1024,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .png()
          .toBuffer()
      ).toString("base64")}`;
      const rawDataUrl = await removeCreasesFromBuffer(imgBuffer, maskDataUrl);

      // Always re-encode as a true lossless PNG before storing.  The AI
      // (gpt-image-2) sometimes returns JPEG-encoded bytes even when the data
      // URL declares "image/png".  Storing mismatched bytes breaks librsvg
      // (used by Sharp to rasterise block-preview SVGs).
      const pngBuf = await dataUrlToPngBuffer(rawDataUrl);
      const storagePath = await uploadImage(pngBuf, "image/png");

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

// ---------------------------------------------------------------------------
// POST /lab/admin-revert-crease-fix
// One-time recovery endpoint: revert fabrics whose image_path was incorrectly
// set to a crease-removed file (JPEG bytes stored as PNG) back to their
// original image path, and delete the bad supplemental image rows + storage
// files.  Only reverts if current image_path ≠ originalPath (safe to call
// multiple times).
// ---------------------------------------------------------------------------

const RevertCreaseFixBody = z.object({
  reversals: z
    .array(
      z.object({
        id: z.number().int().positive(),
        originalPath: z.string().min(1),
      }),
    )
    .min(1)
    .max(100),
});

router.post("/lab/admin-revert-crease-fix", async (req, res) => {
  const parsed = RevertCreaseFixBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "reversals must be a non-empty array of up to 100 items.",
    });
    return;
  }

  const results = await Promise.allSettled(
    parsed.data.reversals.map(async ({ id, originalPath }) => {
      const [row] = await db
        .select({ imagePath: fabrics.imagePath })
        .from(fabrics)
        .where(eq(fabrics.id, id))
        .limit(1);
      if (!row)
        throw Object.assign(new Error(`Fabric ${id} not found`), { id });

      const currentPath = row.imagePath;

      if (currentPath === originalPath) {
        // Already on the original — nothing to do for image_path.
        // Still delete any supplemental whose storage_path matches the
        // original path (shouldn't happen, but defensive).
        return { id, reverted: false };
      }

      // Delete the supplemental row that was created by the bulk crease fix
      // (identified by its storage_path matching the current crease-removed
      // primary path).  Pre-existing supplementals with different paths are
      // left untouched.
      await db
        .delete(quiltingImages)
        .where(
          and(
            eq(quiltingImages.entityType, "fabric"),
            eq(quiltingImages.entityId, id),
            eq(quiltingImages.storagePath, currentPath),
          ),
        );

      // Restore the original image path.
      await db
        .update(fabrics)
        .set({ imagePath: originalPath })
        .where(eq(fabrics.id, id));

      // Fire-and-forget: delete the orphaned crease-removed file from storage.
      deleteImage(currentPath).catch((err: unknown) => {
        logger.warn(
          { fabricId: id, path: currentPath, err },
          "admin-revert: failed to delete orphaned storage file (non-fatal)",
        );
      });

      return { id, reverted: true, restoredTo: originalPath };
    }),
  );

  const succeeded = results
    .filter((r) => r.status === "fulfilled")
    .map(
      (r) =>
        (r as PromiseFulfilledResult<{ id: number; reverted: boolean }>).value,
    );
  const failed = results
    .filter((r) => r.status === "rejected")
    .map((r) => {
      const err = (r as PromiseRejectedResult).reason as Error & {
        id?: number;
      };
      return { id: err.id, error: err.message };
    });

  res.json({ succeeded, failed });
});

export default router;
