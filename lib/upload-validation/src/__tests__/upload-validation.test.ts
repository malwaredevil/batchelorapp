import sharp from "sharp";
import { describe, it, expect, beforeAll } from "vitest";
import {
  createImageFileFilter,
  sniffAndValidateMime,
  sniffImageType,
  stripMetadata,
  isImageMimeType,
  UploadValidationError,
} from "../index.js";

const JPEG_MAGIC = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const WEBP_MAGIC = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
]);
const PDF_MAGIC = Buffer.from("%PDF-1.4 this is a pdf");
const DISGUISED = Buffer.from("<?php echo 'hello'; ?>");

let tinyJpeg: Buffer;
let tinyPng: Buffer;
let tinyWebp: Buffer;

beforeAll(async () => {
  const base = {
    create: {
      width: 1,
      height: 1,
      channels: 3 as const,
      background: { r: 100, g: 100, b: 100 },
    },
  };
  [tinyJpeg, tinyPng, tinyWebp] = await Promise.all([
    sharp(base).jpeg().toBuffer(),
    sharp(base).png().toBuffer(),
    sharp(base).webp().toBuffer(),
  ]);
});

describe("createImageFileFilter", () => {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  const filter = createImageFileFilter(allowed);

  it("accepts a file whose MIME type is in the allowed set", () => {
    return new Promise<void>((resolve) => {
      filter({}, { mimetype: "image/jpeg" }, (err, accept) => {
        expect(err).toBeNull();
        expect(accept).toBe(true);
        resolve();
      });
    });
  });

  it("rejects a file whose MIME type is not in the allowed set", () => {
    return new Promise<void>((resolve) => {
      filter({}, { mimetype: "image/gif" }, (err, accept) => {
        expect(err).toBeInstanceOf(UploadValidationError);
        expect(accept).toBe(false);
        resolve();
      });
    });
  });

  it("rejects application/pdf when not in the allowed set", () => {
    return new Promise<void>((resolve) => {
      filter({}, { mimetype: "application/pdf" }, (err, accept) => {
        expect(err).toBeInstanceOf(UploadValidationError);
        expect(accept).toBe(false);
        resolve();
      });
    });
  });

  it("accepts application/pdf when included in the allowed set", () => {
    const withPdf = new Set(["image/jpeg", "application/pdf"]);
    const f = createImageFileFilter(withPdf);
    return new Promise<void>((resolve) => {
      f({}, { mimetype: "application/pdf" }, (err, accept) => {
        expect(err).toBeNull();
        expect(accept).toBe(true);
        resolve();
      });
    });
  });
});

describe("sniffAndValidateMime", () => {
  it("detects JPEG from magic bytes", () => {
    expect(sniffAndValidateMime(JPEG_MAGIC, "image/jpeg")).toBe("image/jpeg");
  });

  it("detects PNG from magic bytes", () => {
    expect(sniffAndValidateMime(PNG_MAGIC, "image/png")).toBe("image/png");
  });

  it("detects WebP from magic bytes", () => {
    expect(sniffAndValidateMime(WEBP_MAGIC, "image/webp")).toBe("image/webp");
  });

  it("detects PDF from magic bytes", () => {
    expect(sniffAndValidateMime(PDF_MAGIC, "application/pdf")).toBe(
      "application/pdf",
    );
  });

  it("throws UploadValidationError for a disguised file (wrong magic bytes)", () => {
    expect(() => sniffAndValidateMime(DISGUISED, "image/jpeg")).toThrow(
      UploadValidationError,
    );
  });

  it("throws UploadValidationError for an empty buffer", () => {
    expect(() => sniffAndValidateMime(Buffer.alloc(0), "image/jpeg")).toThrow(
      UploadValidationError,
    );
  });

  it("throws UploadValidationError for a too-short buffer", () => {
    expect(() =>
      sniffAndValidateMime(Buffer.from([0xff, 0xd8]), "image/jpeg"),
    ).toThrow(UploadValidationError);
  });

  it("returns the sniffed type even when declared MIME differs", () => {
    expect(sniffAndValidateMime(JPEG_MAGIC, "image/png")).toBe("image/jpeg");
  });
});

describe("sniffImageType", () => {
  it("returns null for a PDF buffer", () => {
    expect(sniffImageType(PDF_MAGIC)).toBeNull();
  });

  it("returns null for a short buffer", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("returns null for unrecognised content", () => {
    expect(sniffImageType(DISGUISED)).toBeNull();
  });
});

describe("isImageMimeType", () => {
  it("returns true for image types", () => {
    expect(isImageMimeType("image/jpeg")).toBe(true);
    expect(isImageMimeType("image/png")).toBe(true);
    expect(isImageMimeType("image/webp")).toBe(true);
  });

  it("returns false for application/pdf", () => {
    expect(isImageMimeType("application/pdf")).toBe(false);
  });
});

describe("stripMetadata", () => {
  it("processes a JPEG buffer and returns a non-empty Buffer", async () => {
    const result = await stripMetadata(tinyJpeg, "image/jpeg");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
  });

  it("processes a PNG buffer and returns a non-empty Buffer", async () => {
    const result = await stripMetadata(tinyPng, "image/png");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe(0x89);
  });

  it("processes a WebP buffer and returns a non-empty Buffer", async () => {
    const result = await stripMetadata(tinyWebp, "image/webp");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("strips EXIF metadata from a real JPEG with embedded metadata", async () => {
    const withExif = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .withMetadata({ exif: { IFD0: { Copyright: "test" } } })
      .jpeg()
      .toBuffer();

    const stripped = await stripMetadata(withExif, "image/jpeg");
    const meta = await sharp(stripped).metadata();
    expect(meta.exif).toBeUndefined();
  });
});
