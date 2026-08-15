import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  type InfiniteData,
  type MutationFunction,
  type QueryFunction,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { customFetch, ApiError } from "./custom-fetch";

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
  | "ornaments"
  | "hub"
  | "elaine";

/** A single image/document attachment on a user message. `name` is the
 *  original upload filename (documents only — images are shown as
 *  thumbnails and don't need a name). Older stored messages may still be
 *  plain strings; callers should treat this as `AttachmentRef | string`. */
export interface AttachmentRef {
  url: string;
  type: "image" | "pdf" | "csv" | "docx" | "xlsx";
  name?: string;
}

export type ElainePlanStepStatus =
  | "planned"
  | "active"
  | "waiting_confirmation"
  | "waiting_input"
  | "adjusted"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface ElaineRuntimePlanStep {
  id: string;
  label: string;
  kind: "lookup" | "research" | "action" | "clarify" | "respond";
  toolName?: string | null;
  dependsOn: string[];
  expectedEvidence: string;
  required: boolean;
  riskClass: "read_only" | "consequential";
  confirmation: "none" | "configured_policy";
  retryLimit: number;
  status: ElainePlanStepStatus;
  summary?: string;
  attempts: number;
}

export interface ElaineRuntimeTrace {
  version: 1;
  traceId: string;
  requestClass: {
    kind: "answer" | "read" | "research" | "action" | "mixed";
    complexity: "simple" | "multi_step";
    requiresFreshData: boolean;
    hasAttachment: boolean;
  };
  goal: string;
  plan: {
    version: 1;
    goal: string;
    assumptions: string[];
    completionCriteria: string[];
    steps: ElaineRuntimePlanStep[];
  };
  sourceRoute?: {
    freshness: "stable" | "recent" | "current";
    requiresRetrievedEvidence: boolean;
    preferredKinds: Array<
      | "current_context"
      | "batchelor_app"
      | "first_party_provider"
      | "specialized_api"
      | "web"
      | "model_synthesis"
    >;
    fallbackKinds: string[];
    rationale: string;
  };
  observations?: Array<{
    callId: string;
    stepId: string | null;
    toolName: string;
    success: boolean;
    evidenceSummary: string;
    resultReference?: string;
    provenance?: {
      sourceKind: string;
      sourceName: string;
      observedAt: string;
      evidenceKind: "retrieved_fact" | "inference";
      confidence: "high" | "medium" | "low";
      sourceUrl?: string;
      internalReference?: string;
      coverage: {
        status: "matched" | "partial" | "outside" | "unknown";
        start?: string;
        end?: string;
        geography?: string;
      };
    };
    startedAt: string;
    completedAt: string;
  }>;
  events: Array<{
    id: string;
    sequence: number;
    type: string;
    at: string;
    stepId?: string;
    status?: string;
    summary: string;
    toolName?: string;
    errorCategory?: string;
  }>;
  verification: {
    status:
      | "satisfied"
      | "needs_replan"
      | "awaiting_confirmation"
      | "awaiting_input"
      | "blocked";
    satisfiedCriteria: string[];
    unsatisfiedCriteria: string[];
    summary: string;
    replanReason?: string;
  } | null;
  status:
    | "running"
    | "completed"
    | "awaiting_confirmation"
    | "awaiting_input"
    | "blocked"
    | "failed"
    | "cancelled";
  traceAvailable: boolean;
  startedAt: string;
  completedAt: string | null;
  usage: {
    modelRounds: number;
    toolCalls: number;
    replans: number;
    elapsedMs: number;
  };
}

export interface ElaineRuntimeEventEnvelope {
  event?: ElaineRuntimeTrace["events"][number];
  trace: ElaineRuntimeTrace;
}

export interface AssistantMessage {
  /** Present on messages loaded from history; absent on the optimistic
   *  user-message entry inserted client-side while a turn is streaming. */
  id?: number;
  role: "user" | "assistant";
  content: string;
  /** Signed Supabase Storage URLs (+ type/filename) for images/PDFs the user
   *  attached to this turn. Only present on user messages; undefined/empty
   *  for assistant messages. */
  attachmentUrls?: Array<AttachmentRef | string>;
  /** Sanitized plan/progress trace for the assistant turn. */
  runtimeTrace?: ElaineRuntimeTrace;
  /** Model-produced reasoning summary for this assistant turn. Absent when
   *  the model emitted no reasoning or the feature is disabled. */
  reasoningSummary?: string | null;
  /** Wall-clock time (ms) the turn spent "thinking" before the final reply
   *  was ready. For new messages in the current session this is set from the
   *  live client-side timer; for history-loaded messages it comes from the
   *  server-persisted value so "Thought for Xs" survives page reloads. */
  reasoningDurationMs?: number;
  /** ISO timestamp from the server. Present on history-loaded messages;
   *  absent on optimistically-inserted messages (streaming in progress). */
  createdAt?: string;
  /** True when this assistant turn was interrupted by the user clicking
   *  Stop before the model finished. Set both on the locally-finalized
   *  message at the moment of stopping and on the persisted row once the
   *  conversation is reloaded. Only meaningful for `role: "assistant"`. */
  stopped?: boolean;
  /** Client-only: true while this user message is waiting in the send queue
   *  for a prior turn to finish, before it has actually been sent to the
   *  server. Never persisted — cleared the instant the message is sent. */
  queued?: boolean;
  /** Client-only: true when the request for this user message failed
   *  without ever reaching a server response — most commonly because the
   *  connection died (e.g. the app was closed/backgrounded on mobile mid-
   *  request). The message is kept visible (never persisted) so the user
   *  can see it wasn't silently lost and retry it, instead of it vanishing
   *  and looking like it was never sent. Never true at the same time as
   *  `stopped`, which covers the distinct case of a user-initiated Stop. */
  failed?: boolean;
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
  | QuiltingActionType
  | "correct_memory"
  | "forget_memory"
  | "queue_research_task"
  | "cancel_elaine_task"
  | "execute_app_operation"
  | "message_contact"
  | "call_contact"
  | "cancel_scheduled_contact"
  | "continue_in_channel"
  | "call_me"
  | "broadcast_message";

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

export interface ExchangeRateResult {
  code: string;
  name?: string;
  rate: number;
}

export interface TripCardData {
  tripId?: number;
  name: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  countdownDays?: number;
}

// Collection-domain widget data types — mirrors lib/elaine-ui/src/ChatWidgets.tsx.
// Keep both in sync: elaine-ui is the canonical display layer; api-client-react
// is the transport layer used by AssistantChatResponse.widgets.
export interface PotteryItemData {
  itemId?: number;
  name: string;
  imageUrl?: string;
  maker?: string;
  style?: string;
  aiDescription?: string;
  dominantColors?: string[];
}

export interface FabricSwatchData {
  fabricId?: number;
  name: string;
  manufacturer?: string;
  designer?: string;
  dominantColors?: string[];
  imageUrl?: string;
  aiDescription?: string;
}

export interface OrnamentItemData {
  itemId?: number;
  name: string;
  imageUrl?: string;
  seriesOrCollection?: string;
  year?: number;
  brand?: string;
  aiDescription?: string;
  dominantColors?: string[];
}

export interface DestinationCardData {
  name: string;
  country?: string;
  highlights?: string[];
  mapsUrl: string;
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
    }
  | { type: "exchange_rate"; from: string; to: ExchangeRateResult[]; lastUpdated: string }
  | { type: "trip_card"; trip: TripCardData }
  | { type: "pottery_item"; item: PotteryItemData }
  | { type: "fabric_swatch"; swatch: FabricSwatchData }
  | { type: "ornament_item"; item: OrnamentItemData }
  | { type: "destination_card"; card: DestinationCardData };

export interface AssistantChatResponse {
  role: "assistant";
  content: string;
  navigate: { path: string; reason: string } | null;
  actions: AssistantAction[];
  executedActions: ExecutedAssistantAction[];
  actionConfirmationMode: ActionConfirmationMode;
  messages: AssistantMessage[];
  widgets?: ChatWidget[];
  /** Real, persisted elaineHistoryMessages ids for this turn's user/assistant
   *  rows. Null only if the session's history conversation couldn't be
   *  resolved. Use these (not array position) to reconcile the optimistic
   *  message and to keep "load older" pagination cursors correct. */
  userMessageId?: number | null;
  assistantMessageId?: number | null;
  /** ID of the named conversation this turn was saved to. */
  conversationId?: number;
  runtimeTrace?: ElaineRuntimeTrace;
  /** Reasoning summary for the current turn, if the model produced one. */
  reasoningSummary?: string | null;
}

export interface AssistantSettings {
  enabled: boolean;
  actionConfirmationMode: ActionConfirmationMode;
  chatWindowSize: ChatWindowSize;
}

export type MemoryScope = "household" | "personal" | "temporary";
export type MemoryCategory =
  | "fact"
  | "preference"
  | "instruction"
  | "person"
  | "place"
  | "collection";
export type MemorySensitivity = "low" | "medium" | "high";

export interface HouseholdMemoryItem {
  id: number;
  content: string;
  type: string;
  scope: MemoryScope;
  category: MemoryCategory;
  sensitivity: MemorySensitivity;
  ownerUserId: number | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdByUserId: number | null;
  source: string;
  lastConfirmedAt: string | null;
  confidence: number;
  correctionOfId: number | null;
}

export interface CreateMemoryBody {
  content: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  sensitivity?: MemorySensitivity;
  expiresInDays?: number;
}

export interface UpdateMemoryBody {
  content?: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  sensitivity?: MemorySensitivity;
  expiresInDays?: number;
}

export type ElaineTaskState =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface ElaineResearchObservation {
  query: string;
  success: boolean;
  evidenceSummary: string;
  citations: string[];
  observedAt: string;
}

export interface ElaineTask {
  id: number;
  goal: string;
  state: ElaineTaskState;
  progressPercent: number;
  progressMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  answer: string | null;
  citations: string[];
  observations: ElaineResearchObservation[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ConversationLoadResult {
  messages: AssistantMessage[];
  /** ID of the resolved widget-default conversation (null only when the
   *  session's user row could not be resolved). Pin subsequent sends and
   *  "load older" requests to this ID. */
  conversationId: number | null;
  /** True when older messages exist beyond this page — call
   *  useGetElaineConversationMessages(conversationId, { before: oldestId })
   *  to fetch them. */
  hasMore: boolean;
}

export const getGetElaineConversationQueryKey = () =>
  [`/api/elaine/conversation`] as const;

const getElaineConversationFn = (
  options?: RequestInit,
): Promise<ConversationLoadResult> =>
  customFetch<ConversationLoadResult>("/api/elaine/conversation", {
    ...options,
    method: "GET",
  });

export function useGetElaineConversation<
  TData = ConversationLoadResult,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<ConversationLoadResult, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetElaineConversationQueryKey();
  const queryFn: QueryFunction<ConversationLoadResult> = ({ signal }) =>
    getElaineConversationFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    ConversationLoadResult,
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
  /** Called as soon as the server registers the turn — surfaces the stable
   *  turn id used for the widget→full-app maximize handoff/resume flow. */
  onTurnId?: (info: { turnId: string; conversationId: number | null }) => void;
  onDelta?: (text: string) => void;
  /** Clears provisional text when Elaine continues with tools or a replan. */
  onResponseReset?: () => void;
  onAction?: (action: AssistantAction) => void;
  onStatus?: (message: string) => void;
  onWidget?: (widget: ChatWidget) => void;
  onRuntime?: (event: ElaineRuntimeEventEnvelope) => void;
  onDone?: (result: AssistantChatResponse) => void;
  /** Called with each incremental reasoning-summary token while the model is
   *  still thinking. The full summary arrives in `onDone` as well. */
  onReasoningSummaryDelta?: (delta: string) => void;
}

function parseSseDataLines(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

/**
 * Structured alternative to a freeform pageContext string.
 * - `module` is validated against known app IDs.
 * - `description` must be a developer-controlled template string (no raw user
 *   content). Max 500 chars — truncated server-side if exceeded.
 * - `items` carries per-field user-supplied values that will be sanitized
 *   separately before injection. Each value is capped at 300 chars server-side.
 */
export interface PageContext {
  module:
    | "pottery"
    | "quilting"
    | "travels"
    | "ornaments"
    | "hub"
    | "elaine"
    | "office";
  /** Developer-controlled description of what's on screen. No raw user input. */
  description: string;
  /** Per-field user-supplied values shown to Elaine as labelled pairs. */
  items?: Array<{ label: string; value: string }>;
}

export async function streamElaineMessage(
  body: {
    message: string;
    /** Pass a `PageContext` object (preferred) or a legacy freeform string. */
    pageContext?: PageContext | string;
    appId: ElaineAppId;
    /** ID of the named conversation to continue. Omit to start a new one. */
    conversationId?: number;
    /** Signed Supabase Storage URLs for image attachments (JPEG/PNG/WebP). */
    attachmentUrls?: string[];
    /** PDF attachments: signed URL + original filename + extracted text. */
    attachmentPdfs?: Array<{ url: string; name: string; extractedText?: string }>;
    /** CSV/DOCX/XLSX attachments: signed URL + original filename + doc type + extracted text. */
    attachmentDocs?: Array<{
      url: string;
      name: string;
      docType: "csv" | "docx" | "xlsx";
      extractedText?: string;
    }>;
    /** Auto-captured page screenshot URL — sent to model for visual context but not persisted. */
    pageScreenshotUrl?: string;
    /** User's current latitude (from navigator.geolocation) — enables location-aware queries. */
    userLat?: number;
    /** User's current longitude (from navigator.geolocation) — enables location-aware queries. */
    userLng?: number;
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
    body: JSON.stringify({
      ...body,
      pageContext:
        typeof body.pageContext === "object" && body.pageContext !== null
          ? [
              `[${body.pageContext.module}] ${body.pageContext.description}`,
              ...(body.pageContext.items?.map(
                ({ label, value }) => `${label}: ${value}`,
              ) ?? []),
            ].join("\n")
          : body.pageContext,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return readElaineSseStream(response.body, callbacks);
}

/** Shared SSE reader for both the primary /chat stream and the resume/attach
 *  stream — parses events off the body and dispatches to `callbacks`,
 *  resolving with the terminal `done` payload. */
async function readElaineSseStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AssistantChatStreamCallbacks,
): Promise<AssistantChatResponse> {
  const reader = body.getReader();
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
        case "turn":
          callbacks.onTurnId?.(
            data as { turnId: string; conversationId: number | null },
          );
          break;
        case "delta":
          callbacks.onDelta?.((data as { text: string }).text);
          break;
        case "reasoning_summary":
          callbacks.onReasoningSummaryDelta?.(
            (data as { delta: string }).delta,
          );
          break;
        case "response_reset":
          callbacks.onResponseReset?.();
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
        case "runtime":
          callbacks.onRuntime?.(data as ElaineRuntimeEventEnvelope);
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

/**
 * Tells the server the current turn's connection is about to be dropped
 * intentionally (widget maximize navigation) so it must keep generating
 * instead of aborting on disconnect. `keepalive` lets the request survive
 * the imminent page unload. Resolves false when the turn is unknown/expired.
 */
export async function signalElaineTurnHandoff(turnId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/elaine/chat/turns/${encodeURIComponent(turnId)}/handoff`,
      { method: "POST", keepalive: true },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Attaches to an in-progress (or just-finished) turn after a maximize
 * handoff: immediately replays everything generated so far through
 * `callbacks`, then keeps streaming live events until the turn completes.
 * Throws when the turn is unknown/expired (HTTP 404) — callers should fall
 * back to plain persisted history.
 */
export async function resumeElaineTurnStream(
  turnId: string,
  callbacks: AssistantChatStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  const response = await fetch(
    `/api/elaine/chat/turns/${encodeURIComponent(turnId)}/stream`,
    { headers: { Accept: "text/event-stream" }, signal },
  );
  if (!response.ok || !response.body) {
    throw new Error(`Turn resume failed with status ${response.status}`);
  }
  return readElaineSseStream(response.body, callbacks);
}

const newElaineConversationFn = (): Promise<{
  messages: AssistantMessage[];
  conversationId?: number | null;
}> =>
  customFetch<{ messages: AssistantMessage[]; conversationId?: number | null }>(
    "/api/elaine/conversation",
    { method: "DELETE" },
  );

export function useNewElaineConversation(options?: {
  mutation?: UseMutationOptions<
    { messages: AssistantMessage[]; conversationId?: number | null },
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

const createElaineMemoryFn = (
  body: CreateMemoryBody,
): Promise<HouseholdMemoryItem> =>
  customFetch<HouseholdMemoryItem>("/api/elaine/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useCreateElaineMemory(options?: {
  mutation?: UseMutationOptions<
    HouseholdMemoryItem,
    unknown,
    CreateMemoryBody
  >;
}): UseMutationResult<HouseholdMemoryItem, unknown, CreateMemoryBody> {
  const mutationFn: MutationFunction<HouseholdMemoryItem, CreateMemoryBody> = (
    body,
  ) => createElaineMemoryFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const updateElaineMemoryFn = (
  id: number,
  body: UpdateMemoryBody,
): Promise<HouseholdMemoryItem> =>
  customFetch<HouseholdMemoryItem>(`/api/elaine/memory/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateElaineMemory(options?: {
  mutation?: UseMutationOptions<
    HouseholdMemoryItem,
    unknown,
    { id: number; body: UpdateMemoryBody }
  >;
}): UseMutationResult<
  HouseholdMemoryItem,
  unknown,
  { id: number; body: UpdateMemoryBody }
> {
  const mutationFn: MutationFunction<
    HouseholdMemoryItem,
    { id: number; body: UpdateMemoryBody }
  > = ({ id, body }) => updateElaineMemoryFn(id, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export const getListElaineTasksQueryKey = () =>
  ["/api/elaine/tasks"] as const;

const listElaineTasksFn = (
  options?: RequestInit,
): Promise<{ tasks: ElaineTask[] }> =>
  customFetch<{ tasks: ElaineTask[] }>("/api/elaine/tasks", {
    ...options,
    method: "GET",
  });

export function useListElaineTasks<
  TData = { tasks: ElaineTask[] },
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<{ tasks: ElaineTask[] }, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListElaineTasksQueryKey();
  const queryFn: QueryFunction<{ tasks: ElaineTask[] }> = ({ signal }) =>
    listElaineTasksFn({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    { tasks: ElaineTask[] },
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

const cancelElaineTaskFn = (
  taskId: number,
): Promise<{ taskId: number; state: "cancelled" }> =>
  customFetch<{ taskId: number; state: "cancelled" }>(
    `/api/elaine/tasks/${taskId}/cancel`,
    { method: "POST" },
  );

export function useCancelElaineTask(options?: {
  mutation?: UseMutationOptions<
    { taskId: number; state: "cancelled" },
    unknown,
    number
  >;
}) {
  const mutationFn = (taskId: number) => cancelElaineTaskFn(taskId);
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
  runtimeTrace?: ElaineRuntimeTrace;
  /** Model-produced reasoning summary for assistant turns. */
  reasoningSummary?: string | null;
  /** Server-measured wall-clock duration (ms) of the reasoning phase.
   *  Present only for assistant turns that had reasoning; absent otherwise. */
  reasoningDurationMs?: number | null;
  /** True when this assistant turn was interrupted by the user clicking
   *  Stop before it finished. Absent (never true) for user messages. */
  stopped?: boolean;
  createdAt: string;
}

export const getListElaineConversationsQueryKey = (q?: string) =>
  q ? [`/api/elaine/conversations`, { q }] as const
    : [`/api/elaine/conversations`] as const;

/** Shape returned by GET /api/elaine/conversations */
export interface ConversationSummaryPage {
  conversations: ConversationSummary[];
  /** True when more conversations exist before the oldest one returned. */
  hasMore: boolean;
}

const listElaineConversationsFn = async (
  q?: string,
  options?: RequestInit,
): Promise<ConversationSummary[]> => {
  const url = q
    ? `/api/elaine/conversations?q=${encodeURIComponent(q)}`
    : "/api/elaine/conversations";
  const page = await customFetch<ConversationSummaryPage>(url, {
    ...options,
    method: "GET",
  });
  return page.conversations;
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

// ---------------------------------------------------------------------------
// Infinite (paginated) conversations list — used by the history panel for
// scroll-based load-more. The cursor is a composite of `updatedAt` + `id`
// from the last conversation in the previous page, which guarantees stable
// pagination even when multiple conversations share the same `updatedAt`
// timestamp (e.g. rapid bulk creation).
// ---------------------------------------------------------------------------

export const getInfiniteElaineConversationsQueryKey = () =>
  [`/api/elaine/conversations`, "infinite"] as const;

/** Composite cursor for the conversations list. */
export interface ConversationListCursor {
  before: string;
  beforeId: number;
}

const fetchElaineConversationsPage = (
  cursor: ConversationListCursor | undefined,
  options?: RequestInit,
): Promise<ConversationSummaryPage> => {
  const search = new URLSearchParams();
  if (cursor) {
    search.set("before", cursor.before);
    search.set("beforeId", String(cursor.beforeId));
  }
  const qs = search.toString();
  return customFetch<ConversationSummaryPage>(
    `/api/elaine/conversations${qs ? `?${qs}` : ""}`,
    { ...options, method: "GET" },
  );
};

export function useInfiniteElaineConversations(options?: {
  query?: Pick<
    UseInfiniteQueryOptions,
    "enabled" | "refetchOnWindowFocus" | "staleTime" | "gcTime"
  >;
}): UseInfiniteQueryResult<InfiniteData<ConversationSummaryPage>, unknown> {
  const queryKey = getInfiniteElaineConversationsQueryKey();
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }: { pageParam: unknown; signal: AbortSignal }) =>
      fetchElaineConversationsPage(
        pageParam != null && typeof pageParam === "object"
          ? (pageParam as ConversationListCursor)
          : undefined,
        { signal },
      ),
    getNextPageParam: (lastPage: ConversationSummaryPage) => {
      if (!lastPage.hasMore) return undefined;
      const last = lastPage.conversations[lastPage.conversations.length - 1];
      if (!last) return undefined;
      return { before: last.updatedAt, beforeId: last.id } satisfies ConversationListCursor;
    },
    initialPageParam: undefined as ConversationListCursor | undefined,
    ...options?.query,
  }) as UseInfiniteQueryResult<InfiniteData<ConversationSummaryPage>, unknown>;
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

export interface ConversationMessagesPage {
  messages: ConversationMessage[];
  /** True when older messages exist beyond this page — pass the oldest
   *  returned message's `id` as `before` to fetch the next page back. */
  hasMore: boolean;
}

export const getGetElaineConversationMessagesQueryKey = (
  id: number,
  params?: { before?: number; limit?: number },
) =>
  params?.before !== undefined
    ? ([`/api/elaine/conversations`, id, `messages`, params] as const)
    : ([`/api/elaine/conversations`, id, `messages`] as const);

export const getElaineConversationMessagesFn = (
  id: number,
  params?: { before?: number; limit?: number },
  options?: RequestInit,
): Promise<ConversationMessagesPage> => {
  const search = new URLSearchParams();
  if (params?.before !== undefined) search.set("before", String(params.before));
  if (params?.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return customFetch<ConversationMessagesPage>(
    `/api/elaine/conversations/${id}/messages${qs ? `?${qs}` : ""}`,
    { ...options, method: "GET" },
  );
};

export function useGetElaineConversationMessages<
  TData = ConversationMessagesPage,
  TError = unknown,
>(
  id: number | null,
  options?: {
    params?: { before?: number; limit?: number };
    query?: UseQueryOptions<ConversationMessagesPage, TError, TData>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { params, query: queryOptions } = options ?? {};
  const queryKey =
    queryOptions?.queryKey ??
    (id !== null
      ? getGetElaineConversationMessagesQueryKey(id, params)
      : (["disabled"] as const));
  const queryFn: QueryFunction<ConversationMessagesPage> = ({ signal }) =>
    getElaineConversationMessagesFn(id!, params, { signal });
  const queryOpts = {
    queryKey,
    queryFn,
    enabled: id !== null,
    ...queryOptions,
  } as UseQueryOptions<ConversationMessagesPage, TError, TData> & {
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
  const url = "/api/elaine/attachments";
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res, data, { method: "POST", url });
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
  openAIReasoning: string;
  openAIBalanced: string;
  openAIFast: string;
  rerank: string;
  visualEmbed: string;
  fusionModels: string[];
  fusionJudge: string;
  restrictedTextModel: string;
}

export interface ElaineTimeoutsConfig {
  expertConsultMs: number;
  rerankerMs: number;
  geocodingMs: number;
  fusionMs: number;
  openAIResponsesMs: number;
}

export interface ElaineFeaturesConfig {
  enableAdvisor: boolean;
  enableSubagent: boolean;
  enableFusionPotteryExpert: boolean;
  enableFusionTravelDocFallback: boolean;
  enableOpenAIResponses: boolean;
  enableOpenAIAppWorkflows: boolean;
  enableOpenAIResponsesFallback: boolean;
  enableBuiltinWebSearch: boolean;
  showReasoningSummary: boolean;
  openAIStoreEnabledDefault: boolean;
  openAIStoreScopeOverrides?: {
    elaine?: boolean;
    app?: boolean;
  };
  openAIStoreRoleOverrides?: {
    reasoning?: boolean;
    balanced?: boolean;
    fast?: boolean;
  };
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
  openAIResponsesMaxOutputTokens: number;
  openAICompactionThresholdTokens: number;
  openAIStateMaxAgeDays: number;
  codeDiagnosisRecurrenceThreshold: number;
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

const resetElaineAdminConfigFn = (): Promise<ElaineGlobalConfig> =>
  customFetch<ElaineGlobalConfig>("/api/elaine/admin/config/reset", {
    method: "POST",
  });

export function useResetElaineAdminConfig(options?: {
  mutation?: UseMutationOptions<ElaineGlobalConfig, unknown, void>;
}) {
  const mutationFn = () => resetElaineAdminConfigFn();
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

// ---------------------------------------------------------------------------
// Cross-channel context
// ---------------------------------------------------------------------------

export interface CrossChannelEntry {
  channel: string;
  gist: string;
  /** Short date string for display, e.g. "Aug 2". */
  ts: string;
  /** Full ISO-8601 timestamp for age comparisons. Absent on entries written
   *  before this field was added — treat those as having unknown/old age. */
  iso?: string;
}

export interface CrossChannelContext {
  entries: CrossChannelEntry[];
  updatedAt: string | null;
}

export const getGetElaineCrossChannelContextQueryKey = () =>
  [`/api/elaine/cross-channel-context`] as const;

const getElaineCrossChannelContextFn = (
  options?: RequestInit,
): Promise<CrossChannelContext> =>
  customFetch<CrossChannelContext>("/api/elaine/cross-channel-context", {
    ...options,
    method: "GET",
  });

export function useGetElaineCrossChannelContext<
  TData = CrossChannelContext,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<CrossChannelContext, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey =
    queryOptions?.queryKey ?? getGetElaineCrossChannelContextQueryKey();
  const queryFn: QueryFunction<CrossChannelContext> = ({ signal }) =>
    getElaineCrossChannelContextFn({ signal });
  const queryOpts = {
    queryKey,
    queryFn,
    staleTime: 30 * 1000,
    ...queryOptions,
  } as UseQueryOptions<CrossChannelContext, TError, TData> & {
    queryKey: QueryKey;
  };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
}

const clearElaineCrossChannelContextFn = (): Promise<void> =>
  customFetch<void>("/api/elaine/cross-channel-context", { method: "DELETE" });

export function useClearElaineCrossChannelContext(options?: {
  mutation?: UseMutationOptions<void, unknown, void>;
}): UseMutationResult<void, unknown, void> {
  const mutationFn: MutationFunction<void, void> = () =>
    clearElaineCrossChannelContextFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Unified cross-channel history
// ---------------------------------------------------------------------------

export interface UnifiedHistoryMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  /** Channel label; pre-normalized to "web" for NULL rows. */
  channel: string;
  createdAt: string;
}

export interface UnifiedHistoryPage {
  messages: UnifiedHistoryMessage[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const getElaineUnifiedHistoryQueryKey = (
  page: number,
  channel?: string,
) => [`/api/elaine/history/unified`, { page, channel }] as const;

const getElaineUnifiedHistoryFn = (
  page: number,
  channel?: string,
  options?: RequestInit,
): Promise<UnifiedHistoryPage> => {
  const params = new URLSearchParams({ page: String(page) });
  if (channel) params.set("channel", channel);
  return customFetch<UnifiedHistoryPage>(
    `/api/elaine/history/unified?${params.toString()}`,
    { ...options, method: "GET" },
  );
};

export function useGetElaineUnifiedHistory<
  TData = UnifiedHistoryPage,
  TError = unknown,
>(
  page: number,
  channel?: string,
  options?: {
    query?: UseQueryOptions<UnifiedHistoryPage, TError, TData>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey =
    queryOptions?.queryKey ?? getElaineUnifiedHistoryQueryKey(page, channel);
  const queryFn: QueryFunction<UnifiedHistoryPage> = ({ signal }) =>
    getElaineUnifiedHistoryFn(page, channel, { signal });
  const queryOpts = {
    queryKey,
    queryFn,
    staleTime: 30 * 1000,
    ...queryOptions,
  } as UseQueryOptions<UnifiedHistoryPage, TError, TData> & {
    queryKey: QueryKey;
  };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOpts.queryKey };
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
