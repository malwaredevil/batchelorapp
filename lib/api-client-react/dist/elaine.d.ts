import { type QueryKey, type UseMutationOptions, type UseMutationResult, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
export type ElaineAppId = "travels" | "pottery" | "quilting" | "hub" | "elaine";
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
export type TravelActionType = "create_trip" | "add_wishlist" | "add_packing_item" | "update_trip_status" | "update_trip_details" | "cancel_trip" | "mark_wishlist_done" | "remove_wishlist_item" | "remove_packing_item" | "add_reminder" | "sync_reminder_to_calendar" | "edit_reminder" | "delete_reminder" | "add_itinerary_day" | "regenerate_itinerary_day" | "add_connected_calendar" | "disconnect_calendar" | "rescan_document" | "generate_itinerary" | "confirm_itinerary_activity" | "remove_itinerary_activity" | "send_email";
export type PotteryActionType = "update_pottery_item" | "delete_pottery_item" | "create_pottery_category" | "delete_pottery_category";
export type QuiltingActionType = "update_fabric" | "delete_fabric" | "update_pattern" | "delete_pattern" | "create_shopping_item" | "update_shopping_item" | "delete_shopping_item" | "create_quilting_category" | "delete_quilting_category";
export type AssistantActionType = TravelActionType | PotteryActionType | QuiltingActionType;
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
export type ChatWindowSize = "compact" | "comfortable" | "large";
export interface ExecutedAssistantAction extends AssistantAction {
    status: number;
    result: unknown;
}
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
export type ChatWidget = {
    type: "weather";
    locationName: string;
    days: WeatherDay[];
} | {
    type: "places";
    query: string;
    places: PlaceResult[];
} | {
    type: "air_quality";
    data: {
        aqi: number;
        category: string;
        dominantPollutant: string;
        locationName: string;
    };
} | {
    type: "pollen";
    data: {
        date: string;
        overallCategory: string;
        locationName: string;
        types: Array<{
            displayName: string;
            category: string;
        }>;
    };
} | {
    type: "data_card";
    title?: string;
    rows: DataCardRow[];
} | {
    type: "image_card";
    title?: string;
    images: ChatWidgetImage[];
} | {
    type: "exchange_rate";
    from: string;
    to: ExchangeRateResult[];
    lastUpdated: string;
} | {
    type: "trip_card";
    trip: TripCardData;
};
export interface AssistantChatResponse {
    role: "assistant";
    content: string;
    navigate: {
        path: string;
        reason: string;
    } | null;
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
export declare const getGetElaineConversationQueryKey: () => readonly ["/api/elaine/conversation"];
export declare function useGetElaineConversation<TData = {
    messages: AssistantMessage[];
}, TError = unknown>(options?: {
    query?: UseQueryOptions<{
        messages: AssistantMessage[];
    }, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export interface AssistantChatStreamCallbacks {
    onDelta?: (text: string) => void;
    onAction?: (action: AssistantAction) => void;
    onStatus?: (message: string) => void;
    onWidget?: (widget: ChatWidget) => void;
    onDone?: (result: AssistantChatResponse) => void;
}
export declare function streamElaineMessage(body: {
    message: string;
    pageContext?: string;
    appId: ElaineAppId;
    /** ID of the named conversation to continue. Omit to start a new one. */
    conversationId?: number;
    /** Signed Supabase Storage URLs for image attachments (JPEG/PNG/WebP). */
    attachmentUrls?: string[];
    /** PDF attachments: signed URL + original filename + extracted text. */
    attachmentPdfs?: Array<{
        url: string;
        name: string;
        extractedText?: string;
    }>;
    /** Auto-captured page screenshot URL — sent to model for visual context but not persisted. */
    pageScreenshotUrl?: string;
}, callbacks?: AssistantChatStreamCallbacks, signal?: AbortSignal): Promise<AssistantChatResponse>;
export declare function useNewElaineConversation(options?: {
    mutation?: UseMutationOptions<{
        messages: AssistantMessage[];
    }, unknown, void>;
}): UseMutationResult<{
    messages: AssistantMessage[];
}, unknown, void, unknown>;
export declare function useExecuteElaineAction(options?: {
    mutation?: UseMutationOptions<AssistantActionResult, unknown, Pick<AssistantAction, "type" | "payload">>;
}): UseMutationResult<AssistantActionResult, unknown, Pick<AssistantAction, "type" | "payload">, unknown>;
export declare const getGetElaineSettingsQueryKey: () => readonly ["/api/elaine/settings"];
export declare function useGetElaineSettings<TData = AssistantSettings, TError = unknown>(options?: {
    query?: UseQueryOptions<AssistantSettings, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export type UpdateElaineSettingsBody = Partial<AssistantSettings>;
export declare function useUpdateElaineSettings(options?: {
    mutation?: UseMutationOptions<AssistantSettings, unknown, UpdateElaineSettingsBody>;
}): UseMutationResult<AssistantSettings, unknown, Partial<AssistantSettings>, unknown>;
export interface AssistantNudgesUnseenCount {
    count: number;
}
export declare const getGetElaineNudgesUnseenCountQueryKey: () => readonly ["/api/elaine/nudges/unseen-count"];
export declare function useGetElaineNudgesUnseenCount<TData = AssistantNudgesUnseenCount, TError = unknown>(options?: {
    query?: UseQueryOptions<AssistantNudgesUnseenCount, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListElaineMemoryQueryKey: () => readonly ["/api/elaine/memory"];
export declare function useListElaineMemory<TData = HouseholdMemoryItem[], TError = unknown>(options?: {
    query?: UseQueryOptions<HouseholdMemoryItem[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useDeleteElaineMemoryItem(options?: {
    mutation?: UseMutationOptions<void, unknown, number>;
}): UseMutationResult<void, unknown, number>;
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
export declare const getListElaineConversationsQueryKey: (q?: string) => readonly ["/api/elaine/conversations"] | readonly ["/api/elaine/conversations", {
    readonly q: string;
}];
export declare function useListElaineConversations<TData = ConversationSummary[], TError = unknown>(options?: {
    q?: string;
    query?: UseQueryOptions<ConversationSummary[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useCreateElaineConversation(options?: {
    mutation?: UseMutationOptions<ConversationSummary, unknown, void>;
}): UseMutationResult<ConversationSummary, unknown, void, unknown>;
export declare function useRenameElaineConversation(options?: {
    mutation?: UseMutationOptions<ConversationSummary, unknown, {
        id: number;
        title: string;
    }>;
}): UseMutationResult<ConversationSummary, unknown, {
    id: number;
    title: string;
}>;
export declare function useDeleteElaineConversation(options?: {
    mutation?: UseMutationOptions<void, unknown, number>;
}): UseMutationResult<void, unknown, number>;
export declare const getGetElaineConversationMessagesQueryKey: (id: number) => readonly ["/api/elaine/conversations", number, "messages"];
export declare function useGetElaineConversationMessages<TData = ConversationMessage[], TError = unknown>(id: number | null, options?: {
    query?: UseQueryOptions<ConversationMessage[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
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
export declare function uploadElaineAttachment(file: File): Promise<ElaineAttachmentUploadResult>;
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
export declare const getGetElaineAdminConfigQueryKey: () => readonly ["/api/elaine/admin/config"];
export declare function useGetElaineAdminConfig<TData = ElaineGlobalConfig, TError = unknown>(options?: {
    query?: UseQueryOptions<ElaineGlobalConfig, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export type UpdateElaineAdminConfigBody = Partial<Pick<ElaineGlobalConfig, "chatModel" | "subagentModel" | "requestTimeoutMs" | "maxResponseTokens">> & {
    models?: Partial<ElaineExtraModelsConfig>;
    timeouts?: Partial<ElaineTimeoutsConfig>;
    features?: Partial<ElaineFeaturesConfig>;
    thresholds?: Partial<ElaineThresholdsConfig>;
};
export declare function useUpdateElaineAdminConfig(options?: {
    mutation?: UseMutationOptions<ElaineGlobalConfig, unknown, UpdateElaineAdminConfigBody>;
}): UseMutationResult<ElaineGlobalConfig, unknown, UpdateElaineAdminConfigBody, unknown>;
export interface OpenRouterModelSummary {
    id: string;
    name: string;
    contextLength: number | null;
    promptPricePerMTok: number | null;
    completionPricePerMTok: number | null;
}
export declare const getListElaineAdminModelsQueryKey: () => readonly ["/api/elaine/admin/models"];
export interface DailyBrief {
    id: number;
    content: string;
    generatedAt: string;
    dismissed: boolean;
}
export declare const getElaineDailyBriefQueryKey: () => readonly ["/api/elaine/daily-brief"];
export declare function useGetElaineDailyBrief<TData = DailyBrief, TError = unknown>(options?: {
    query?: UseQueryOptions<DailyBrief, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useDismissElaineDailyBrief(options?: {
    mutation?: UseMutationOptions<void, unknown, void>;
}): UseMutationResult<void, unknown, void>;
export declare function useRegenerateElaineDailyBrief(options?: {
    mutation?: UseMutationOptions<DailyBrief, unknown, void>;
}): UseMutationResult<DailyBrief, unknown, void>;
export declare function useListElaineAdminModels<TData = OpenRouterModelSummary[], TError = unknown>(options?: {
    query?: UseQueryOptions<OpenRouterModelSummary[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
//# sourceMappingURL=elaine.d.ts.map