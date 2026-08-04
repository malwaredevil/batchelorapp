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

const MESSENGER_ATTACHMENT_PREFIX = "/api/messenger/attachments/";
const messengerMaxFileBytes = multerLimitForPrefix(MESSENGER_ATTACHMENT_PREFIX);

/**
 * Hosts allowed for the server-side GIF fetch below. The client only ever
 * sends back a URL that our own /gifs/search or /gifs/trending response
 * handed it, but we re-validate against GIPHY's CDN hosts here rather than
 * trusting the client — an open "fetch any URL the client gives me" endpoint
 * is an SSRF vector regardless of where the URL is supposed to have come
 * from.
 */
const ALLOWED_GIF_HOSTS = new Set(["media.giphy.com", "i.giphy.com"]);

function isAllowedGifHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname;
    return ALLOWED_GIF_HOSTS.has(host) || /\.giphy\.com$/.test(host);
  } catch {
    return false;
  }
}

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
      error: "Only images (JPEG, PNG, WebP, GIF) and PDFs are supported",
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

/**
 * Turn a GIF the user picked from the GIF tab into a real messenger
 * attachment: fetch the bytes server-side (never trust the client to have
 * uploaded them), store them in the same Supabase bucket as manually
 * uploaded files, and return the same shape `/attachments/upload` does so
 * the frontend can drop it straight into `pendingAttachments`.
 */
router.post("/attachments/from-gif", async (req, res) => {
  const { url, title } = req.body as { url?: string; title?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }
  if (!isAllowedGifHost(url)) {
    res.status(400).json({ error: "Unsupported GIF source" });
    return;
  }

  let buffer: Buffer;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      res.status(502).json({ error: "Could not fetch GIF" });
      return;
    }
    const contentLength = Number(resp.headers.get("content-length") ?? 0);
    if (contentLength > messengerMaxFileBytes) {
      res.status(413).json({ error: "GIF is too large" });
      return;
    }
    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength > messengerMaxFileBytes) {
      res.status(413).json({ error: "GIF is too large" });
      return;
    }
    buffer = Buffer.from(arrayBuffer);
  } catch (err) {
    logger.error(err, "messenger: gif fetch failed");
    res.status(502).json({ error: "Could not fetch GIF" });
    return;
  }

  let sniffedMime: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedMime = sniffAndValidateMime(buffer, "image/gif");
  } catch {
    res.status(400).json({ error: "That link is not a valid GIF" });
    return;
  }
  if (sniffedMime !== "image/gif") {
    res.status(400).json({ error: "That link is not a valid GIF" });
    return;
  }

  const fileName = `${(title || "gif").replace(/[^a-z0-9-_ ]/gi, "").slice(0, 60) || "gif"}.gif`;

  try {
    await ensureBucket();
    const storagePath = await uploadFile(buffer, sniffedMime, fileName);
    const { getSignedUrls } = await import("../../lib/messenger/storage");
    const urlMap = await getSignedUrls([storagePath]);
    const signedUrl = urlMap.get(storagePath) ?? "";

    logger.info(
      { path: storagePath, size: buffer.length },
      "messenger: gif attachment created",
    );

    res.status(201).json({
      storagePath,
      url: signedUrl,
      mimeType: sniffedMime,
      fileName,
      sizeBytes: buffer.length,
    });
  } catch (err) {
    logger.error(err, "messenger: gif attachment failed");
    res.status(500).json({ error: "Could not save GIF" });
  }
});

export default router;
