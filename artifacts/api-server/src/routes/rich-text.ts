import { Router, type IRouter } from "express";
import multer from "multer";
import { multerLimitForPrefix } from "../lib/upload-limits";
import { uploadRichTextImage } from "../lib/rich-text-storage";
import { logger } from "../lib/logger";
import {
  createImageFileFilter,
  sniffAndValidateMime,
  isImageMimeType,
  stripMetadata,
} from "@workspace/upload-validation";

/**
 * Shared image-upload endpoint for the RichTextEditor component (issue
 * #520) — used by both Travels reminder descriptions and Office notes, so it
 * lives at the top level rather than under either module's route prefix.
 */
const router: IRouter = Router();

const RICH_TEXT_IMAGE_PREFIX = "/api/rich-text/upload-image";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: multerLimitForPrefix(RICH_TEXT_IMAGE_PREFIX) },
  fileFilter: createImageFileFilter((mime) => mime.startsWith("image/")),
});

router.post("/upload-image", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  const { buffer, originalname } = req.file;

  let sniffedMime: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedMime = sniffAndValidateMime(buffer, req.file.mimetype);
  } catch {
    res
      .status(400)
      .json({ error: "Only JPEG, PNG, and WebP images are supported" });
    return;
  }
  if (!isImageMimeType(sniffedMime)) {
    res
      .status(400)
      .json({ error: "Only JPEG, PNG, and WebP images are supported" });
    return;
  }

  let finalBuffer: Buffer;
  try {
    finalBuffer = await stripMetadata(buffer, sniffedMime);
  } catch {
    res.status(400).json({ error: "Could not process image file" });
    return;
  }

  try {
    const url = await uploadRichTextImage(
      finalBuffer,
      sniffedMime,
      originalname,
    );
    res.status(201).json({ url });
  } catch (err) {
    logger.error(err, "rich-text: image upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

export default router;
