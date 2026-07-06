import {
  useMutation,
  useQuery,
  type MutationFunction,
  type QueryFunction,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ---------------------------------------------------------------------------
// Elaine — shared AI assistant, used identically across travels, pottery,
// quilting, the hub, and her own standalone Elaine app. One continuous
// conversation/memory spans all apps; `appId` tells the server which app's
// on-screen context/tools/nav-paths are relevant for the current turn, it
// does not scope the conversation itself.
// ---------------------------------------------------------------------------

export type ElaineAppId =
  | "travels"
  | "pottery"
  | "quilting"
  | "hub"
  | "elaine";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export type TravelActionType =
  | "create_trip"
  | "add_wishlist"
  | "add_packing_item"
  | "update_trip_status"
  | "update_trip_details"
  | "cancel_trip"
  | "mark_wishlist_done"
  | "remove_wishlist_item"
  | "remove_packing_item"
  | "add_reminder"
  | "sync_reminder_to_calendar"
  | "edit_reminder"
  | "delete_reminder"
  | "add_itinerary_day"
  | "regenerate_itinerary_day"
  | "add_connected_calendar"
  | "disconnect_calendar"
  | "rescan_document"
  | "generate_itinerary"
  | "confirm_itinerary_activity"
  | "remove_itinerary_activity"
  | "send_email";

export type PotteryActionType =
  | "update_pottery_item"
  | "delete_pottery_item"
  | "create_pottery_category"
  | "delete_pottery_category";

export type QuiltingActionType =
  | "update_fabric"
  | "delete_fabric"
  | "update_pattern"
  | "delete_pattern"
  | "create_shopping_item"
  | "update_shopping_item"
  | "delete_shopping_item"
  | "create_quilting_category"
  | "delete_quilting_category";

export type AssistantActionType =
  | TravelActionType
  | PotteryActionType
  | QuiltingActionType;

export interface AssistantAction {
  type: AssistantActionType;
  label: string;
  payload: Record<string, unknown>;
}

export interface AssistantActionResult {
  type: AssistantActionType;
  result: unknown;
}

export type ActionConfirmationMode = "one_by_one" | "all_at_once" | "auto_run";

export interface ExecutedAssistantAction extends AssistantAction {
  status: number;
  result: unknown;
}

export interface AssistantChatResponse {
  role: "assistant";
  content: string;
  navigate: { path: string; reason: string } | null;
  actions: AssistantAction[];
  executedActions: ExecutedAssistantAction[];
  actionConfirmationMode: ActionConfirmationMode;
  messages: AssistantMessage[];
}

export interface AssistantSettings {
  enabled: boolean;
  actionConfirmationMode: ActionConfirmationMode;
}

export interface HouseholdMemoryItem {
  id: number;
  content: string;
  createdAt: string;
  createdByUserId: number;
}

export const getGetElaineConversationQueryKey = () =>
  [`/api/elaine/conversation`] as const;

const getElaineConversationFn = (
  options?: RequestInit,
): Promise<{ messages: AssistantMessage[] }> =>
  customFetch<{ messages: AssistantMessage[] }>("/api/elaine/conversation", {
    ...options,
    method: "GET",
  });

export function useGetElaineConversation<
  TData = { messages: AssistantMessage[] },
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<{ messages: AssistantMessage[] }, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetElaineConversationQueryKey();
  const queryFn: QueryFunction<{ messages: AssistantMessage[] }> = ({
    signal,
  }) => getElaineConversationFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    { messages: AssistantMessage[] },
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

// The chat endpoint is streamed as Server-Sent Events (so Elaine's reply, and
// any proposed action directive, can build up incrementally in the UI)
// rather than returning a single JSON body, so it isn't a plain react-query
// mutation like the other endpoints in this file. Callers get incremental
// updates via `callbacks` and the final result via the resolved promise
// (which also resolves `onDone`).
export interface AssistantChatStreamCallbacks {
  onDelta?: (text: string) => void;
  onAction?: (action: AssistantAction) => void;
  onStatus?: (message: string) => void;
  onDone?: (result: AssistantChatResponse) => void;
}

function parseSseDataLines(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

export async function streamElaineMessage(
  body: { message: string; pageContext?: string; appId: ElaineAppId },
  callbacks: AssistantChatStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  const response = await fetch("/api/elaine/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: AssistantChatResponse | null = null;

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (!rawEvent.trim()) continue;

      const eventType =
        rawEvent.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
      const dataText = parseSseDataLines(rawEvent);
      if (dataText === null) continue;

      let data: unknown;
      try {
        data = JSON.parse(dataText);
      } catch {
        continue;
      }

      switch (eventType) {
        case "delta":
          callbacks.onDelta?.((data as { text: string }).text);
          break;
        case "action":
          callbacks.onAction?.(data as AssistantAction);
          break;
        case "status":
          callbacks.onStatus?.((data as { message: string }).message);
          break;
        case "done":
          done = data as AssistantChatResponse;
          callbacks.onDone?.(done);
          break;
        case "error":
          throw new Error(
            (data as { message?: string }).message ??
              "Elaine couldn't respond just now.",
          );
      }
    }
  }

  if (!done) {
    throw new Error("Elaine's response ended unexpectedly.");
  }
  return done;
}

const newElaineConversationFn = (): Promise<{
  messages: AssistantMessage[];
}> =>
  customFetch<{ messages: AssistantMessage[] }>("/api/elaine/conversation", {
    method: "DELETE",
  });

export function useNewElaineConversation(options?: {
  mutation?: UseMutationOptions<
    { messages: AssistantMessage[] },
    unknown,
    void
  >;
}) {
  const mutationFn = () => newElaineConversationFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

const executeElaineActionFn = (
  body: Pick<AssistantAction, "type" | "payload">,
): Promise<AssistantActionResult> =>
  customFetch<AssistantActionResult>("/api/elaine/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useExecuteElaineAction(options?: {
  mutation?: UseMutationOptions<
    AssistantActionResult,
    unknown,
    Pick<AssistantAction, "type" | "payload">
  >;
}) {
  const mutationFn = (body: Pick<AssistantAction, "type" | "payload">) =>
    executeElaineActionFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export const getGetElaineSettingsQueryKey = () =>
  [`/api/elaine/settings`] as const;

const getElaineSettingsFn = (
  options?: RequestInit,
): Promise<AssistantSettings> =>
  customFetch<AssistantSettings>("/api/elaine/settings", {
    ...options,
    method: "GET",
  });

export function useGetElaineSettings<
  TData = AssistantSettings,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<AssistantSettings, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetElaineSettingsQueryKey();
  const queryFn: QueryFunction<AssistantSettings> = ({ signal }) =>
    getElaineSettingsFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    AssistantSettings,
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

export type UpdateElaineSettingsBody = Partial<AssistantSettings>;

const putElaineSettingsFn = (
  body: UpdateElaineSettingsBody,
): Promise<AssistantSettings> =>
  customFetch<AssistantSettings>("/api/elaine/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateElaineSettings(options?: {
  mutation?: UseMutationOptions<
    AssistantSettings,
    unknown,
    UpdateElaineSettingsBody
  >;
}) {
  const mutationFn = (body: UpdateElaineSettingsBody) =>
    putElaineSettingsFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export interface AssistantNudgesUnseenCount {
  count: number;
}

export const getGetElaineNudgesUnseenCountQueryKey = () =>
  [`/api/elaine/nudges/unseen-count`] as const;

const getElaineNudgesUnseenCountFn = (
  options?: RequestInit,
): Promise<AssistantNudgesUnseenCount> =>
  customFetch<AssistantNudgesUnseenCount>(
    "/api/elaine/nudges/unseen-count",
    { ...options, method: "GET" },
  );

export function useGetElaineNudgesUnseenCount<
  TData = AssistantNudgesUnseenCount,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<AssistantNudgesUnseenCount, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey =
    queryOptions?.queryKey ?? getGetElaineNudgesUnseenCountQueryKey();
  const queryFn: QueryFunction<AssistantNudgesUnseenCount> = ({ signal }) =>
    getElaineNudgesUnseenCountFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    AssistantNudgesUnseenCount,
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

export const getListElaineMemoryQueryKey = () =>
  [`/api/elaine/memory`] as const;

const listElaineMemoryFn = (
  options?: RequestInit,
): Promise<HouseholdMemoryItem[]> =>
  customFetch<HouseholdMemoryItem[]>("/api/elaine/memory", {
    ...options,
    method: "GET",
  });

export function useListElaineMemory<
  TData = HouseholdMemoryItem[],
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<HouseholdMemoryItem[], TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListElaineMemoryQueryKey();
  const queryFn: QueryFunction<HouseholdMemoryItem[]> = ({ signal }) =>
    listElaineMemoryFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    HouseholdMemoryItem[],
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

const deleteElaineMemoryItemFn = (id: number): Promise<void> =>
  customFetch<void>(`/api/elaine/memory/${id}`, { method: "DELETE" });

export function useDeleteElaineMemoryItem(options?: {
  mutation?: UseMutationOptions<void, unknown, number>;
}): UseMutationResult<void, unknown, number> {
  const mutationFn: MutationFunction<void, number> = (id) =>
    deleteElaineMemoryItemFn(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Admin (app-owner-only) global config — applies to every user/app, unlike
// AssistantSettings above which is per-user. Every endpoint here 403s for
// non-owner accounts; callers should treat a 403 as "hide the admin UI"
// rather than a hard error.
// ---------------------------------------------------------------------------

export interface ElaineGlobalConfig {
  chatModel: string;
  subagentModel: string;
  requestTimeoutMs: number;
  maxResponseTokens: number;
  updatedAt: string | null;
}

export const getGetElaineAdminConfigQueryKey = () =>
  [`/api/elaine/admin/config`] as const;

const getElaineAdminConfigFn = (
  options?: RequestInit,
): Promise<ElaineGlobalConfig> =>
  customFetch<ElaineGlobalConfig>("/api/elaine/admin/config", {
    ...options,
    method: "GET",
  });

export function useGetElaineAdminConfig<
  TData = ElaineGlobalConfig,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<ElaineGlobalConfig, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetElaineAdminConfigQueryKey();
  const queryFn: QueryFunction<ElaineGlobalConfig> = ({ signal }) =>
    getElaineAdminConfigFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    ElaineGlobalConfig,
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

export type UpdateElaineAdminConfigBody = Partial<
  Pick<
    ElaineGlobalConfig,
    "chatModel" | "subagentModel" | "requestTimeoutMs" | "maxResponseTokens"
  >
>;

const putElaineAdminConfigFn = (
  body: UpdateElaineAdminConfigBody,
): Promise<ElaineGlobalConfig> =>
  customFetch<ElaineGlobalConfig>("/api/elaine/admin/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateElaineAdminConfig(options?: {
  mutation?: UseMutationOptions<
    ElaineGlobalConfig,
    unknown,
    UpdateElaineAdminConfigBody
  >;
}) {
  const mutationFn = (body: UpdateElaineAdminConfigBody) =>
    putElaineAdminConfigFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export interface OpenRouterModelSummary {
  id: string;
  name: string;
  contextLength: number | null;
  promptPricePerMTok: number | null;
  completionPricePerMTok: number | null;
}

export const getListElaineAdminModelsQueryKey = () =>
  [`/api/elaine/admin/models`] as const;

const listElaineAdminModelsFn = (
  options?: RequestInit,
): Promise<OpenRouterModelSummary[]> =>
  customFetch<OpenRouterModelSummary[]>("/api/elaine/admin/models", {
    ...options,
    method: "GET",
  });

export function useListElaineAdminModels<
  TData = OpenRouterModelSummary[],
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<OpenRouterModelSummary[], TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey =
    queryOptions?.queryKey ?? getListElaineAdminModelsQueryKey();
  const queryFn: QueryFunction<OpenRouterModelSummary[]> = ({ signal }) =>
    listElaineAdminModelsFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    OpenRouterModelSummary[],
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}
