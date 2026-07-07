import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

const API = "/api/gmail";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailStatus {
  connected: boolean;
  email: string | null;
  profile: GmailProfile | null;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messagesUnread?: number;
  messagesTotal?: number;
  threadsUnread?: number;
  threadsTotal?: number;
}

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

export interface ThreadMessage {
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

export interface FullThread {
  id: string;
  historyId: string;
  messages: ThreadMessage[];
}

export interface ComposeParams {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ── Status ────────────────────────────────────────────────────────────────────

export function useGmailStatus(): UseQueryResult<GmailStatus> {
  return useQuery({
    queryKey: ["gmail", "status"],
    queryFn: () => apiFetch<GmailStatus>("/status"),
    staleTime: 30_000,
    retry: false,
  });
}

// ── Labels ────────────────────────────────────────────────────────────────────

export function useGmailLabels(enabled = true): UseQueryResult<GmailLabel[]> {
  return useQuery({
    queryKey: ["gmail", "labels"],
    queryFn: async () => {
      const data = await apiFetch<{ labels: GmailLabel[] }>("/labels");
      return data.labels;
    },
    staleTime: 60_000,
    enabled,
  });
}

// ── Thread list ───────────────────────────────────────────────────────────────

export interface ThreadListParams {
  labelIds?: string[];
  q?: string;
  pageToken?: string;
  maxResults?: number;
}

export function useThreadList(
  params: ThreadListParams,
  enabled = true,
): UseQueryResult<{ threads: ThreadSummary[]; nextPageToken: string | null }> {
  const queryParams = new URLSearchParams();
  if (params.labelIds?.length) queryParams.set("labelIds", params.labelIds.join(","));
  if (params.q) queryParams.set("q", params.q);
  if (params.pageToken) queryParams.set("pageToken", params.pageToken);
  if (params.maxResults) queryParams.set("maxResults", String(params.maxResults));

  return useQuery({
    queryKey: ["gmail", "threads", params],
    queryFn: () =>
      apiFetch<{ threads: ThreadSummary[]; nextPageToken: string | null }>(
        `/threads?${queryParams.toString()}`,
      ),
    staleTime: 30_000,
    enabled,
  });
}

// ── Full thread ───────────────────────────────────────────────────────────────

export function useThread(
  threadId: string | null,
): UseQueryResult<FullThread> {
  return useQuery({
    queryKey: ["gmail", "thread", threadId],
    queryFn: () => apiFetch<FullThread>(`/threads/${threadId}`),
    enabled: !!threadId,
    staleTime: 60_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useGmailSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: ComposeParams) =>
      apiFetch<{ id: string; threadId: string }>("/messages/send", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "threads"] });
    },
  });
}

export function useGmailModify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      addLabelIds,
      removeLabelIds,
    }: {
      messageId: string;
      addLabelIds?: string[];
      removeLabelIds?: string[];
    }) =>
      apiFetch<{ ok: boolean }>(`/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({
          addLabelIds: addLabelIds ?? [],
          removeLabelIds: removeLabelIds ?? [],
        }),
      }),
    onSuccess: (_data, { messageId }) => {
      qc.invalidateQueries({ queryKey: ["gmail", "threads"] });
      qc.invalidateQueries({ queryKey: ["gmail", "thread"] });
    },
  });
}

export function useGmailTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<{ ok: boolean }>(`/messages/${messageId}/trash`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "threads"] });
    },
  });
}

export function useGmailUntrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<{ ok: boolean }>(`/messages/${messageId}/untrash`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "threads"] });
    },
  });
}

export function useGmailDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>("/disconnect", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail"] });
    },
  });
}

// ── Attachment URL helper ─────────────────────────────────────────────────────

export function attachmentUrl(
  messageId: string,
  attachmentId: string,
  filename: string,
): string {
  return `/api/gmail/messages/${messageId}/attachments/${attachmentId}?filename=${encodeURIComponent(filename)}`;
}
