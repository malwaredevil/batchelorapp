// Extended Gmail API helpers for the hub webmail feature. These functions
// go beyond the travel-scanner read-only operations in gmail-api.ts and
// support full inbox management: thread listing, full thread decoding,
// label management, send, draft CRUD, modify, and trash.
//
// Uses the same raw-fetch pattern as gmail-api.ts — no SDK dependency.
import { logger } from "./logger";
import {
  findHeader,
  type GmailMessagePart,
  type GmailMessage,
} from "./gmail-api";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

// ── Low-level fetch helpers ───────────────────────────────────────────────────

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, path, body: body.slice(0, 500) },
      "gmail-api-ext: GET failed",
    );
    throw new Error(`Gmail API GET failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function gmailPost<T>(
  accessToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, path, body: text.slice(0, 500) },
      "gmail-api-ext: POST failed",
    );
    throw new Error(`Gmail API POST failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function gmailPut<T>(
  accessToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, path, body: text.slice(0, 500) },
      "gmail-api-ext: PUT failed",
    );
    throw new Error(`Gmail API PUT failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function gmailDelete(accessToken: string, path: string): Promise<void> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, path, body: text.slice(0, 500) },
      "gmail-api-ext: DELETE failed",
    );
    throw new Error(`Gmail API DELETE failed (${res.status})`);
  }
}

// ── User profile ──────────────────────────────────────────────────────────────

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export async function getUserProfile(
  accessToken: string,
): Promise<GmailProfile> {
  return gmailGet<GmailProfile>(accessToken, "/users/me/profile");
}

// ── Labels ────────────────────────────────────────────────────────────────────

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messagesUnread?: number;
  messagesTotal?: number;
  threadsUnread?: number;
  threadsTotal?: number;
}

export async function listLabels(
  accessToken: string,
): Promise<GmailLabel[]> {
  const data = await gmailGet<{ labels: GmailLabel[] }>(
    accessToken,
    "/users/me/labels",
  );
  return data.labels ?? [];
}

export async function getLabelDetail(
  accessToken: string,
  labelId: string,
): Promise<GmailLabel> {
  return gmailGet<GmailLabel>(accessToken, `/users/me/labels/${labelId}`);
}

// ── Thread list ───────────────────────────────────────────────────────────────

export interface GmailThreadListItem {
  id: string;
  snippet: string;
  historyId: string;
}

export async function listThreads(
  accessToken: string,
  opts: {
    labelIds?: string[];
    q?: string;
    pageToken?: string;
    maxResults?: number;
  } = {},
): Promise<{ threads: GmailThreadListItem[]; nextPageToken?: string; resultSizeEstimate?: number }> {
  const params = new URLSearchParams();
  if (opts.maxResults) params.set("maxResults", String(opts.maxResults));
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  if (opts.q) params.set("q", opts.q);
  for (const id of opts.labelIds ?? []) params.append("labelIds", id);
  const data = await gmailGet<{
    threads?: GmailThreadListItem[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(accessToken, `/users/me/threads?${params.toString()}`);
  return {
    threads: data.threads ?? [],
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate,
  };
}

// ── Full thread ───────────────────────────────────────────────────────────────

export interface DecodedMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  replyTo: string;
  subject: string;
  date: string;
  snippet: string;
  isUnread: boolean;
  isStarred: boolean;
  textBody: string;
  htmlBody: string;
  attachments: {
    filename: string;
    mimeType: string;
    attachmentId: string;
    size: number;
  }[];
  labelIds: string[];
  messageIdHeader: string;
  inReplyToHeader: string;
}

function decodeBase64url(data?: string): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractParts(
  part: GmailMessagePart | undefined,
  acc: { text: string; html: string; attachments: DecodedMessage["attachments"] },
): void {
  if (!part) return;
  const mt = part.mimeType ?? "";

  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) extractParts(child, acc);
    return;
  }

  if (mt === "text/plain" && part.body?.data) {
    acc.text += decodeBase64url(part.body.data);
  } else if (mt === "text/html" && part.body?.data) {
    acc.html += decodeBase64url(part.body.data);
  } else if (part.filename && part.body?.attachmentId) {
    acc.attachments.push({
      filename: part.filename,
      mimeType: mt,
      attachmentId: part.body.attachmentId,
      size: part.body.size ?? 0,
    });
  }
}

function decodeMessage(raw: GmailMessage): DecodedMessage {
  const acc = { text: "", html: "", attachments: [] as DecodedMessage["attachments"] };
  extractParts(raw.payload, acc);

  const labelIds = (raw as unknown as { labelIds?: string[] }).labelIds ?? [];
  const isUnread = labelIds.includes("UNREAD");
  const isStarred = labelIds.includes("STARRED");

  return {
    id: raw.id,
    threadId: raw.threadId,
    from: findHeader(raw.payload, "From") ?? "",
    to: findHeader(raw.payload, "To") ?? "",
    cc: findHeader(raw.payload, "Cc") ?? "",
    replyTo: findHeader(raw.payload, "Reply-To") ?? "",
    subject: findHeader(raw.payload, "Subject") ?? "(no subject)",
    date:
      findHeader(raw.payload, "Date") ??
      (raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : ""),
    snippet: (raw as unknown as { snippet?: string }).snippet ?? "",
    isUnread,
    isStarred,
    textBody: acc.text,
    htmlBody: acc.html,
    attachments: acc.attachments,
    labelIds,
    messageIdHeader: findHeader(raw.payload, "Message-ID") ?? "",
    inReplyToHeader: findHeader(raw.payload, "In-Reply-To") ?? "",
  };
}

export interface FullThread {
  id: string;
  historyId: string;
  messages: DecodedMessage[];
}

export async function getFullThread(
  accessToken: string,
  threadId: string,
): Promise<FullThread> {
  const data = await gmailGet<{
    id: string;
    historyId: string;
    messages: (GmailMessage & { labelIds?: string[]; snippet?: string })[];
  }>(accessToken, `/users/me/threads/${threadId}?format=full`);

  return {
    id: data.id,
    historyId: data.historyId,
    messages: (data.messages ?? []).map(decodeMessage),
  };
}

// ── Thread metadata (for list view) ──────────────────────────────────────────

export interface ThreadSummary {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
  messageCount: number;
  labelIds: string[];
}

export async function getThreadSummary(
  accessToken: string,
  threadId: string,
): Promise<ThreadSummary | null> {
  try {
    const data = await gmailGet<{
      id: string;
      snippet?: string;
      messages: (GmailMessage & { labelIds?: string[]; snippet?: string })[];
    }>(
      accessToken,
      `/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`,
    );

    const msgs = data.messages ?? [];
    if (msgs.length === 0) return null;

    // Use latest message for from/date, first message for subject
    const latest = msgs[msgs.length - 1]!;
    const first = msgs[0]!;

    const labelIds = msgs.flatMap(
      (m) => (m as unknown as { labelIds?: string[] }).labelIds ?? [],
    );
    const uniqueLabels = [...new Set(labelIds)];
    const isUnread = uniqueLabels.includes("UNREAD");
    const isStarred = uniqueLabels.includes("STARRED");
    const hasAttachment = uniqueLabels.includes("HAS_ATTACHMENT") ||
      msgs.some((m) => ((m as unknown as { labelIds?: string[] }).labelIds ?? []).includes("HAS_ATTACHMENT"));

    const subject =
      findHeader(first.payload, "Subject") ??
      findHeader(latest.payload, "Subject") ??
      "(no subject)";
    const from = findHeader(latest.payload, "From") ?? "";
    const dateHeader = findHeader(latest.payload, "Date");
    const date =
      dateHeader ??
      (latest.internalDate
        ? new Date(Number(latest.internalDate)).toISOString()
        : "");

    return {
      id: data.id,
      subject,
      from,
      snippet: data.snippet ?? (latest as unknown as { snippet?: string }).snippet ?? "",
      date,
      isUnread,
      isStarred,
      hasAttachment,
      messageCount: msgs.length,
      labelIds: uniqueLabels,
    };
  } catch {
    return null;
  }
}

// ── Send / Draft ──────────────────────────────────────────────────────────────

/**
 * Build a base64url-encoded RFC 2822 message ready for the Gmail API.
 * Supports plain-text body only. Thread replies should set threadId separately.
 */
export function buildRawMessage(params: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const encodeSubject = (s: string) => {
    // Only encode if non-ASCII present, otherwise keep plain for readability.
    const needsEncoding = /[^\x20-\x7E]/.test(s);
    return needsEncoding
      ? `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`
      : s;
  };

  const lines: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    ...(params.bcc ? [`Bcc: ${params.bcc}`] : []),
    `Subject: ${encodeSubject(params.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    "",
    params.body,
  ];

  return Buffer.from(lines.join("\r\n"), "utf-8").toString("base64url");
}

export async function sendMessage(
  accessToken: string,
  raw: string,
  threadId?: string,
): Promise<{ id: string; threadId: string }> {
  const body: Record<string, string> = { raw };
  if (threadId) body.threadId = threadId;
  return gmailPost<{ id: string; threadId: string }>(
    accessToken,
    "/users/me/messages/send",
    body,
  );
}

export async function createDraft(
  accessToken: string,
  raw: string,
  threadId?: string,
): Promise<{ id: string; message: { id: string; threadId: string } }> {
  const msg: Record<string, string> = { raw };
  if (threadId) msg.threadId = threadId;
  return gmailPost(accessToken, "/users/me/drafts", { message: msg });
}

export async function updateDraft(
  accessToken: string,
  draftId: string,
  raw: string,
  threadId?: string,
): Promise<{ id: string; message: { id: string; threadId: string } }> {
  const msg: Record<string, string> = { raw };
  if (threadId) msg.threadId = threadId;
  return gmailPut(accessToken, `/users/me/drafts/${draftId}`, { message: msg });
}

export async function sendDraft(
  accessToken: string,
  draftId: string,
): Promise<{ id: string; threadId: string }> {
  return gmailPost(accessToken, `/users/me/drafts/${draftId}/send`, {});
}

export async function deleteDraft(
  accessToken: string,
  draftId: string,
): Promise<void> {
  return gmailDelete(accessToken, `/users/me/drafts/${draftId}`);
}

export interface DraftSummary {
  id: string;
  message: {
    id: string;
    threadId: string;
    snippet?: string;
  };
}

export async function listDrafts(
  accessToken: string,
  pageToken?: string,
  maxResults = 20,
): Promise<{ drafts: DraftSummary[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);
  const data = await gmailGet<{
    drafts?: DraftSummary[];
    nextPageToken?: string;
  }>(accessToken, `/users/me/drafts?${params.toString()}`);
  return { drafts: data.drafts ?? [], nextPageToken: data.nextPageToken };
}

// ── Modify ────────────────────────────────────────────────────────────────────

export async function modifyMessage(
  accessToken: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<void> {
  await gmailPost(accessToken, `/users/me/messages/${messageId}/modify`, {
    addLabelIds,
    removeLabelIds,
  });
}

export async function trashMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await gmailPost(accessToken, `/users/me/messages/${messageId}/trash`, {});
}

export async function untrashMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await gmailPost(accessToken, `/users/me/messages/${messageId}/untrash`, {});
}

// Concurrency-limited batch helper for thread summaries (same 429-prevention
// pattern as the travels inbox browser).
const THREAD_SUMMARY_CONCURRENCY = 5;

export async function getThreadSummariesLimited(
  accessToken: string,
  threadIds: string[],
): Promise<(ThreadSummary | null)[]> {
  const results: (ThreadSummary | null)[] = new Array(threadIds.length).fill(null);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= threadIds.length) return;
      results[i] = await getThreadSummary(accessToken, threadIds[i]!);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(THREAD_SUMMARY_CONCURRENCY, threadIds.length) },
      worker,
    ),
  );
  return results;
}
