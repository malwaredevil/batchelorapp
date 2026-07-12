import { useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return customFetch<T>(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
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

export interface ThreadListResponse {
  threads: ThreadSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number | null;
}

export function useThreadList(
  params: ThreadListParams,
  enabled = true,
): UseQueryResult<ThreadListResponse> {
  const queryParams = new URLSearchParams();
  if (params.labelIds?.length)
    queryParams.set("labelIds", params.labelIds.join(","));
  if (params.q) queryParams.set("q", params.q);
  if (params.pageToken) queryParams.set("pageToken", params.pageToken);
  if (params.maxResults)
    queryParams.set("maxResults", String(params.maxResults));

  return useQuery({
    queryKey: ["gmail", "threads", params],
    queryFn: () =>
      apiFetch<ThreadListResponse>(`/threads?${queryParams.toString()}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    enabled,
  });
}

// ── Full thread ───────────────────────────────────────────────────────────────

export function useThread(threadId: string | null): UseQueryResult<FullThread> {
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
    mutationFn: (threadId: string) =>
      apiFetch<{ ok: boolean }>(`/threads/${threadId}/trash`, {
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

export function useBulkModify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageIds,
      addLabelIds,
      removeLabelIds,
    }: {
      messageIds: string[];
      addLabelIds?: string[];
      removeLabelIds?: string[];
    }) => {
      await Promise.all(
        messageIds.map((id) =>
          apiFetch<{ ok: boolean }>(`/messages/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              addLabelIds: addLabelIds ?? [],
              removeLabelIds: removeLabelIds ?? [],
            }),
          }),
        ),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail", "threads"] });
      qc.invalidateQueries({ queryKey: ["gmail", "thread"] });
    },
  });
}

export function useBulkTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadIds: string[]) => {
      await Promise.all(
        threadIds.map((id) =>
          apiFetch<{ ok: boolean }>(`/threads/${id}/trash`, {
            method: "POST",
          }),
        ),
      );
    },
    onMutate: async (threadIds: string[]) => {
      await qc.cancelQueries({ queryKey: ["gmail", "threads"] });
      const idSet = new Set(threadIds);
      const snapshots = qc.getQueriesData<ThreadListResponse>({
        queryKey: ["gmail", "threads"],
      });
      qc.setQueriesData(
        { queryKey: ["gmail", "threads"] },
        (old: ThreadListResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            threads: old.threads.filter((t) => !idSet.has(t.id)),
          };
        },
      );
      return { snapshots };
    },
    onError: (_err, _ids, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
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

// ── Mark thread as read ────────────────────────────────────────────────────────
// Optimistically marks the thread as read in the list cache immediately, then
// fires parallel PATCH requests to remove UNREAD from each message on the server.

export function useMarkThreadRead() {
  const qc = useQueryClient();

  return useCallback(
    (threadId: string, unreadMessageIds: string[]) => {
      if (unreadMessageIds.length === 0) return;

      // Optimistic update 1 — thread list: mark thread row as read immediately
      qc.setQueriesData(
        { queryKey: ["gmail", "threads"] },
        (old: ThreadListResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            threads: old.threads.map((t) =>
              t.id === threadId ? { ...t, isUnread: false } : t,
            ),
          };
        },
      );

      // Optimistic update 2 — thread detail: clear isUnread on each message
      qc.setQueryData(
        ["gmail", "thread", threadId],
        (old: FullThread | undefined) => {
          if (!old) return old;
          const idSet = new Set(unreadMessageIds);
          return {
            ...old,
            messages: old.messages.map((m) =>
              idSet.has(m.id)
                ? {
                    ...m,
                    isUnread: false,
                    labelIds: m.labelIds.filter((l) => l !== "UNREAD"),
                  }
                : m,
            ),
          };
        },
      );

      // Fire server calls in parallel, then sync the list once
      Promise.all(
        unreadMessageIds.map((id) =>
          apiFetch<{ ok: boolean }>(`/messages/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              addLabelIds: [],
              removeLabelIds: ["UNREAD"],
            }),
          }),
        ),
      )
        .then(() => {
          qc.invalidateQueries({ queryKey: ["gmail", "threads"] });
        })
        .catch(() => {
          // Optimistic state stays; next refetch will reconcile
        });
    },
    [qc],
  );
}

// ── Attachment URL helper ─────────────────────────────────────────────────────

export function attachmentUrl(
  messageId: string,
  attachmentId: string,
  filename: string,
): string {
  return `/api/gmail/messages/${messageId}/attachments/${attachmentId}?filename=${encodeURIComponent(filename)}`;
}
