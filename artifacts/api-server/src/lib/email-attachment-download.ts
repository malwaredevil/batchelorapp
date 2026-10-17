// Fixed security ceilings: a matching From header is not sender authentication.
export const EMAIL_ATTACHMENT_MAX_COUNT = 5;
export const EMAIL_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const EMAIL_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const EMAIL_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 15_000;

export class EmailAttachmentLimitError extends Error {}

/**
 * Bound decoded bytes, not just provider metadata or Content-Length. Charge
 * every received chunk (including failed downloads) to the caller's email budget.
 * The deadline covers both response headers and the complete streamed body.
 */
export async function downloadEmailAttachment(
  url: string,
  maxBytes: number,
  chargeBytes: (bytes: number) => void,
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    EMAIL_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Attachment download failed");
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > maxBytes) {
      throw new EmailAttachmentLimitError("Attachment exceeds size limit");
    }
    if (!response.body) throw new Error("Attachment has no body");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chargeBytes(value.byteLength);
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new EmailAttachmentLimitError("Attachment exceeds size limit");
      }
      chunks.push(value);
    }
    if (bytes === 0) throw new Error("Attachment is empty");
    return Buffer.concat(chunks, bytes);
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Do not let a remote cancellation delay the deadline or rejection.
    void reader?.cancel().catch(() => {});
  }
}
