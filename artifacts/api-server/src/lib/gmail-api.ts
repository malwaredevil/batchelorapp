// Gmail API access on behalf of a connected user (per-user OAuth, see
// gmail-oauth.ts / gmail-tokens.ts). Each function takes that user's live
// access token and talks to the Gmail REST API directly — no SDK, mirroring
// google-calendar.ts's raw-fetch pattern.
import { logger } from "./logger";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

async function gmailApiJson<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, path, body: body.slice(0, 500) },
      "gmail-api: request failed",
    );
    throw new Error(`Gmail API request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface GmailMessageListItem {
  id: string;
  threadId: string;
}

/**
 * Search the user's mailbox with a Gmail search query, paging through all
 * results (Gmail's API caps each page at 100 ids). Bounded by maxResults so
 * a single scan can never run away against a huge mailbox.
 */
export async function searchMessages(
  accessToken: string,
  query: string,
  maxResults = 300,
): Promise<GmailMessageListItem[]> {
  const results: GmailMessageListItem[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(100, maxResults - results.length)),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gmailApiJson<{
      messages?: GmailMessageListItem[];
      nextPageToken?: string;
    }>(accessToken, `/users/me/messages?${params.toString()}`);
    results.push(...(page.messages ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && results.length < maxResults);
  return results.slice(0, maxResults);
}

export interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  return gmailApiJson<GmailMessage>(
    accessToken,
    `/users/me/messages/${messageId}?format=full`,
  );
}

/**
 * A single page of raw search results (id + threadId only) — used by the
 * manual inbox browser, which needs pagination rather than the bulk
 * scanner's "fetch everything up to a cap" behaviour (see searchMessages).
 */
export async function searchMessagesPage(
  accessToken: string,
  query: string,
  pageToken?: string,
  maxResults = 25,
): Promise<{ messages: GmailMessageListItem[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  });
  if (pageToken) params.set("pageToken", pageToken);
  const page = await gmailApiJson<{
    messages?: GmailMessageListItem[];
    nextPageToken?: string;
  }>(accessToken, `/users/me/messages?${params.toString()}`);
  return { messages: page.messages ?? [], nextPageToken: page.nextPageToken };
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  date: Date | null;
  snippet: string;
}

/**
 * Lightweight metadata-only fetch (no body/attachments) for listing search
 * results in the manual inbox browser without paying for the full message
 * payload on every row.
 */
export async function getMessageSummary(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageSummary> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "Subject");
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Date");
  const msg = await gmailApiJson<GmailMessage>(
    accessToken,
    `/users/me/messages/${messageId}?${params.toString()}`,
  );
  const dateHeader = findHeader(msg.payload, "Date");
  const date = dateHeader
    ? new Date(dateHeader)
    : msg.internalDate
      ? new Date(Number(msg.internalDate))
      : null;
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: findHeader(msg.payload, "Subject"),
    from: findHeader(msg.payload, "From"),
    date: date && !isNaN(date.getTime()) ? date : null,
    snippet: msg.snippet ?? "",
  };
}

export async function getAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const data = await gmailApiJson<{ data: string; size: number }>(
    accessToken,
    `/users/me/messages/${messageId}/attachments/${attachmentId}`,
  );
  // Gmail uses URL-safe base64 without padding.
  return Buffer.from(data.data, "base64url");
}

export function findHeader(
  payload: GmailMessagePart | undefined,
  name: string,
): string | null {
  const header = payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

function decodeBody(data?: string): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

export interface GmailAttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size?: number;
}

export interface ParsedGmailMessage {
  subject: string | null;
  from: string | null;
  date: Date | null;
  textBody: string;
  attachments: GmailAttachmentRef[];
}

const INLINE_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

/**
 * Flattens a (possibly multipart, possibly nested) Gmail message into plain
 * text content plus a list of downloadable attachment refs, ready for AI
 * extraction — mirrors the shape extractFromImage/extractFromPdf expect.
 */
export function parseGmailMessage(message: GmailMessage): ParsedGmailMessage {
  const subject = findHeader(message.payload, "Subject");
  const from = findHeader(message.payload, "From");
  const dateHeader = findHeader(message.payload, "Date");
  const date = dateHeader
    ? new Date(dateHeader)
    : message.internalDate
      ? new Date(Number(message.internalDate))
      : null;

  let textBody = "";
  const attachments: GmailAttachmentRef[] = [];

  function walk(part: GmailMessagePart | undefined): void {
    if (!part) return;
    const mimeType = part.mimeType ?? "";
    if (
      part.filename &&
      part.body?.attachmentId &&
      INLINE_ATTACHMENT_TYPES.has(mimeType)
    ) {
      attachments.push({
        filename: part.filename,
        mimeType,
        attachmentId: part.body.attachmentId,
        size: part.body.size,
      });
    } else if (mimeType === "text/plain" && part.body?.data) {
      textBody += decodeBody(part.body.data);
    } else if (mimeType === "text/html" && part.body?.data && !textBody) {
      // Fall back to a very rough HTML strip only if no plain-text part exists.
      textBody += decodeBody(part.body.data).replace(/<[^>]+>/g, " ");
    }
    for (const child of part.parts ?? []) walk(child);
  }
  walk(message.payload);

  return {
    subject,
    from,
    date: date && !isNaN(date.getTime()) ? date : null,
    textBody: textBody.slice(0, 8000),
    attachments,
  };
}
