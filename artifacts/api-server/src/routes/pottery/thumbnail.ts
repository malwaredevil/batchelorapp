import { Router } from "express";
import { SetPotteryThumbnailParams } from "@workspace/api-zod";
import { savePotteryThumbnail } from "../../lib/pottery/thumbnail";
import { serializeItem } from "../../lib/pottery/serialize";

/** Mounted after the pottery router's requireAuth; shared household scope. */
export const potteryThumbnailRouter = Router();
potteryThumbnailRouter.put("/items/:id/thumbnail", async (req, res) => {
  const { id } = SetPotteryThumbnailParams.parse(req.params);
  if (!Number.isSafeInteger(id))
    return res.status(400).json({ error: "Invalid piece ID." });
  const updated = await savePotteryThumbnail(id, req.body);
  return res.json(await serializeItem(updated));
});
