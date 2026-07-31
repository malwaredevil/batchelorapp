import { describe, expect, it } from "vitest";
import {
  LARGE_ATTACHMENT_UPLOAD,
  STANDARD_IMAGE_UPLOAD,
  STANDARD_UPLOAD_BYTES,
  validateClientUpload,
} from "./index";

describe("validateClientUpload", () => {
  it("accepts a standard image at the size boundary", () => {
    expect(
      validateClientUpload(
        {
          name: "photo.jpg",
          size: STANDARD_UPLOAD_BYTES,
          type: "image/jpeg",
        },
        STANDARD_IMAGE_UPLOAD,
      ),
    ).toEqual({ ok: true });
  });

  it("rejects an oversized standard image with the shared limit", () => {
    const result = validateClientUpload(
      {
        name: "photo.jpg",
        size: STANDARD_UPLOAD_BYTES + 1,
        type: "image/jpeg",
      },
      STANDARD_IMAGE_UPLOAD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("size");
      expect(result.message).toContain("25 MB");
    }
  });

  it("allows PDFs only for attachment policies", () => {
    const pdf = {
      name: "document.pdf",
      size: 1024,
      type: "application/pdf",
    };
    expect(validateClientUpload(pdf, STANDARD_IMAGE_UPLOAD).ok).toBe(false);
    expect(validateClientUpload(pdf, LARGE_ATTACHMENT_UPLOAD)).toEqual({
      ok: true,
    });
  });
});
