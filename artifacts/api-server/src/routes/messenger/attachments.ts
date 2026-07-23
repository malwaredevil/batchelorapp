import { Router, type IRouter } from "express";
import multer from "multer";
import { multerLimitForPrefix } from "../../lib/upload-limits";
import { ensureBucket, uploadFile } from "../../lib/messenger/storage";
import { logger } from "../../lib/logger";
import {
  createImageFileFilter,
  sniffAndValidateMime,
  isImageMimeType,
  stripMetadata,
} from "@workspace/upload-validation";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: multerLimitForPrefix("/api/messenger/attachments/") },
  fileFilter: createImageFileFilter(
    (mime) => mime.startsWith("image/") || mime === "application/pdf",
  ),
});

router.post("/attachments/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }

  const { buffer, originalname, size } = req.file;

  let sniffedMime: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedMime = sniffAndValidateMime(buffer, req.file.mimetype);
  } catch {
    res.status(400).json({
      error: "Only images (JPEG, PNG, WebP) and PDFs are supported",
    });
    return;
  }

  const mimeType = sniffedMime;

  let finalBuffer = buffer;
  if (isImageMimeType(sniffedMime)) {
    try {
      finalBuffer = await stripMetadata(buffer, sniffedMime);
    } catch {
      res.status(400).json({ error: "Could not process image file" });
      return;
    }
  }

  try {
    await ensureBucket();
    const storagePath = await uploadFile(finalBuffer, mimeType, originalname);
    const { getSignedUrls } = await import("../../lib/messenger/storage");
    const urlMap = await getSignedUrls([storagePath]);
    const url = urlMap.get(storagePath) ?? "";

    logger.info(
      { path: storagePath, size, mime: mimeType },
      "messenger: attachment uploaded",
    );

    res.status(201).json({
      storagePath,
      url,
      mimeType,
      fileName: originalname,
      sizeBytes: size,
    });
  } catch (err) {
    logger.error(err, "messenger: attachment upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

export default router;
