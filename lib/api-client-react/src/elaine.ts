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

/** A single image/PDF attachment on a user message. `name` is the original
 *  upload filename (PDFs only — images are shown as thumbnails and don't
 *  need a name). Older stored messages may still be plain strings; callers
 *  should treat this as `AttachmentRef | string`. */
export interface AttachmentRef {
  url: string;
  type: "image" | "pdf";
  name?: string;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  /** Signed Supabase Storage URLs (+ type/filename) for images/PDFs the user
   *  attached to this turn. Only present on user messages; undefined/empty
   *  for assistant messages. */
  attachmentUrls?: Array<AttachmentRef | string>;
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

// Desktop dimensions for the floating chat widget popup. Mobile always fills
// the available width regardless of this setting — see ElaineWidget.
export type ChatWindowSize = "compact" | "comfortable" | "large";

export interface ExecutedAssistantAction extends AssistantAction {
  status: number;
  result: unknown;
}

// Rich widget payloads surfaced by tool calls (weather, places, etc.)
export interface WeatherDay {
  date: string;
  conditionDescription: string;
  maxTempC: number | null;
  minTempC: number | null;
  precipitationChancePercent: number | null;
}

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  userRatingCount: number | null;
  lat: number | null;
  lng: number | null;
  googleMapsUri: string | null;
  websiteUri: string | null;
}

export interface DataCardRow {
  label: string;
  value: string;
}

export interface ChatWidgetImage {
  url: string;
  sourceUrl?: string;
}

export type ChatWidget =
  | { type: "weather"; locationName: string; days: WeatherDay[] }
  | {
      type: "places";
      query: string;
      places: PlaceResult[];
    }
  | {
      type: "air_quality";
      data: {
        aqi: number;
        category: string;
        dominantPollutant: string;
        locationName: string;
      };
    }
  | {
      type: "pollen";
      data: {
        date: string;
        overallCategory: string;
        locationName: string;
        types: Array<{ displayName: string; category: string }>;
      };
    }
  | {
      type: "data_card";
      title?: string;
      rows: DataCardRow[];
    }
  | {
      type: "image_card";
      title?: string;
      images: ChatWidgetImage[];
    };

export interface AssistantChatResponse {
  role: "assistant";
  content: string;
  navigate: { path: string; reason: string } | null;
  actions: AssistantAction[];
  executedActions: ExecutedAssistantAction[];
  actionConfirmationMode: ActionConfirmationMode;
  messages: AssistantMessage[];
  widgets?: ChatWidget[];
  /** ID of the named conversation this turn was saved to. */
  conversationId?: number;
}

export interface AssistantSettings {
  enabled: boolean;
  actionConfirmationMode: ActionConfirmationMode;
  chatWindowSize: ChatWindowSize;
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
  onWidget?: (widget: ChatWidget) => void;
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
  body: {
    message: string;
    pageContext?: string;
    appId: ElaineAppId;
    /** ID of the named conversation to continue. Omit to start a new one. */
    conversationId?: number;
    /** Signed Supabase Storage URLs for image attachments (JPEG/PNG/WebP). */
    attachmentUrls?: string[];
    /** PDF attachments: signed URL + original filename + extracted text. */
    attachmentPdfs?: Array<{ url: string; name: string; extractedText?: string }>;
  },
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
        case "widget":
          callbacks.onWidget?.(data as ChatWidget);
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
// Conversation history — named, persistent conversations accessible from
// the Elaine app's left sidebar. Separate from the rolling single-thread
// `elaineConversations` table used by the floating widget.
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Snippet from the first user message in the conversation (≤80 chars). */
  preview: string | null;
}

export interface ConversationMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  attachmentUrls: Array<AttachmentRef | string>;
  createdAt: string;
}

export const getListElaineConversationsQueryKey = (q?: string) =>
  q ? [`/api/elaine/conversations`, { q }] as const
    : [`/api/elaine/conversations`] as const;

const listElaineConversationsFn = (
  q?: string,
  options?: RequestInit,
): Promise<ConversationSummary[]> => {
  const url = q
    ? `/api/elaine/conversations?q=${encodeURIComponent(q)}`
    : "/api/elaine/conversations";
  return customFetch<ConversationSummary[]>(url, {
    ...options,
    method: "GET",
  });
};

export function useListElaineConversations<
  TData = ConversationSummary[],
  TError = unknown,
>(options?: {
  q?: string;
  query?: UseQueryOptions<ConversationSummary[], TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { q, query: queryOptions } = options ?? {};
  const queryKey =
    queryOptions?.queryKey ?? getListElaineConversationsQueryKey(q);
  const queryFn: QueryFunction<ConversationSummary[]> = ({ signal }) =>
    listElaineConversationsFn(q, { signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    ConversationSummary[],
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

const createElaineConversationFn = (): Promise<ConversationSummary> =>
  customFetch<ConversationSummary>("/api/elaine/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

export function useCreateElaineConversation(options?: {
  mutation?: UseMutationOptions<ConversationSummary, unknown, void>;
}) {
  const mutationFn = () => createElaineConversationFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

const renameElaineConversationFn = (
  id: number,
  title: string,
): Promise<ConversationSummary> =>
  customFetch<ConversationSummary>(`/api/elaine/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

export function useRenameElaineConversation(options?: {
  mutation?: UseMutationOptions<
    ConversationSummary,
    unknown,
    { id: number; title: string }
  >;
}): UseMutationResult<
  ConversationSummary,
  unknown,
  { id: number; title: string }
> {
  const mutationFn: MutationFunction<
    ConversationSummary,
    { id: number; title: string }
  > = ({ id, title }) => renameElaineConversationFn(id, title);
  return useMutation({ mutationFn, ...options?.mutation });
}

const deleteElaineConversationFn = (id: number): Promise<void> =>
  customFetch<void>(`/api/elaine/conversations/${id}`, { method: "DELETE" });

export function useDeleteElaineConversation(options?: {
  mutation?: UseMutationOptions<void, unknown, number>;
}): UseMutationResult<void, unknown, number> {
  const mutationFn: MutationFunction<void, number> = (id) =>
    deleteElaineConversationFn(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

export const getGetElaineConversationMessagesQueryKey = (id: number) =>
  [`/api/elaine/conversations`, id, `messages`] as const;

const getElaineConversationMessagesFn = (
  id: number,
  options?: RequestInit,
): Promise<ConversationMessage[]> =>
  customFetch<ConversationMessage[]>(
    `/api/elaine/conversations/${id}/messages`,
    { ...options, method: "GET" },
  );

export function useGetElaineConversationMessages<
  TData = ConversationMessage[],
  TError = unknown,
>(
  id: number | null,
  options?: {
    query?: UseQueryOptions<ConversationMessage[], TError, TData>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey =
    queryOptions?.queryKey ??
    (id !== null
      ? getGetElaineConversationMessagesQueryKey(id)
      : (["disabled"] as const));
  const queryFn: QueryFunction<ConversationMessage[]> = ({ signal }) =>
    getElaineConversationMessagesFn(id!, { signal });
  const queryOpts = {
    queryKey,
    queryFn,
    enabled: id !== null,
    ...queryOptions,
  } as UseQueryOptions<ConversationMessage[], TError, TData> & {
    queryKey: QueryKey;
  };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

// ---------------------------------------------------------------------------
// Attachment upload — images and PDFs attached to Elaine chat messages.
// Stored in the private `elaine-attachments` Supabase Storage bucket;
// the server returns a long-lived signed URL for display and AI vision.
// ---------------------------------------------------------------------------

export interface ElaineAttachmentUploadResult {
  /** Long-lived signed URL for display and AI context. */
  url: string;
  /** 'image' for JPEG/PNG/WebP; 'pdf' for PDF documents. */
  type: "image" | "pdf";
  /** Original filename (provided for PDFs so the UI can show it). */
  name?: string;
  /** Extracted plain-text content for PDF files (max 8 000 chars). */
  extractedText?: string;
}

export async function uploadElaineAttachment(
  file: File,
): Promise<ElaineAttachmentUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/elaine/attachments", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Upload failed with status ${res.status}`);
  }
  return res.json() as Promise<ElaineAttachmentUploadResult>;
}

// ---------------------------------------------------------------------------
// Admin (app-owner-only) global config — applies to every user/app, unlike
// AssistantSettings above which is per-user. Every endpoint here 403s for
// non-owner accounts; callers should treat a 403 as "hide the admin UI"
// rather than a hard error.
// ---------------------------------------------------------------------------

export interface ElaineExtraModelsConfig {
  fastVision: string;
  smartVision: string;
  advisor: string;
  research: string;
  expertPanelAlt: string;
  embedding: string;
  rerank: string;
  visualEmbed: string;
  fusionModels: string[];
  fusionJudge: string;
}

export interface ElaineTimeoutsConfig {
  expertConsultMs: number;
  rerankerMs: number;
  geocodingMs: number;
  fusionMs: number;
}

export interface ElaineFeaturesConfig {
  enableAdvisor: boolean;
  enableSubagent: boolean;
  enableFusionPotteryExpert: boolean;
  enableFusionTravelDocFallback: boolean;
}

export interface ElaineThresholdsConfig {
  potterySimilarityYes: number;
  potterySimilarityMaybe: number;
  potterySimilarityNo: number;
  visualEmbedCropTop: number;
  visualEmbedCropHeight: number;
  aiJpegQuality: number;
  potteryZoneAnalysisMaxTokens: number;
  potteryBackstampMaxTokens: number;
  travelDocExtractionMaxTokens: number;
}

export interface ElaineGlobalConfig {
  chatModel: string;
  subagentModel: string;
  requestTimeoutMs: number;
  maxResponseTokens: number;
  models: ElaineExtraModelsConfig;
  timeouts: ElaineTimeoutsConfig;
  features: ElaineFeaturesConfig;
  thresholds: ElaineThresholdsConfig;
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
> & {
  models?: Partial<ElaineExtraModelsConfig>;
  timeouts?: Partial<ElaineTimeoutsConfig>;
  features?: Partial<ElaineFeaturesConfig>;
  thresholds?: Partial<ElaineThresholdsConfig>;
};

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

// ---------------------------------------------------------------------------
// Daily brief — personalised once-per-UTC-day morning summary.
// ---------------------------------------------------------------------------

export interface DailyBrief {
  id: number;
  content: string;
  generatedAt: string;
  dismissed: boolean;
}

export const getElaineDailyBriefQueryKey = () =>
  [`/api/elaine/daily-brief`] as const;

const getElaineDailyBriefFn = (
  options?: RequestInit,
): Promise<DailyBrief> =>
  customFetch<DailyBrief>("/api/elaine/daily-brief", {
    ...options,
    method: "GET",
  });

export function useGetElaineDailyBrief<
  TData = DailyBrief,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<DailyBrief, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getElaineDailyBriefQueryKey();
  const queryFn: QueryFunction<DailyBrief> = ({ signal }) =>
    getElaineDailyBriefFn({ signal });
  const queryOpts = {
    queryKey,
    queryFn,
    staleTime: 5 * 60 * 1000,
    retry: false,
    ...queryOptions,
  } as UseQueryOptions<DailyBrief, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

const dismissElaineDailyBriefFn = (): Promise<void> =>
  customFetch<void>("/api/elaine/daily-brief/dismiss", { method: "POST" });

export function useDismissElaineDailyBrief(options?: {
  mutation?: UseMutationOptions<void, unknown, void>;
}): UseMutationResult<void, unknown, void> {
  const mutationFn: MutationFunction<void, void> = () =>
    dismissElaineDailyBriefFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

const regenerateElaineDailyBriefFn = (): Promise<DailyBrief> =>
  customFetch<DailyBrief>("/api/elaine/daily-brief/regenerate", {
    method: "POST",
  });

export function useRegenerateElaineDailyBrief(options?: {
  mutation?: UseMutationOptions<DailyBrief, unknown, void>;
}): UseMutationResult<DailyBrief, unknown, void> {
  const mutationFn: MutationFunction<DailyBrief, void> = () =>
    regenerateElaineDailyBriefFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

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
