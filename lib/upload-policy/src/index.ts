export const STANDARD_UPLOAD_BYTES = 25 * 1024 * 1024;
export const LARGE_UPLOAD_BYTES = 50 * 1024 * 1024;

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const DOCUMENT_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  "application/pdf",
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

export interface ClientUploadFile {
  name: string;
  size: number;
  type: string;
}

export interface UploadPolicy {
  maxBytes: number;
  mimeTypes: readonly string[];
  noun: string;
}

export const STANDARD_IMAGE_UPLOAD: UploadPolicy = {
  maxBytes: STANDARD_UPLOAD_BYTES,
  mimeTypes: IMAGE_MIME_TYPES,
  noun: "image",
};

export const LARGE_IMAGE_UPLOAD: UploadPolicy = {
  maxBytes: LARGE_UPLOAD_BYTES,
  mimeTypes: IMAGE_MIME_TYPES,
  noun: "image",
};

export const LARGE_ATTACHMENT_UPLOAD: UploadPolicy = {
  maxBytes: LARGE_UPLOAD_BYTES,
  mimeTypes: DOCUMENT_MIME_TYPES,
  noun: "attachment",
};

export type UploadPolicyResult =
  | { ok: true }
  | { ok: false; reason: "size" | "type"; message: string };

export function formatUploadSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

/**
 * Browser-safe validation that mirrors the server's route limits. The server
 * remains authoritative and performs content sniffing; this helper prevents a
 * predictable rejected upload and gives every SPA the same message.
 */
export function validateClientUpload(
  file: ClientUploadFile,
  policy: UploadPolicy,
): UploadPolicyResult {
  if (file.size > policy.maxBytes) {
    return {
      ok: false,
      reason: "size",
      message: `${file.name} is too large. Choose an ${policy.noun} no larger than ${formatUploadSize(policy.maxBytes)}.`,
    };
  }

  if (file.type && !policy.mimeTypes.includes(file.type)) {
    return {
      ok: false,
      reason: "type",
      message: `${file.name} is not a supported ${policy.noun} type.`,
    };
  }

  return { ok: true };
}
