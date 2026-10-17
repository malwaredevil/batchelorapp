import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadEmailAttachment,
  EmailAttachmentLimitError,
  EMAIL_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  EMAIL_ATTACHMENT_MAX_COUNT,
  EMAIL_ATTACHMENT_MAX_FILE_BYTES,
  EMAIL_ATTACHMENT_MAX_TOTAL_BYTES,
} from "./email-attachment-download";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  image: vi.fn(),
  pdf: vi.fn(),
  suggest: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { receiving: { attachments: { list: mocks.list } } };
  },
}));
vi.mock("./env", () => ({ env: { resendApiKey: "test-key" } }));
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: { insert: mocks.insert },
}));
vi.mock("./travels-storage", () => ({ uploadDocument: mocks.upload }));
vi.mock("./travel-document-extraction", () => ({
  extractFromImage: mocks.image,
  extractFromPdf: mocks.pdf,
  extractFromEmailText: vi.fn(),
}));
vi.mock("./gmail-scan", () => ({ suggestTripId: mocks.suggest }));
vi.mock("../routes/travels/documents", () => ({
  syncItineraryFromDocument: vi.fn(),
  indexDocumentChunks: vi.fn(),
}));

import { processEmailAttachments } from "./elaine-email-attachments";

const params = {
  emailId: "test-email",
  userId: 1,
  fromEmail: "member@example.com",
  subject: "Booking",
};
const attachment = (overrides = {}) => ({
  id: "attachment",
  filename: "booking.png",
  content_type: "image/png",
  download_url: "https://attachments.example.com/file",
  size: 4,
  ...overrides,
});

function streamed(chunks: Uint8Array[], headers?: Record<string, string>) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
    cancel,
  });
  return new Response(body, { headers });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({
    data: { data: [attachment()], has_more: false },
  });
  mocks.upload.mockResolvedValue("stored/path");
  mocks.image.mockResolvedValue({ data: {}, sourceSpans: null });
  mocks.pdf.mockResolvedValue({ data: {}, sourceSpans: null });
  mocks.suggest.mockResolvedValue(null);
  mocks.values.mockReturnValue({ returning: async () => [{ id: 42 }] });
  mocks.insert.mockReturnValue({ values: mocks.values });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () => new Response(new Uint8Array([1, 2, 3, 4])),
      ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function expectNoProcessing() {
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.pdf).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
}

describe("inbound attachment resource limits", () => {
  it("preserves storage and extraction for a normal attachment", async () => {
    expect(await processEmailAttachments(params)).toEqual([
      { filename: "booking.png", outcome: "unmatched", tripTitle: undefined },
    ]);
    expect(mocks.upload).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3, 4]),
      "image/png",
      "booking.png",
    );
    expect(mocks.image).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "rejects excess count/pagination before downloading (has_more=%s)",
    async (hasMore) => {
      mocks.list.mockResolvedValue({
        data: {
          data: Array.from(
            { length: hasMore ? 1 : EMAIL_ATTACHMENT_MAX_COUNT + 1 },
            () => attachment(),
          ),
          has_more: hasMore,
        },
      });
      expect(await processEmailAttachments(params)).toEqual([
        {
          filename: "Email attachments",
          outcome: "skipped",
          reason: "resource_limit",
        },
      ]);
      expect(mocks.list).toHaveBeenCalledWith({
        emailId: params.emailId,
        limit: EMAIL_ATTACHMENT_MAX_COUNT + 1,
      });
      expect(fetch).not.toHaveBeenCalled();
      expectNoProcessing();
    },
  );

  it("allows exactly the maximum count", async () => {
    mocks.list.mockResolvedValue({
      data: {
        data: Array.from({ length: EMAIL_ATTACHMENT_MAX_COUNT }, () =>
          attachment(),
        ),
        has_more: false,
      },
    });
    expect(await processEmailAttachments(params)).toHaveLength(
      EMAIL_ATTACHMENT_MAX_COUNT,
    );
    expect(mocks.image).toHaveBeenCalledTimes(EMAIL_ATTACHMENT_MAX_COUNT);
  });

  it("rejects an oversized provider size before fetching", async () => {
    mocks.list.mockResolvedValue({
      data: {
        data: [attachment({ size: EMAIL_ATTACHMENT_MAX_FILE_BYTES + 1 })],
      },
    });
    expect((await processEmailAttachments(params))[0].reason).toBe(
      "resource_limit",
    );
    expect(fetch).not.toHaveBeenCalled();
    expectNoProcessing();
  });

  it("enforces the aggregate byte budget before storage or AI", async () => {
    mocks.list.mockResolvedValue({
      data: {
        data: Array.from({ length: EMAIL_ATTACHMENT_MAX_COUNT }, () =>
          attachment(),
        ),
      },
    });
    vi.mocked(fetch).mockImplementation(async () =>
      streamed([new Uint8Array(EMAIL_ATTACHMENT_MAX_FILE_BYTES)]),
    );
    const outcomes = await processEmailAttachments(params);
    const allowed =
      EMAIL_ATTACHMENT_MAX_TOTAL_BYTES / EMAIL_ATTACHMENT_MAX_FILE_BYTES;
    expect(fetch).toHaveBeenCalledTimes(allowed);
    expect(mocks.upload).toHaveBeenCalledTimes(allowed);
    expect(mocks.image).toHaveBeenCalledTimes(allowed);
    expect(
      outcomes.slice(allowed).every((o) => o.reason === "resource_limit"),
    ).toBe(true);
  });

  it("charges bytes from rejected streams against the email budget too", async () => {
    mocks.list.mockResolvedValue({
      data: {
        data: Array.from({ length: EMAIL_ATTACHMENT_MAX_COUNT }, () =>
          attachment(),
        ),
      },
    });
    vi.mocked(fetch).mockImplementation(async () =>
      streamed([new Uint8Array(EMAIL_ATTACHMENT_MAX_FILE_BYTES + 1)]),
    );
    const outcomes = await processEmailAttachments(params);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(outcomes.every((o) => o.reason === "resource_limit")).toBe(true);
    expectNoProcessing();
  });

  it("never saves or analyzes a failed HTTP response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("error", { status: 503 }));
    expect((await processEmailAttachments(params))[0].outcome).toBe("failed");
    expectNoProcessing();
  });

  it("still skips unsupported files without fetching", async () => {
    mocks.list.mockResolvedValue({
      data: { data: [attachment({ content_type: "application/zip" })] },
    });
    expect((await processEmailAttachments(params))[0].outcome).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
    expectNoProcessing();
  });
});

describe("bounded attachment download", () => {
  it("accepts the exact byte boundary without Content-Length", async () => {
    vi.mocked(fetch).mockResolvedValue(
      streamed([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
    );
    const charge = vi.fn();
    expect(
      await downloadEmailAttachment("https://example.com", 4, charge),
    ).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(charge.mock.calls).toEqual([[2], [2]]);
  });

  it("rejects excessive Content-Length without consuming the body", async () => {
    const charge = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      streamed([new Uint8Array(1)], { "content-length": "5" }),
    );
    await expect(
      downloadEmailAttachment("https://example.com", 4, charge),
    ).rejects.toBeInstanceOf(EmailAttachmentLimitError);
    expect(charge).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])(
    "rejects streaming overflow with missing/lying Content-Length (%s)",
    async (length) => {
      const cancel = vi.fn();
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(3));
              c.enqueue(new Uint8Array(3));
            },
            cancel,
          }),
          { headers: length ? { "content-length": length } : undefined },
        ),
      );
      await expect(
        downloadEmailAttachment("https://example.com", 4, vi.fn()),
      ).rejects.toBeInstanceOf(EmailAttachmentLimitError);
      expect(cancel).toHaveBeenCalled();
      expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    },
  );

  it.each(["headers", "body"])(
    "aborts a stalled download during %s",
    async (stage) => {
      vi.useFakeTimers();
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        const signal = init!.signal!;
        if (stage === "headers") {
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        }
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(1));
              signal.addEventListener(
                "abort",
                () => c.error(new Error("aborted")),
                { once: true },
              );
            },
          }),
        );
      });
      const result = processEmailAttachments(params);
      await vi.advanceTimersByTimeAsync(EMAIL_ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
      expect((await result)[0].outcome).toBe("failed");
      expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
      expectNoProcessing();
    },
  );
});
