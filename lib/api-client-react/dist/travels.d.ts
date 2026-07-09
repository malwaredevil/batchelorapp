import { type QueryKey, type UseMutationOptions, type UseMutationResult, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
export type TripStatus = "wishlist" | "planning" | "booked" | "active" | "completed";
export type TransportTo = "drove" | "flew" | "train";
export interface Trip {
    id: number;
    userId: number;
    title: string;
    destination: string;
    lat?: number | null;
    lng?: number | null;
    status: TripStatus;
    startDate?: string | null;
    endDate?: string | null;
    transportTo?: TransportTo | null;
    transportDetails?: string | null;
    hasRentalCar: boolean;
    accommodationName?: string | null;
    accommodationArea?: string | null;
    notes?: string | null;
    funFact?: string | null;
    travellerCount: number;
    travelers?: string[] | null;
    theOneThing?: string[] | null;
    iconPhotoId?: number | null;
    shareToken?: string | null;
    createdAt: string;
}
export interface TripDocument {
    id: number;
    tripId: number;
    userId: number;
    storagePath: string;
    title?: string | null;
    documentType?: string | null;
    originalFilename?: string | null;
    extractedData?: Record<string, unknown> | null;
    lockedFields?: string[];
    gmailMessageId?: string | null;
    iconOverride?: string | null;
    createdAt: string;
}
export interface CustomDocumentType {
    id: number;
    userId: number;
    typeKey: string;
    typeName: string;
    description: string | null;
    iconName: string | null;
    colorKey: string | null;
    fields: Array<{
        key: string;
        label: string;
    }> | null;
    createdAt: string;
}
export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}
export interface ChatResponse {
    role: "assistant";
    content: string;
    history: ChatMessage[];
}
export interface TripDetail extends Trip {
    itinerary?: unknown | null;
    packingList?: unknown | null;
    todoList?: unknown | null;
    chatHistory?: ChatMessage[] | null;
    documents: TripDocument[];
}
export interface CreateTripBody {
    title: string;
    destination: string;
    lat?: number;
    lng?: number;
    status?: TripStatus;
    startDate?: string;
    endDate?: string;
    transportTo?: TransportTo;
    transportDetails?: string;
    hasRentalCar?: boolean;
    accommodationName?: string;
    accommodationArea?: string;
    notes?: string;
    funFact?: string;
    travellerCount?: number;
    travelers?: string[];
    theOneThing?: string[];
}
export type UpdateTripBody = Partial<CreateTripBody> & {
    itinerary?: unknown;
    packingList?: unknown;
    todoList?: unknown;
};
export interface GenerateItineraryBody {
    style: "relaxed" | "balanced" | "packed";
    interests: string[];
    regenerateDay?: number;
}
export interface ItineraryResult {
    itinerary: unknown;
}
export interface ExploreDestinationBody {
    destination: string;
}
export interface ExploreDestinationResult {
    destination: string;
    lat: number;
    lng: number;
    distanceKm?: number | null;
    mapsUrl?: string;
    timezone?: {
        timeZoneId: string;
        timeZoneName: string;
        rawOffsetSeconds: number;
        dstOffsetSeconds: number;
    } | null;
    overview: {
        description?: string;
        highlights?: Array<{
            name: string;
            description: string;
            category: string;
        }>;
        bestTimeToVisit?: string;
        practicalInfo?: {
            currency?: string;
            language?: string;
            tipping?: string;
            transit?: string;
        };
    };
}
export interface WishlistItem {
    id: number;
    userId: number;
    destination: string;
    targetDate?: string | null;
    notes?: string | null;
    lat?: number | null;
    lng?: number | null;
    done: boolean;
    sortOrder: number;
    createdAt: string;
}
export interface CreateWishlistItemBody {
    destination: string;
    targetDate?: string;
    notes?: string;
    sortOrder?: number;
}
export interface UpdateWishlistItemBody {
    destination?: string;
    targetDate?: string | null;
    notes?: string | null;
    lat?: number | null;
    lng?: number | null;
    done?: boolean;
    sortOrder?: number;
}
export interface ImportBody {
    trips: Array<{
        title: string;
        destination: string;
        status?: "wishlist" | "planning" | "booked" | "active" | "completed";
        startDate?: string;
        endDate?: string;
        travelers?: string[];
        theOneThing?: string[];
        notes?: string;
        travellerCount?: number;
        lat?: number;
        lng?: number;
        transportTo?: "drove" | "flew" | "train";
        accommodationName?: string;
    }>;
    wishlistItems: Array<{
        destination: string;
        targetDate?: string;
        notes?: string;
        done?: boolean;
    }>;
}
export interface ImportResult {
    success: boolean;
    tripsCreated: number;
    tripsSkipped: number;
    wishlistCreated: number;
    wishlistSkipped: number;
}
export interface TravelsStats {
    totalTrips: number;
    completedTrips: number;
    upcomingTrips: number;
    uniqueDestinations: number;
    nextTrip: {
        id: number;
        destination: string;
        startDate: string;
    } | null;
}
export declare const generateTripShareToken: (id: number, options?: RequestInit) => Promise<{
    shareToken: string;
}>;
export declare const revokeTripShareToken: (id: number, options?: RequestInit) => Promise<void>;
export declare const listCustomDocumentTypes: (options?: RequestInit) => Promise<CustomDocumentType[]>;
export declare const createCustomDocumentType: (body: {
    typeKey: string;
    typeName: string;
    description?: string;
    iconName?: string;
    colorKey?: string;
    fields?: Array<{
        key: string;
        label: string;
    }>;
}, options?: RequestInit) => Promise<CustomDocumentType>;
export declare const suggestDocumentType: (body: {
    typeName: string;
    description?: string;
}, options?: RequestInit) => Promise<{
    iconName: string;
    colorKey: string;
    fields: Array<{
        key: string;
        label: string;
    }>;
}>;
export declare const getTripDocumentDownloadUrl: (tripId: number, docId: number) => string;
export declare const getTripDocumentWalletPassUrl: (tripId: number, docId: number, options?: RequestInit) => Promise<{
    saveUrl: string;
}>;
export interface DailyWeather {
    date: string;
    conditionDescription: string;
    maxTempC: number | null;
    minTempC: number | null;
    precipitationChancePercent: number | null;
}
export declare const getWeatherForecast: (lat: number, lng: number, options?: RequestInit) => Promise<{
    forecast: DailyWeather[];
}>;
export interface MapPlaceResult {
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
export declare const searchNearbyPlaces: (query: string, lat?: number, lng?: number, options?: RequestInit) => Promise<{
    places: MapPlaceResult[];
}>;
export declare const getStaticMapImageUrl: (lat: number, lng: number, width?: number, height?: number, zoom?: number) => string;
export declare const getStreetViewImageUrl: (lat: number, lng: number, width?: number, height?: number) => string;
export interface RouteInfoResult {
    distanceMeters: number;
    durationSeconds: number;
    optimizedIntermediateWaypointIndex?: number[];
    encodedPolyline?: string;
}
export declare const computeRouteInfo: (body: {
    origin: {
        lat: number;
        lng: number;
    };
    destination: {
        lat: number;
        lng: number;
    };
    intermediates?: {
        lat: number;
        lng: number;
    }[];
    mode?: "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";
    optimizeWaypoints?: boolean;
}, options?: RequestInit) => Promise<RouteInfoResult>;
export interface TimeZoneResult {
    timeZoneId: string;
    timeZoneName: string;
    rawOffsetSeconds: number;
    dstOffsetSeconds: number;
}
export declare const getTimeZoneInfo: (lat: number, lng: number, options?: RequestInit) => Promise<{
    timeZone: TimeZoneResult;
}>;
export interface AirQualityResult {
    aqi: number;
    category: string;
    dominantPollutant: string;
}
export declare const getAirQualityInfo: (lat: number, lng: number, options?: RequestInit) => Promise<{
    airQuality: AirQualityResult | null;
}>;
export interface PollenResult {
    date: string;
    overallCategory: string;
    types: {
        code: string;
        displayName: string;
        category: string;
    }[];
}
export declare const getPollenInfo: (lat: number, lng: number, options?: RequestInit) => Promise<{
    pollen: PollenResult | null;
}>;
export declare const getNearbyPlaceCountInfo: (lat: number, lng: number, type: string, radiusMeters?: number, options?: RequestInit) => Promise<{
    count: number;
}>;
export interface AerialViewResult {
    state: "ACTIVE" | "PROCESSING" | "NOT_FOUND";
    videoUrl?: string;
    thumbnailUrl?: string;
}
export declare const getAerialViewInfo: (address: string, options?: RequestInit) => Promise<AerialViewResult>;
export declare const sendTripMessage: (tripId: number, body: {
    message: string;
}, options?: RequestInit) => Promise<ChatResponse>;
export declare const clearTripChat: (tripId: number, options?: RequestInit) => Promise<{
    history: ChatMessage[];
}>;
export declare function useGenerateTripShareToken<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<{
        shareToken: string;
    }, TError, number, TContext>;
}): UseMutationResult<{
    shareToken: string;
}, TError, number, TContext>;
export declare function useRevokeTripShareToken<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<void, TError, number, TContext>;
}): UseMutationResult<void, TError, number, TContext>;
export declare function useListCustomDocumentTypes<TError = unknown>(options?: {
    query?: Partial<UseQueryOptions<CustomDocumentType[], TError>>;
}): UseQueryResult<CustomDocumentType[], TError>;
export declare function useCreateCustomDocumentType<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<CustomDocumentType, TError, {
        typeKey: string;
        typeName: string;
        description?: string;
        iconName?: string;
        colorKey?: string;
        fields?: Array<{
            key: string;
            label: string;
        }>;
    }, TContext>;
}): UseMutationResult<CustomDocumentType, TError, {
    typeKey: string;
    typeName: string;
    description?: string;
    iconName?: string;
    colorKey?: string;
    fields?: Array<{
        key: string;
        label: string;
    }>;
}, TContext>;
export declare function useSuggestDocumentType<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<{
        iconName: string;
        colorKey: string;
        fields: Array<{
            key: string;
            label: string;
        }>;
    }, TError, {
        typeName: string;
        description?: string;
    }, TContext>;
}): UseMutationResult<{
    iconName: string;
    colorKey: string;
    fields: Array<{
        key: string;
        label: string;
    }>;
}, TError, {
    typeName: string;
    description?: string;
}, TContext>;
export declare function useGetTripDocumentWalletPass<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<{
        saveUrl: string;
    }, TError, {
        tripId: number;
        docId: number;
    }, TContext>;
}): UseMutationResult<{
    saveUrl: string;
}, TError, {
    tripId: number;
    docId: number;
}, TContext>;
export declare const sendTestReminderEmail: (options?: RequestInit) => Promise<{
    sent: boolean;
    to: string;
}>;
export declare function useSendTestReminderEmail<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<{
        sent: boolean;
        to: string;
    }, TError, void, TContext>;
}): UseMutationResult<{
    sent: boolean;
    to: string;
}, TError, void, TContext>;
export declare function useSendTripMessage<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<ChatResponse, TError, {
        tripId: number;
        message: string;
    }, TContext>;
}): UseMutationResult<ChatResponse, TError, {
    tripId: number;
    message: string;
}, TContext>;
export declare function useClearTripChat<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<{
        history: ChatMessage[];
    }, TError, number, TContext>;
}): UseMutationResult<{
    history: ChatMessage[];
}, TError, number, TContext>;
export declare const getListWishlistUrl: () => string;
export declare const listWishlist: (options?: RequestInit) => Promise<WishlistItem[]>;
export declare const getListWishlistQueryKey: () => readonly ["/api/travels/wishlist"];
export declare const createWishlistItem: (body: CreateWishlistItemBody, options?: RequestInit) => Promise<WishlistItem>;
export declare const updateWishlistItem: (id: number, body: UpdateWishlistItemBody, options?: RequestInit) => Promise<WishlistItem>;
export declare const deleteWishlistItem: (id: number, options?: RequestInit) => Promise<void>;
export declare function useListWishlist<TData = Awaited<ReturnType<typeof listWishlist>>, TError = unknown>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listWishlist>>, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useCreateWishlistItem<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<WishlistItem, TError, CreateWishlistItemBody, TContext>;
}): UseMutationResult<WishlistItem, TError, CreateWishlistItemBody, TContext>;
export declare function useUpdateWishlistItem<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<WishlistItem, TError, {
        id: number;
        body: UpdateWishlistItemBody;
    }, TContext>;
}): UseMutationResult<WishlistItem, TError, {
    id: number;
    body: UpdateWishlistItemBody;
}, TContext>;
export declare function useDeleteWishlistItem<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<void, TError, number, TContext>;
}): UseMutationResult<void, TError, number, TContext>;
export type PhotoType = "photo" | "magnet";
export interface TripPhoto {
    id: number;
    tripId: number;
    userId: number;
    storagePath: string;
    caption?: string | null;
    photoType: PhotoType;
    sortOrder: number;
    createdAt: string;
}
export interface UpdatePhotoBody {
    caption?: string | null;
}
export declare const getTripPhotoImageUrl: (tripId: number, photoId: number) => string;
export declare const getListTripPhotosQueryKey: (tripId: number, photoType?: PhotoType) => readonly [`/api/travels/trips/${number}/photos`, PhotoType | undefined];
export declare function useListTripPhotos<TData = TripPhoto[], TError = unknown>(tripId: number, photoType?: PhotoType, options?: {
    query?: UseQueryOptions<TripPhoto[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useSetTripIcon<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<{
        iconPhotoId: number | null;
    }, TError, {
        tripId: number;
        photoId: number | null;
    }, TContext>;
}): UseMutationResult<{
    iconPhotoId: number | null;
}, TError, {
    tripId: number;
    photoId: number | null;
}, TContext>;
export declare const uploadTripPhoto: (tripId: number, formData: FormData) => Promise<TripPhoto>;
export declare function useUploadTripPhoto<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<TripPhoto, TError, {
        tripId: number;
        formData: FormData;
    }, TContext>;
}): UseMutationResult<TripPhoto, TError, {
    tripId: number;
    formData: FormData;
}, TContext>;
export interface MagnetCheckMatch {
    photoId: number;
    tripId: number;
    tripTitle: string;
    caption?: string | null;
    similarity: number;
}
export interface MagnetCheckResult {
    verdict: "likely_owned" | "possible_match" | "no_match";
    matches: MagnetCheckMatch[];
}
export declare const checkMagnet: (formData: FormData) => Promise<MagnetCheckResult>;
export declare function useCheckMagnet<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<MagnetCheckResult, TError, FormData, TContext>;
}): UseMutationResult<MagnetCheckResult, TError, FormData, TContext>;
export declare function useDeleteTripPhoto<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<void, TError, {
        tripId: number;
        photoId: number;
    }, TContext>;
}): UseMutationResult<void, TError, {
    tripId: number;
    photoId: number;
}, TContext>;
export declare function useUpdateTripPhoto<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<TripPhoto, TError, {
        tripId: number;
        photoId: number;
        body: UpdatePhotoBody;
    }, TContext>;
}): UseMutationResult<TripPhoto, TError, {
    tripId: number;
    photoId: number;
    body: UpdatePhotoBody;
}, TContext>;
export interface Reminder {
    id: number;
    tripId: number;
    userId: number;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    done: boolean;
    recipientEmails: string[];
    smsRecipientUserIds?: number[];
    syncToCalendar: boolean;
    googleEventId?: string | null;
    alertDaysBefore?: number[];
    createdAt: string;
}
export interface CreateReminderBody {
    title: string;
    description?: string | null;
    dueDate?: string;
    recipientEmails?: string[];
    smsRecipientUserIds?: number[];
    syncToCalendar?: boolean;
    alertDaysBefore?: number[];
}
export interface UpdateReminderBody {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    done?: boolean;
    recipientEmails?: string[];
    smsRecipientUserIds?: number[];
    syncToCalendar?: boolean;
    alertDaysBefore?: number[];
}
export declare const getListRemindersQueryKey: (tripId: number) => readonly [`/api/travels/trips/${number}/reminders`];
export declare function useListReminders<TData = Reminder[], TError = unknown>(tripId: number, options?: {
    query?: UseQueryOptions<Reminder[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListAllRemindersQueryKey: (pending?: boolean) => readonly ["/api/travels/reminders", {
    readonly pending: boolean;
}];
export declare function useListAllReminders<TData = Reminder[], TError = unknown>(pending?: boolean, options?: {
    query?: UseQueryOptions<Reminder[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useCreateReminder<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Reminder, TError, {
        tripId: number;
        body: CreateReminderBody;
    }, TContext>;
}): UseMutationResult<Reminder, TError, {
    tripId: number;
    body: CreateReminderBody;
}, TContext>;
export declare function useUpdateReminder<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Reminder, TError, {
        tripId: number;
        reminderId: number;
        body: UpdateReminderBody;
    }, TContext>;
}): UseMutationResult<Reminder, TError, {
    tripId: number;
    reminderId: number;
    body: UpdateReminderBody;
}, TContext>;
export declare function useDeleteReminder<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<void, TError, {
        tripId: number;
        reminderId: number;
    }, TContext>;
}): UseMutationResult<void, TError, {
    tripId: number;
    reminderId: number;
}, TContext>;
export interface CardLayoutPreference {
    cardOrder: string[];
}
export declare const getGetCardLayoutQueryKey: () => readonly ["/api/travels/card-layout"];
export declare function useGetCardLayout<TData = CardLayoutPreference, TError = unknown>(options?: {
    query?: UseQueryOptions<CardLayoutPreference, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useUpdateCardLayout<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<CardLayoutPreference, TError, {
        cardOrder: string[];
    }, TContext>;
}): UseMutationResult<CardLayoutPreference, TError, {
    cardOrder: string[];
}, TContext>;
export interface TripCardCollapseState {
    collapsedCards: string[];
}
export declare const getGetTripCardCollapseQueryKey: (tripId: number) => readonly [`/api/travels/trips/${number}/card-collapse`];
export declare function useGetTripCardCollapse<TData = TripCardCollapseState, TError = unknown>(tripId: number, options?: {
    query?: UseQueryOptions<TripCardCollapseState, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useUpdateTripCardCollapse<TError = unknown, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<TripCardCollapseState, TError, {
        tripId: number;
        collapsedCards: string[];
    }, TContext>;
}): UseMutationResult<TripCardCollapseState, TError, {
    tripId: number;
    collapsedCards: string[];
}, TContext>;
export interface DestinationGroup {
    destination: string;
    lat?: number | null;
    lng?: number | null;
    trips: Trip[];
}
export declare const getListDestinationsQueryKey: () => readonly ["/api/travels/destinations"];
export declare function useListDestinations<TData = DestinationGroup[], TError = unknown>(options?: {
    query?: UseQueryOptions<DestinationGroup[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getHighlightsUrl: () => string;
export declare const getHighlights: (options?: RequestInit) => Promise<string[]>;
export declare const getGetHighlightsQueryKey: () => readonly ["/api/travels/highlights"];
export declare function useGetHighlights<TData = Awaited<ReturnType<typeof getHighlights>>, TError = unknown>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getHighlights>>, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export interface TravelsAppUser {
    id: number;
    email: string;
    displayName: string | null;
    phoneVerified: boolean;
}
export declare const getListTravelsAppUsersQueryKey: () => readonly ["/api/travels/users"];
export declare function useListTravelsAppUsers<TData = TravelsAppUser[], TError = unknown>(options?: {
    query?: UseQueryOptions<TravelsAppUser[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export interface TravelsSettings {
    reminderEmail: string | null;
    timezone: string | null;
}
export declare const getGetTravelsSettingsQueryKey: () => readonly ["/api/travels/settings"];
export declare function useGetTravelsSettings<TData = TravelsSettings, TError = unknown>(options?: {
    query?: UseQueryOptions<TravelsSettings, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useUpdateTravelsSettings(options?: {
    mutation?: UseMutationOptions<TravelsSettings, unknown, {
        reminderEmail: string | null;
    }>;
}): UseMutationResult<TravelsSettings, unknown, {
    reminderEmail: string | null;
}, unknown>;
export declare function useUpdateTravelsTimezone(options?: {
    mutation?: UseMutationOptions<{
        timezone: string | null;
    }, unknown, {
        timezone: string | null;
    }>;
}): UseMutationResult<{
    timezone: string | null;
}, unknown, {
    timezone: string | null;
}, unknown>;
export interface GmailStatus {
    connected: boolean;
    googleEmail: string | null;
    lastScanAt: string | null;
}
export declare const getGetGmailStatusQueryKey: () => readonly ["/api/travels/gmail/status"];
export declare function useGetGmailStatus<TData = GmailStatus, TError = unknown>(options?: {
    query?: UseQueryOptions<GmailStatus, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useDisconnectGmail(options?: {
    mutation?: UseMutationOptions<void, unknown, void>;
}): UseMutationResult<void, unknown, void, unknown>;
export interface GmailScanResult {
    scanned: number;
    suggested: number;
    ignored: number;
}
export declare function useScanGmail(options?: {
    mutation?: UseMutationOptions<GmailScanResult, unknown, void>;
}): UseMutationResult<GmailScanResult, unknown, void, unknown>;
export interface GmailScanDecision {
    id: number;
    userId: number;
    gmailMessageId: string;
    threadId: string | null;
    subject: string | null;
    fromAddress: string | null;
    receivedAt: string | null;
    status: "pending" | "linked" | "dismissed" | "ignored";
    extractedData: Record<string, unknown> | null;
    dedupeKey: string | null;
    suggestedTripId: number | null;
    tripId: number | null;
    tripDocumentId: number | null;
    createdAt: string;
    updatedAt: string;
}
export declare const getGetGmailSuggestionsQueryKey: () => readonly ["/api/travels/gmail/suggestions"];
export declare function useGetGmailSuggestions<TData = GmailScanDecision[], TError = unknown>(options?: {
    query?: UseQueryOptions<GmailScanDecision[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useDismissGmailSuggestion(options?: {
    mutation?: UseMutationOptions<GmailScanDecision, unknown, number>;
}): UseMutationResult<GmailScanDecision, unknown, number, unknown>;
export interface GmailInboxMessage {
    id: string;
    threadId: string;
    subject: string | null;
    from: string | null;
    date: string | null;
    snippet: string;
    alreadyLinked: boolean;
    alreadyIgnored: boolean;
    linkedTripTitle: string | null;
    linkedDocumentName: string | null;
    linkedTripId: number | null;
}
export interface GmailInboxPage {
    messages: GmailInboxMessage[];
    nextPageToken: string | null;
}
export declare const getGetGmailInboxQueryKey: (params: {
    q?: string;
    pageToken?: string;
    maxResults?: number;
}) => readonly ["/api/travels/gmail/inbox", {
    q?: string;
    pageToken?: string;
    maxResults?: number;
}];
export declare function useGetGmailInbox<TData = GmailInboxPage, TError = unknown>(params: {
    q?: string;
    pageToken?: string;
    maxResults?: number;
}, options?: {
    query?: UseQueryOptions<GmailInboxPage, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export interface LinkGmailMessageBody {
    tripId: number;
    /** When provided, only these attachment IDs are processed. */
    attachmentIds?: string[];
    /** When true, the email body text is also saved as a document. */
    includeEmailBody?: boolean;
    /** Per-item title overrides: keys are attachmentId or "body". */
    titles?: Record<string, string>;
}
export declare function useLinkGmailMessage(options?: {
    mutation?: UseMutationOptions<unknown, unknown, {
        messageId: string;
    } & LinkGmailMessageBody>;
}): UseMutationResult<unknown, unknown, {
    messageId: string;
} & LinkGmailMessageBody, unknown>;
export declare function useIgnoreGmailMessage(options?: {
    mutation?: UseMutationOptions<void, unknown, string>;
}): UseMutationResult<void, unknown, string, unknown>;
export declare function useReconsiderGmailMessage(options?: {
    mutation?: UseMutationOptions<void, unknown, string>;
}): UseMutationResult<void, unknown, string, unknown>;
export declare function useUnlinkGmailMessage(options?: {
    mutation?: UseMutationOptions<void, unknown, string>;
}): UseMutationResult<void, unknown, string, unknown>;
export interface GmailMessageAttachment {
    filename: string;
    mimeType: string;
    attachmentId: string;
    size?: number;
}
export interface GmailMessageContent {
    id: string;
    subject: string | null;
    from: string | null;
    date: string | null;
    textBody: string;
    attachments: GmailMessageAttachment[];
}
export declare const getGetGmailMessageQueryKey: (messageId: string) => readonly [`/api/travels/gmail/messages/${string}`];
export declare function useGetGmailMessage<TData = GmailMessageContent, TError = unknown>(messageId: string, options?: {
    query?: UseQueryOptions<GmailMessageContent, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export interface GmailBulkLinkResult {
    results: {
        messageId: string;
        status: "linked" | "already_linked" | "failed";
        error?: string;
    }[];
}
export interface GmailBulkUnlinkResult {
    results: {
        messageId: string;
        status: "unlinked" | "not_linked" | "failed";
        tripId: number | null;
    }[];
}
export declare function useBulkLinkGmailMessages(options?: {
    mutation?: UseMutationOptions<GmailBulkLinkResult, unknown, {
        messageIds: string[];
        tripId: number;
    }>;
}): UseMutationResult<GmailBulkLinkResult, unknown, {
    messageIds: string[];
    tripId: number;
}, unknown>;
export declare function useBulkUnlinkGmailMessages(options?: {
    mutation?: UseMutationOptions<GmailBulkUnlinkResult, unknown, {
        messageIds: string[];
    }>;
}): UseMutationResult<GmailBulkUnlinkResult, unknown, {
    messageIds: string[];
}, unknown>;
export declare const relinkGmailMessagesAfterUndo: (items: {
    messageId: string;
    tripId: number;
}[]) => Promise<void>;
export interface CalendarStatus {
    connected: boolean;
    googleEmail: string | null;
}
export interface CalendarListItem {
    id: string;
    summary: string;
    primary?: boolean;
}
export interface GoogleEventColor {
    id: string;
    name: string;
    hex: string;
}
export declare const getGetCalendarStatusQueryKey: () => readonly ["/api/travels/google-calendar/status"];
export declare function useGetCalendarStatus<TData = CalendarStatus, TError = unknown>(options?: {
    query?: UseQueryOptions<CalendarStatus, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListCalendarsQueryKey: () => readonly ["/api/travels/google-calendar/calendars"];
export declare function useListCalendars<TData = CalendarListItem[], TError = unknown>(options?: {
    query?: UseQueryOptions<CalendarListItem[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useDisconnectCalendar(options?: {
    mutation?: UseMutationOptions<void, unknown, void>;
}): UseMutationResult<void, unknown, void, unknown>;
export declare const getListGoogleEventColorsQueryKey: () => readonly ["/api/travels/google-calendar/colors"];
export declare function useListGoogleEventColors<TData = GoogleEventColor[], TError = unknown>(options?: {
    query?: UseQueryOptions<GoogleEventColor[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export interface ConnectedCalendar {
    id: number;
    userId: number;
    googleCalendarId: string;
    summary: string;
    source: "picked" | "manual";
    primaryColor: string;
    isTravelCalendar: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface ConnectedCalendarInput {
    googleCalendarId: string;
    summary: string;
    source?: "picked" | "manual";
    primaryColor?: string;
}
export declare const getListConnectedCalendarsQueryKey: () => readonly ["/api/travels/connected-calendars"];
export declare function useListConnectedCalendars<TData = ConnectedCalendar[], TError = unknown>(options?: {
    query?: UseQueryOptions<ConnectedCalendar[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useAddConnectedCalendar(options?: {
    mutation?: UseMutationOptions<ConnectedCalendar, unknown, ConnectedCalendarInput>;
}): UseMutationResult<ConnectedCalendar, unknown, ConnectedCalendarInput, unknown>;
export declare function useUpdateConnectedCalendar(options?: {
    mutation?: UseMutationOptions<ConnectedCalendar, unknown, {
        id: number;
        body: {
            primaryColor?: string;
            summary?: string;
        };
    }>;
}): UseMutationResult<ConnectedCalendar, unknown, {
    id: number;
    body: {
        primaryColor?: string;
        summary?: string;
    };
}, unknown>;
export declare function useDeleteConnectedCalendar(options?: {
    mutation?: UseMutationOptions<void, unknown, number>;
}): UseMutationResult<void, unknown, number, unknown>;
export declare function useSetTravelCalendar(options?: {
    mutation?: UseMutationOptions<{
        id: number;
        isTravelCalendar: boolean;
    }, unknown, number>;
}): UseMutationResult<{
    id: number;
    isTravelCalendar: boolean;
}, unknown, number, unknown>;
export declare const getListConnectedCalendarEventsQueryKey: (id: number, start: string, end: string) => readonly ["/api/travels/connected-calendars", number, "events", string, string];
export declare function useListConnectedCalendarEvents<TData = TravelCalendarEvent[], TError = unknown>(id: number, start: string, end: string, options?: {
    query?: UseQueryOptions<TravelCalendarEvent[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useCreateConnectedCalendarEvent(options?: {
    mutation?: UseMutationOptions<TravelCalendarEvent, unknown, {
        id: number;
        body: TravelCalendarEventInput;
    }>;
}): UseMutationResult<TravelCalendarEvent, unknown, {
    id: number;
    body: TravelCalendarEventInput;
}, unknown>;
export interface TravelCalendarStatus {
    configured: boolean;
    calendarSummary: string | null;
    ownerGoogleEmail: string | null;
    isOwner: boolean;
    primaryColor: string | null;
}
export interface TravelCalendarEvent {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    allDay: boolean;
    start: string;
    end: string;
    htmlLink?: string;
    colorId?: string | null;
}
export interface TravelCalendarEventInput {
    title: string;
    description?: string | null;
    location?: string | null;
    allDay: boolean;
    start: string;
    end: string;
    colorId?: string | null;
}
export declare const getGetTravelCalendarStatusQueryKey: () => readonly ["/api/travels/travel-calendar/status"];
export declare function useGetTravelCalendarStatus<TData = TravelCalendarStatus, TError = unknown>(options?: {
    query?: UseQueryOptions<TravelCalendarStatus, TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListTravelCalendarEventsQueryKey: (start: string, end: string) => readonly ["/api/travels/travel-calendar/events", string, string];
export declare function useListTravelCalendarEvents<TData = TravelCalendarEvent[], TError = unknown>(start: string, end: string, options?: {
    query?: UseQueryOptions<TravelCalendarEvent[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useCreateTravelCalendarEvent(options?: {
    mutation?: UseMutationOptions<TravelCalendarEvent, unknown, TravelCalendarEventInput>;
}): UseMutationResult<TravelCalendarEvent, unknown, TravelCalendarEventInput, unknown>;
export declare function useUpdateTravelCalendarEvent(options?: {
    mutation?: UseMutationOptions<TravelCalendarEvent, unknown, {
        eventId: string;
        body: TravelCalendarEventInput;
    }>;
}): UseMutationResult<TravelCalendarEvent, unknown, {
    eventId: string;
    body: TravelCalendarEventInput;
}, unknown>;
export declare function useDeleteTravelCalendarEvent(options?: {
    mutation?: UseMutationOptions<void, unknown, string>;
}): UseMutationResult<void, unknown, string, unknown>;
export interface CalendarTripSuggestion {
    id: number;
    suggestedTitle: string;
    destination: string | null;
    startDate: string | null;
    endDate: string | null;
    relatedEventIds: string[];
    dedupeKey: string;
    status: "pending" | "accepted" | "dismissed";
    createdAt: string;
    updatedAt: string;
}
export declare const getListCalendarTripSuggestionsQueryKey: () => readonly ["/api/travels/calendar-trip-suggestions"];
export declare function useListCalendarTripSuggestions<TData = CalendarTripSuggestion[], TError = unknown>(options?: {
    query?: UseQueryOptions<CalendarTripSuggestion[], TError, TData>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare function useScanCalendarTripSuggestions(options?: {
    mutation?: UseMutationOptions<{
        scanned: number;
        created: number;
    }, unknown, void>;
}): UseMutationResult<{
    scanned: number;
    created: number;
}, unknown, void, unknown>;
export declare function useDismissCalendarTripSuggestion(options?: {
    mutation?: UseMutationOptions<CalendarTripSuggestion, unknown, number>;
}): UseMutationResult<CalendarTripSuggestion, unknown, number, unknown>;
export declare function useAcceptCalendarTripSuggestion(options?: {
    mutation?: UseMutationOptions<Trip, unknown, {
        id: number;
        body?: {
            title?: string;
            destination?: string;
        };
    }>;
}): UseMutationResult<Trip, unknown, {
    id: number;
    body?: {
        title?: string;
        destination?: string;
    };
}, unknown>;
//# sourceMappingURL=travels.d.ts.map