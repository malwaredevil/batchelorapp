import { Router } from "express";
import { z } from "zod/v4";
import { supplementalUploadLimiter } from "../../middleware/rateLimit";
import { downloadImageBuffer } from "../../lib/pottery/storage";
import {
  getPotteryPhotoOriginalInfo,
  getPotteryPhotoTarget,
  restorePotteryPhotoOriginal,
} from "../../lib/pottery/photo-originals";
import { logActivity } from "../../lib/soft-delete";

const params = z.object({
  id: z.coerce.number().int().positive().max(2_147_483_647),
  photoKey: z
    .union([z.literal("primary"), z.string().regex(/^[1-9]\d*$/)])
    .transform((value) => (value === "primary" ? null : Number(value)))
    .refine(
      (value) =>
        value === null ||
        (Number.isSafeInteger(value) && value <= 2_147_483_647),
    ),
});

// Mounted inside the existing authenticated, household-shared Pottery router.
export default function createPhotoOriginalRoutes(
  onRestored: (id: number) => void,
) {
  const router = Router();
  router.use("/items/:id/photos/:photoKey", (req, res, next) => {
    if (!params.safeParse(req.params).success) {
      res.status(400).json({ error: "Invalid pottery photo reference." });
      return;
    }
    next();
  });
  router.get("/items/:id/photos/:photoKey/original-info", async (req, res) => {
    const { id, photoKey } = params.parse(req.params);
    res.json(await getPotteryPhotoOriginalInfo(id, photoKey));
  });
  router.get("/items/:id/photos/:photoKey/original", async (req, res) => {
    const { id, photoKey } = params.parse(req.params);
    const target = await getPotteryPhotoTarget(id, photoKey);
    if (!target.originalImagePath) {
      res.status(404).json({ error: "No earlier photo was retained." });
      return;
    }
    const image = await downloadImageBuffer(target.originalImagePath);
    res.set("Cache-Control", "private, no-store");
    res.type(image.contentType).send(image.buffer);
  });
  router.post(
    "/items/:id/photos/:photoKey/restore-original",
    supplementalUploadLimiter,
    async (req, res) => {
      const { id, photoKey } = params.parse(req.params);
      const parsedBody = z
        .object({
          expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          error:
            "A valid photo version is required. Reload the piece and try again.",
        });
        return;
      }
      const body = parsedBody.data;
      const result = await restorePotteryPhotoOriginal(
        id,
        photoKey,
        body.expectedVersion,
      );
      if (result.version !== body.expectedVersion) onRestored(id);
      await logActivity({
        actorUserId: req.session.userId ?? null,
        actorChannel: "web",
        actionType: "restore_pottery_photo_original",
        entityType: "pottery_item",
        entityId: id,
        payload: { imageId: photoKey },
      });
      res.json(result);
    },
  );
  return router;
}
