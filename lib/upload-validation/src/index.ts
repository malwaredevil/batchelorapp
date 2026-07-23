import sharp from "sharp";

export type SupportedMimeType = "image/jpeg" | "image/png" | "image/webp";
export type SupportedDocMimeType = SupportedMimeType | "application/pdf";

/**
 * Maximum file size for standard photo uploads (pottery, quilting, ornaments).
 * Must match the server's multer `limits.fileSize` on those routes.
 * Client-side forms mirror this value to warn users immediately on selection.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Maximum file size for large uploads (travels photos and Elaine attachments).
 * Must match the server's multer `limits.fileSize` on those routes.
 * Client-side forms mirror this value to warn users immediately on selection.
 */
export const MAX_LARGE_UPLOAD_BYTES = 21 * 1024 * 1024; // 21 MB

/**
 * Hard ceiling on the number of pixels Sharp will decode from any input. Rejects
 * decompression-bomb uploads before they can exhaust CPU or memory. 50 MP covers
 * any real phone/camera photo while blocking pathological inputs.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Longest-edge cap for images persisted to storage. Keeps uploads at a sane size
 * without letting a single file balloon storage or downstream AI payloads.
 */
const MAX_STORAGE_DIMENSION = 2048;

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

function sniffDocMimeType(buffer: Buffer): SupportedDocMimeType | null {
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
  const sniffed = sniffDocMimeType(buffer);
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
  return mime !== "application/pdf";
}

/**
 * Normalise an uploaded image for persistence: decode with a strict pixel
 * ceiling (decompression-bomb guard), bake in EXIF orientation, strip all
 * embedded metadata (EXIF, ICC, XMP, GPS, etc.), downscale so the longest
 * edge is at most 2048 px, and re-encode in the same container format.
 *
 * Only valid for image types (JPEG, PNG, WebP). PDFs must be stored raw.
 */
export async function stripMetadata(
  buffer: Buffer,
  mimeType: SupportedMimeType,
): Promise<Buffer> {
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
      return pipeline.jpeg().toBuffer();
    case "image/png":
      return pipeline.png().toBuffer();
    case "image/webp":
      return pipeline.webp().toBuffer();
  }
}
