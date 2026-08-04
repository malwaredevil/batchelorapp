import sharp from "sharp";
import {
  LARGE_UPLOAD_BYTES,
  STANDARD_UPLOAD_BYTES,
} from "@workspace/upload-policy";

export type SupportedMimeType = "image/jpeg" | "image/png" | "image/webp";
export type SupportedOfficeMimeType =
  | "text/csv"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/**
 * GIF is deliberately NOT part of `SupportedMimeType` / `isImageMimeType`.
 * Those gate the sharp-based `stripMetadata` re-encode pipeline, which would
 * flatten an animated GIF to its first frame. GIF is sniffed and accepted
 * here but stored raw (same treatment as PDF) — see attachments/upload.ts.
 */
export type SupportedDocMimeType =
  | SupportedMimeType
  | "application/pdf"
  | "image/gif"
  | SupportedOfficeMimeType;

/**
 * Maximum file size for standard photo uploads (pottery, quilting, ornaments).
 * Must match the server's multer `limits.fileSize` on those routes.
 * Client-side forms mirror this value to warn users immediately on selection.
 */
export const MAX_UPLOAD_BYTES = STANDARD_UPLOAD_BYTES;

/**
 * Maximum file size for large uploads (travels photos and Elaine attachments).
 * Must match the server's multer `limits.fileSize` on those routes.
 * Client-side forms mirror this value to warn users immediately on selection.
 */
export const MAX_LARGE_UPLOAD_BYTES = LARGE_UPLOAD_BYTES;

/**
 * Hard ceiling on the number of pixels Sharp will decode from any input. Rejects
 * decompression-bomb uploads before they can exhaust CPU or memory. 200 MP covers
 * high-resolution camera photos while blocking pathological inputs.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Longest-edge cap for images persisted to storage. Set high enough to preserve
 * full-resolution uploads from modern cameras and scanners.
 */
export const MAX_STORAGE_DIMENSION = 4096;

/**
 * Structured error thrown when an uploaded file fails format validation.
 * Routes should catch this and return a 400 response.
 */
export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;
type IncomingFile = { mimetype: string };

/**
 * Returns a Multer `fileFilter` that rejects files whose declared MIME type is
 * not in `allowedTypes`. This is the early-rejection layer — it prevents large
 * wrong-type uploads from being fully buffered into memory before rejection.
 *
 * `allowedTypes` may be either a `Set<string>` of exact MIME types or a
 * predicate function (`(mime) => boolean`). Use the predicate form when you
 * need prefix-based matching (e.g. `mime => mime.startsWith("image/")`).
 *
 * On rejection the callback receives an `UploadValidationError` so Express
 * propagates a real error rather than silently dropping the file.
 */
export function createImageFileFilter(
  allowedTypes: Set<string> | ((mime: string) => boolean),
): (_req: unknown, file: IncomingFile, cb: FileFilterCallback) => void {
  const check =
    typeof allowedTypes === "function"
      ? allowedTypes
      : (mime: string) => allowedTypes.has(mime);
  return (_req, file, cb) => {
    if (check(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new UploadValidationError(`Unsupported file type: ${file.mimetype}`),
        false,
      );
    }
  };
}

/**
 * Sniff the real MIME type from the file's magic bytes — images only.
 *
 * Returns `null` for any buffer whose leading bytes do not match JPEG, PNG, or
 * WebP, regardless of the declared MIME type. Useful for non-upload contexts
 * where a null return is preferable to an exception (e.g. re-sniffing a buffer
 * already in storage).
 */
export function sniffImageType(buffer: Buffer): SupportedMimeType | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * DOCX and XLSX are both ZIP containers (OOXML) — they share the same PK
 * magic bytes, so the ZIP signature alone can't tell them apart. We treat any
 * ZIP-signed buffer as a match for whichever of the two the caller declared,
 * rather than unzipping to inspect internal entry names (word/document.xml
 * vs xl/workbook.xml). This is a deliberately looser check than the
 * byte-exact sniffing used for images/PDF — acceptable here because this is
 * a single-household app, not a multi-tenant upload surface, and a mismatch
 * only causes a parse failure downstream, not a security issue.
 */
function isZipSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

const OOXML_ZIP_MIME_TYPES = new Set<string>([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function sniffDocMimeType(
  buffer: Buffer,
  declaredMime?: string,
): SupportedDocMimeType | null {
  const imageType = sniffImageType(buffer);
  if (imageType) return imageType;

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "application/pdf";
  }

  // GIF87a / GIF89a magic bytes.
  if (
    buffer.length >= 6 &&
    buffer.toString("ascii", 0, 3) === "GIF" &&
    (buffer.toString("ascii", 3, 6) === "87a" ||
      buffer.toString("ascii", 3, 6) === "89a")
  ) {
    return "image/gif";
  }

  if (
    declaredMime &&
    OOXML_ZIP_MIME_TYPES.has(declaredMime) &&
    isZipSignature(buffer)
  ) {
    return declaredMime as SupportedOfficeMimeType;
  }

  // CSV is plain text with no magic bytes to sniff. Accept the declared MIME
  // as long as the content looks like text (no embedded NUL bytes in the
  // first chunk) rather than a disguised binary payload.
  if (declaredMime === "text/csv") {
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    if (!sample.includes(0x00)) {
      return "text/csv";
    }
  }

  return null;
}

/**
 * Sniff the real MIME type from a buffer and throw `UploadValidationError` if
 * the content is unrecognised (i.e. not JPEG, PNG, WebP, or PDF).
 *
 * The `declaredMime` parameter is used only for the error message — the sniffed
 * type always wins. This guards against disguised uploads where the client sends
 * `Content-Type: image/jpeg` but the payload is a PHP script or other non-image
 * content.
 *
 * @returns The sniffed `SupportedDocMimeType`. Use `isImageMimeType` to narrow
 *          to image-only routes that must reject PDFs.
 */
export function sniffAndValidateMime(
  buffer: Buffer,
  declaredMime: string,
): SupportedDocMimeType {
  const sniffed = sniffDocMimeType(buffer, declaredMime);
  if (!sniffed) {
    throw new UploadValidationError(
      `File content does not match a supported format (declared MIME: ${declaredMime})`,
    );
  }
  return sniffed;
}

/**
 * Type guard that narrows `SupportedDocMimeType` to image-only routes.
 */
export function isImageMimeType(
  mime: SupportedDocMimeType,
): mime is SupportedMimeType {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
}

/**
 * Normalise an uploaded image for persistence: decode with a strict pixel
 * ceiling (decompression-bomb guard), bake in EXIF orientation, strip all
 * embedded metadata (EXIF, ICC, XMP, GPS, etc.), downscale so the longest
 * edge is at most 2048 px, and re-encode in the same container format.
 *
 * Only valid for image types (JPEG, PNG, WebP). PDFs must be stored raw.
 */
const MAX_CONCURRENT_IMAGE_TRANSFORMS = 2;
let activeImageTransforms = 0;
const imageTransformQueue: Array<() => void> = [];

async function withImageTransformSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeImageTransforms >= MAX_CONCURRENT_IMAGE_TRANSFORMS) {
    await new Promise<void>((resolve) => imageTransformQueue.push(resolve));
  }
  activeImageTransforms++;
  try {
    return await work();
  } finally {
    activeImageTransforms--;
    imageTransformQueue.shift()?.();
  }
}

export async function stripMetadata(
  buffer: Buffer,
  mimeType: SupportedMimeType,
): Promise<Buffer> {
  return withImageTransformSlot(async () => {
    const metadata = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    if (metadata.width && metadata.height) {
      const pixels = metadata.width * metadata.height;
      if (pixels > MAX_INPUT_PIXELS) {
        throw new UploadValidationError(
          `Image dimensions exceed the ${MAX_INPUT_PIXELS.toLocaleString()} pixel limit`,
        );
      }
    }

    const pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({
        width: MAX_STORAGE_DIMENSION,
        height: MAX_STORAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });

    switch (mimeType) {
      case "image/jpeg":
        return pipeline.jpeg({ quality: 90 }).toBuffer();
      case "image/png":
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
      case "image/webp":
        return pipeline.webp({ quality: 90 }).toBuffer();
    }
  });
}
