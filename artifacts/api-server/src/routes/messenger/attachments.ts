import { Router, type IRouter } from "express";
import multer from "multer";
import { ensureBucket, uploadFile } from "../../lib/messenger/storage";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ALLOWED_MIME_PREFIXES = ["image/", "application/pdf"];

function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

router.post(
  "/attachments/upload",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const { mimetype, originalname, buffer, size } = req.file;

    if (!isAllowedMime(mimetype)) {
      res
        .status(400)
        .json({
          error:
            "Only images and PDFs are supported",
        });
      return;
    }

    try {
      await ensureBucket();
      const storagePath = await uploadFile(buffer, mimetype, originalname);
      const { getSignedUrls } = await import("../../lib/messenger/storage");
      const urlMap = await getSignedUrls([storagePath]);
      const url = urlMap.get(storagePath) ?? "";

      logger.info(
        { path: storagePath, size, mime: mimetype },
        "messenger: attachment uploaded",
      );

      res.status(201).json({
        storagePath,
        url,
        mimeType: mimetype,
        fileName: originalname,
        sizeBytes: size,
      });
    } catch (err) {
      logger.error(err, "messenger: attachment upload failed");
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

export default router;
