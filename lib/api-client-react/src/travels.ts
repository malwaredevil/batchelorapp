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
// Types
// ---------------------------------------------------------------------------

export type TripStatus =
  | "wishlist"
  | "planning"
  | "booked"
  | "active"
  | "completed";

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
  fields: Array<{ key: string; label: string }> | null;
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
  nextTrip: { id: number; destination: string; startDate: string } | null;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export const generateTripShareToken = (
  id: number,
  options?: RequestInit,
): Promise<{ shareToken: string }> =>
  customFetch<{ shareToken: string }>(`/api/travels/trips/${id}/share`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify({}),
  });

export const revokeTripShareToken = (
  id: number,
  options?: RequestInit,
): Promise<void> =>
  customFetch<void>(`/api/travels/trips/${id}/share`, {
    ...options,
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify({ confirm: true }),
  });

export const listCustomDocumentTypes = (
  options?: RequestInit,
): Promise<CustomDocumentType[]> =>
  customFetch<CustomDocumentType[]>("/api/travels/document-types", {
    ...options,
    method: "GET",
  });

export const createCustomDocumentType = (
  body: {
    typeKey: string;
    typeName: string;
    description?: string;
    iconName?: string;
    colorKey?: string;
    fields?: Array<{ key: string; label: string }>;
  },
  options?: RequestInit,
): Promise<CustomDocumentType> =>
  customFetch<CustomDocumentType>("/api/travels/document-types", {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const suggestDocumentType = (
  body: { typeName: string; description?: string },
  options?: RequestInit,
): Promise<{ iconName: string; colorKey: string; fields: Array<{ key: string; label: string }> }> =>
  customFetch<{ iconName: string; colorKey: string; fields: Array<{ key: string; label: string }> }>(
    "/api/travels/document-types/suggest",
    {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...options?.headers },
      body: JSON.stringify(body),
    },
  );

export const getTripDocumentDownloadUrl = (tripId: number, docId: number) =>
  `/api/travels/trips/${tripId}/documents/${docId}/download`;

export const getTripDocumentWalletPassUrl = (
  tripId: number,
  docId: number,
  options?: RequestInit,
): Promise<{ saveUrl: string }> =>
  customFetch<{ saveUrl: string }>(
    `/api/travels/trips/${tripId}/documents/${docId}/wallet-pass`,
    { ...options, method: "POST" },
  );

// ---------------------------------------------------------------------------
// Google Maps Platform-backed helpers (weather, places, routes, images)
// ---------------------------------------------------------------------------

export interface DailyWeather {
  date: string;
  conditionDescription: string;
  maxTempC: number | null;
  minTempC: number | null;
  precipitationChancePercent: number | null;
}

export const getWeatherForecast = (
  lat: number,
  lng: number,
  options?: RequestInit,
): Promise<{ forecast: DailyWeather[] }> =>
  customFetch<{ forecast: DailyWeather[] }>(
    `/api/travels/maps/weather?lat=${lat}&lng=${lng}`,
    options,
  );

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

export const searchNearbyPlaces = (
  query: string,
  lat?: number,
  lng?: number,
  options?: RequestInit,
): Promise<{ places: MapPlaceResult[] }> => {
  const params = new URLSearchParams({ q: query });
  if (lat != null) params.set("lat", String(lat));
  if (lng != null) params.set("lng", String(lng));
  return customFetch<{ places: MapPlaceResult[] }>(
    `/api/travels/maps/places/search?${params.toString()}`,
    options,
  );
};

export const getStaticMapImageUrl = (
  lat: number,
  lng: number,
  width = 400,
  height = 240,
  zoom = 12,
) => `/api/travels/maps/static-map?lat=${lat}&lng=${lng}&width=${width}&height=${height}&zoom=${zoom}`;

export const getStreetViewImageUrl = (lat: number, lng: number, width = 400, height = 240) =>
  `/api/travels/maps/street-view?lat=${lat}&lng=${lng}&width=${width}&height=${height}`;

export interface RouteInfoResult {
  distanceMeters: number;
  durationSeconds: number;
  optimizedIntermediateWaypointIndex?: number[];
  encodedPolyline?: string;
}

export const computeRouteInfo = (
  body: {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    intermediates?: { lat: number; lng: number }[];
    mode?: "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";
    optimizeWaypoints?: boolean;
  },
  options?: RequestInit,
): Promise<RouteInfoResult> =>
  customFetch<RouteInfoResult>(`/api/travels/maps/route`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export interface TimeZoneResult {
  timeZoneId: string;
  timeZoneName: string;
  rawOffsetSeconds: number;
  dstOffsetSeconds: number;
}

export const getTimeZoneInfo = (
  lat: number,
  lng: number,
  options?: RequestInit,
): Promise<{ timeZone: TimeZoneResult }> =>
  customFetch<{ timeZone: TimeZoneResult }>(
    `/api/travels/maps/timezone?lat=${lat}&lng=${lng}`,
    options,
  );

export interface AirQualityResult {
  aqi: number;
  category: string;
  dominantPollutant: string;
}

export const getAirQualityInfo = (
  lat: number,
  lng: number,
  options?: RequestInit,
): Promise<{ airQuality: AirQualityResult | null }> =>
  customFetch<{ airQuality: AirQualityResult | null }>(
    `/api/travels/maps/air-quality?lat=${lat}&lng=${lng}`,
    options,
  );

export interface PollenResult {
  date: string;
  overallCategory: string;
  types: { code: string; displayName: string; category: string }[];
}

export const getPollenInfo = (
  lat: number,
  lng: number,
  options?: RequestInit,
): Promise<{ pollen: PollenResult | null }> =>
  customFetch<{ pollen: PollenResult | null }>(
    `/api/travels/maps/pollen?lat=${lat}&lng=${lng}`,
    options,
  );

export const getNearbyPlaceCountInfo = (
  lat: number,
  lng: number,
  type: string,
  radiusMeters?: number,
  options?: RequestInit,
): Promise<{ count: number }> => {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng), type });
  if (radiusMeters != null) params.set("radiusMeters", String(radiusMeters));
  return customFetch<{ count: number }>(
    `/api/travels/maps/nearby-count?${params.toString()}`,
    options,
  );
};

export interface AerialViewResult {
  state: "ACTIVE" | "PROCESSING" | "NOT_FOUND";
  videoUrl?: string;
  thumbnailUrl?: string;
}

export const getAerialViewInfo = (
  address: string,
  options?: RequestInit,
): Promise<AerialViewResult> =>
  customFetch<AerialViewResult>(
    `/api/travels/maps/aerial-view?address=${encodeURIComponent(address)}`,
    options,
  );

export const sendTripMessage = (
  tripId: number,
  body: { message: string },
  options?: RequestInit,
): Promise<ChatResponse> =>
  customFetch<ChatResponse>(`/api/travels/trips/${tripId}/chat`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const clearTripChat = (
  tripId: number,
  options?: RequestInit,
): Promise<{ history: ChatMessage[] }> =>
  customFetch<{ history: ChatMessage[] }>(`/api/travels/trips/${tripId}/chat`, {
    ...options,
    method: "DELETE",
  });

// ---------------------------------------------------------------------------
// Query / Mutation Hooks
// ---------------------------------------------------------------------------

export function useGenerateTripShareToken<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<{ shareToken: string }, TError, number, TContext>;
  },
): UseMutationResult<{ shareToken: string }, TError, number, TContext> {
  const mutationFn: MutationFunction<{ shareToken: string }, number> = (id) =>
    generateTripShareToken(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useRevokeTripShareToken<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<void, TError, number, TContext>;
  },
): UseMutationResult<void, TError, number, TContext> {
  const mutationFn: MutationFunction<void, number> = (id) =>
    revokeTripShareToken(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useListCustomDocumentTypes<TError = unknown>(
  options?: { query?: Partial<UseQueryOptions<CustomDocumentType[], TError>> },
): UseQueryResult<CustomDocumentType[], TError> {
  return useQuery({
    queryKey: ["travels", "document-types"],
    queryFn: () => listCustomDocumentTypes(),
    ...options?.query,
  });
}

export function useCreateCustomDocumentType<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      CustomDocumentType,
      TError,
      {
        typeKey: string;
        typeName: string;
        description?: string;
        iconName?: string;
        colorKey?: string;
        fields?: Array<{ key: string; label: string }>;
      },
      TContext
    >;
  },
): UseMutationResult<
  CustomDocumentType,
  TError,
  {
    typeKey: string;
    typeName: string;
    description?: string;
    iconName?: string;
    colorKey?: string;
    fields?: Array<{ key: string; label: string }>;
  },
  TContext
> {
  const mutationFn: MutationFunction<
    CustomDocumentType,
    {
      typeKey: string;
      typeName: string;
      description?: string;
      iconName?: string;
      colorKey?: string;
      fields?: Array<{ key: string; label: string }>;
    }
  > = (body) => createCustomDocumentType(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useSuggestDocumentType<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      { iconName: string; colorKey: string; fields: Array<{ key: string; label: string }> },
      TError,
      { typeName: string; description?: string },
      TContext
    >;
  },
): UseMutationResult<
  { iconName: string; colorKey: string; fields: Array<{ key: string; label: string }> },
  TError,
  { typeName: string; description?: string },
  TContext
> {
  const mutationFn: MutationFunction<
    { iconName: string; colorKey: string; fields: Array<{ key: string; label: string }> },
    { typeName: string; description?: string }
  > = (body) => suggestDocumentType(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useGetTripDocumentWalletPass<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      { saveUrl: string },
      TError,
      { tripId: number; docId: number },
      TContext
    >;
  },
): UseMutationResult<
  { saveUrl: string },
  TError,
  { tripId: number; docId: number },
  TContext
> {
  const mutationFn: MutationFunction<
    { saveUrl: string },
    { tripId: number; docId: number }
  > = ({ tripId, docId }) => getTripDocumentWalletPassUrl(tripId, docId);
  return useMutation({ mutationFn, ...options?.mutation });
}

export const sendTestReminderEmail = (
  options?: RequestInit,
): Promise<{ sent: boolean; to: string }> =>
  customFetch<{ sent: boolean; to: string }>(`/api/travels/settings/test-email`, {
    ...options,
    method: "POST",
  });

export function useSendTestReminderEmail<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      { sent: boolean; to: string },
      TError,
      void,
      TContext
    >;
  },
): UseMutationResult<{ sent: boolean; to: string }, TError, void, TContext> {
  const mutationFn: MutationFunction<{ sent: boolean; to: string }, void> = () =>
    sendTestReminderEmail();
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useSendTripMessage<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      ChatResponse,
      TError,
      { tripId: number; message: string },
      TContext
    >;
  },
): UseMutationResult<ChatResponse, TError, { tripId: number; message: string }, TContext> {
  const mutationFn: MutationFunction<
    ChatResponse,
    { tripId: number; message: string }
  > = ({ tripId, message }) => sendTripMessage(tripId, { message });
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useClearTripChat<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<{ history: ChatMessage[] }, TError, number, TContext>;
  },
): UseMutationResult<{ history: ChatMessage[] }, TError, number, TContext> {
  const mutationFn: MutationFunction<{ history: ChatMessage[] }, number> = (tripId) =>
    clearTripChat(tripId);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export const getListWishlistUrl = () => `/api/travels/wishlist`;
export const listWishlist = (options?: RequestInit): Promise<WishlistItem[]> =>
  customFetch<WishlistItem[]>(getListWishlistUrl(), { ...options, method: "GET" });
export const getListWishlistQueryKey = () => [`/api/travels/wishlist`] as const;

export const createWishlistItem = (
  body: CreateWishlistItemBody,
  options?: RequestInit,
): Promise<WishlistItem> =>
  customFetch<WishlistItem>(getListWishlistUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const updateWishlistItem = (
  id: number,
  body: UpdateWishlistItemBody,
  options?: RequestInit,
): Promise<WishlistItem> =>
  customFetch<WishlistItem>(`/api/travels/wishlist/${id}`, {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const deleteWishlistItem = (id: number, options?: RequestInit): Promise<void> =>
  customFetch<void>(`/api/travels/wishlist/${id}`, { ...options, method: "DELETE" });

export function useListWishlist<
  TData = Awaited<ReturnType<typeof listWishlist>>,
  TError = unknown,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listWishlist>>, TError, TData>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListWishlistQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listWishlist>>> = ({ signal }) =>
    listWishlist({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listWishlist>>,
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

export function useCreateWishlistItem<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<WishlistItem, TError, CreateWishlistItemBody, TContext>;
  },
): UseMutationResult<WishlistItem, TError, CreateWishlistItemBody, TContext> {
  const mutationFn: MutationFunction<WishlistItem, CreateWishlistItemBody> = (body) =>
    createWishlistItem(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useUpdateWishlistItem<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      WishlistItem,
      TError,
      { id: number; body: UpdateWishlistItemBody },
      TContext
    >;
  },
): UseMutationResult<WishlistItem, TError, { id: number; body: UpdateWishlistItemBody }, TContext> {
  const mutationFn: MutationFunction<
    WishlistItem,
    { id: number; body: UpdateWishlistItemBody }
  > = ({ id, body }) => updateWishlistItem(id, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useDeleteWishlistItem<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<void, TError, number, TContext>;
  },
): UseMutationResult<void, TError, number, TContext> {
  const mutationFn: MutationFunction<void, number> = (id) => deleteWishlistItem(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Trip Photos
// ---------------------------------------------------------------------------

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

export const getTripPhotoImageUrl = (tripId: number, photoId: number): string =>
  `/api/travels/trips/${tripId}/photos/${photoId}/image`;

const listTripPhotos = (tripId: number, photoType?: PhotoType, options?: RequestInit): Promise<TripPhoto[]> =>
  customFetch<TripPhoto[]>(
    `/api/travels/trips/${tripId}/photos${photoType ? `?type=${photoType}` : ""}`,
    { ...options, method: "GET" },
  );

export const getListTripPhotosQueryKey = (tripId: number, photoType?: PhotoType) =>
  [`/api/travels/trips/${tripId}/photos`, photoType] as const;

export function useListTripPhotos<TData = TripPhoto[], TError = unknown>(
  tripId: number,
  photoType?: PhotoType,
  options?: { query?: UseQueryOptions<TripPhoto[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListTripPhotosQueryKey(tripId, photoType);
  const queryFn: QueryFunction<TripPhoto[]> = ({ signal }) => listTripPhotos(tripId, photoType, { signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<TripPhoto[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const setTripIconFn = (tripId: number, photoId: number | null, options?: RequestInit): Promise<{ iconPhotoId: number | null }> =>
  customFetch<{ iconPhotoId: number | null }>(`/api/travels/trips/${tripId}/icon`, {
    ...options, method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoId }),
  });

export function useSetTripIcon<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<{ iconPhotoId: number | null }, TError, { tripId: number; photoId: number | null }, TContext> },
): UseMutationResult<{ iconPhotoId: number | null }, TError, { tripId: number; photoId: number | null }, TContext> {
  const mutationFn: MutationFunction<{ iconPhotoId: number | null }, { tripId: number; photoId: number | null }> = ({ tripId, photoId }) =>
    setTripIconFn(tripId, photoId);
  return useMutation({ mutationFn, ...options?.mutation });
}

export const uploadTripPhoto = (tripId: number, formData: FormData): Promise<TripPhoto> =>
  fetch(`/api/travels/trips/${tripId}/photos`, { method: "POST", body: formData, credentials: "include" })
    .then((res) => {
      if (!res.ok) throw new Error("Upload failed");
      return res.json() as Promise<TripPhoto>;
    });

export function useUploadTripPhoto<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<TripPhoto, TError, { tripId: number; formData: FormData }, TContext> },
): UseMutationResult<TripPhoto, TError, { tripId: number; formData: FormData }, TContext> {
  const mutationFn: MutationFunction<TripPhoto, { tripId: number; formData: FormData }> = ({ tripId, formData }) =>
    uploadTripPhoto(tripId, formData);
  return useMutation({ mutationFn, ...options?.mutation });
}

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

export const checkMagnet = (formData: FormData): Promise<MagnetCheckResult> =>
  fetch(`/api/travels/magnets/check`, { method: "POST", body: formData, credentials: "include" })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body as { error?: string } | null)?.error ?? "Check failed");
      }
      return res.json() as Promise<MagnetCheckResult>;
    });

export function useCheckMagnet<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<MagnetCheckResult, TError, FormData, TContext> },
): UseMutationResult<MagnetCheckResult, TError, FormData, TContext> {
  const mutationFn: MutationFunction<MagnetCheckResult, FormData> = (formData) => checkMagnet(formData);
  return useMutation({ mutationFn, ...options?.mutation });
}

const deleteTripPhotoFn = (tripId: number, photoId: number, options?: RequestInit): Promise<void> =>
  customFetch<void>(`/api/travels/trips/${tripId}/photos/${photoId}`, { ...options, method: "DELETE" });

export function useDeleteTripPhoto<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<void, TError, { tripId: number; photoId: number }, TContext> },
): UseMutationResult<void, TError, { tripId: number; photoId: number }, TContext> {
  const mutationFn: MutationFunction<void, { tripId: number; photoId: number }> = ({ tripId, photoId }) =>
    deleteTripPhotoFn(tripId, photoId);
  return useMutation({ mutationFn, ...options?.mutation });
}

const updateTripPhotoFn = (tripId: number, photoId: number, body: UpdatePhotoBody, options?: RequestInit): Promise<TripPhoto> =>
  customFetch<TripPhoto>(`/api/travels/trips/${tripId}/photos/${photoId}`, {
    ...options, method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateTripPhoto<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<TripPhoto, TError, { tripId: number; photoId: number; body: UpdatePhotoBody }, TContext> },
): UseMutationResult<TripPhoto, TError, { tripId: number; photoId: number; body: UpdatePhotoBody }, TContext> {
  const mutationFn: MutationFunction<TripPhoto, { tripId: number; photoId: number; body: UpdatePhotoBody }> = ({ tripId, photoId, body }) =>
    updateTripPhotoFn(tripId, photoId, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

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

const listReminders = (tripId: number, options?: RequestInit): Promise<Reminder[]> =>
  customFetch<Reminder[]>(`/api/travels/trips/${tripId}/reminders`, { ...options, method: "GET" });

export const getListRemindersQueryKey = (tripId: number) =>
  [`/api/travels/trips/${tripId}/reminders`] as const;

export function useListReminders<TData = Reminder[], TError = unknown>(
  tripId: number,
  options?: { query?: UseQueryOptions<Reminder[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListRemindersQueryKey(tripId);
  const queryFn: QueryFunction<Reminder[]> = ({ signal }) => listReminders(tripId, { signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Reminder[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const listAllReminders = (pending: boolean, options?: RequestInit): Promise<Reminder[]> =>
  customFetch<Reminder[]>(`/api/travels/reminders${pending ? "?pending=true" : ""}`, { ...options, method: "GET" });

export const getListAllRemindersQueryKey = (pending = false) =>
  [`/api/travels/reminders`, { pending }] as const;

export function useListAllReminders<TData = Reminder[], TError = unknown>(
  pending = false,
  options?: { query?: UseQueryOptions<Reminder[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListAllRemindersQueryKey(pending);
  const queryFn: QueryFunction<Reminder[]> = ({ signal }) => listAllReminders(pending, { signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Reminder[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const createReminderFn = (tripId: number, body: CreateReminderBody, options?: RequestInit): Promise<Reminder> =>
  customFetch<Reminder>(`/api/travels/trips/${tripId}/reminders`, {
    ...options, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useCreateReminder<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Reminder, TError, { tripId: number; body: CreateReminderBody }, TContext> },
): UseMutationResult<Reminder, TError, { tripId: number; body: CreateReminderBody }, TContext> {
  const mutationFn: MutationFunction<Reminder, { tripId: number; body: CreateReminderBody }> = ({ tripId, body }) =>
    createReminderFn(tripId, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const updateReminderFn = (tripId: number, reminderId: number, body: UpdateReminderBody, options?: RequestInit): Promise<Reminder> =>
  customFetch<Reminder>(`/api/travels/trips/${tripId}/reminders/${reminderId}`, {
    ...options, method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateReminder<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Reminder, TError, { tripId: number; reminderId: number; body: UpdateReminderBody }, TContext> },
): UseMutationResult<Reminder, TError, { tripId: number; reminderId: number; body: UpdateReminderBody }, TContext> {
  const mutationFn: MutationFunction<Reminder, { tripId: number; reminderId: number; body: UpdateReminderBody }> = ({ tripId, reminderId, body }) =>
    updateReminderFn(tripId, reminderId, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const deleteReminderFn = (tripId: number, reminderId: number, options?: RequestInit): Promise<void> =>
  customFetch<void>(`/api/travels/trips/${tripId}/reminders/${reminderId}`, { ...options, method: "DELETE" });

export function useDeleteReminder<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<void, TError, { tripId: number; reminderId: number }, TContext> },
): UseMutationResult<void, TError, { tripId: number; reminderId: number }, TContext> {
  const mutationFn: MutationFunction<void, { tripId: number; reminderId: number }> = ({ tripId, reminderId }) =>
    deleteReminderFn(tripId, reminderId);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Trip Detail card layout (per-user reorder + collapse)
// ---------------------------------------------------------------------------

export interface CardLayoutPreference {
  cardOrder: string[];
}

const getCardLayout = (options?: RequestInit): Promise<CardLayoutPreference> =>
  customFetch<CardLayoutPreference>(`/api/travels/card-layout`, { ...options, method: "GET" });

export const getGetCardLayoutQueryKey = () => [`/api/travels/card-layout`] as const;

export function useGetCardLayout<TData = CardLayoutPreference, TError = unknown>(
  options?: { query?: UseQueryOptions<CardLayoutPreference, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetCardLayoutQueryKey();
  const queryFn: QueryFunction<CardLayoutPreference> = ({ signal }) => getCardLayout({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<CardLayoutPreference, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const updateCardLayoutFn = (cardOrder: string[], options?: RequestInit): Promise<CardLayoutPreference> =>
  customFetch<CardLayoutPreference>(`/api/travels/card-layout`, {
    ...options, method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardOrder }),
  });

export function useUpdateCardLayout<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<CardLayoutPreference, TError, { cardOrder: string[] }, TContext> },
): UseMutationResult<CardLayoutPreference, TError, { cardOrder: string[] }, TContext> {
  const mutationFn: MutationFunction<CardLayoutPreference, { cardOrder: string[] }> = ({ cardOrder }) =>
    updateCardLayoutFn(cardOrder);
  return useMutation({ mutationFn, ...options?.mutation });
}

export interface TripCardCollapseState {
  collapsedCards: string[];
}

const getTripCardCollapse = (tripId: number, options?: RequestInit): Promise<TripCardCollapseState> =>
  customFetch<TripCardCollapseState>(`/api/travels/trips/${tripId}/card-collapse`, { ...options, method: "GET" });

export const getGetTripCardCollapseQueryKey = (tripId: number) =>
  [`/api/travels/trips/${tripId}/card-collapse`] as const;

export function useGetTripCardCollapse<TData = TripCardCollapseState, TError = unknown>(
  tripId: number,
  options?: { query?: UseQueryOptions<TripCardCollapseState, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetTripCardCollapseQueryKey(tripId);
  const queryFn: QueryFunction<TripCardCollapseState> = ({ signal }) => getTripCardCollapse(tripId, { signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<TripCardCollapseState, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const updateTripCardCollapseFn = (tripId: number, collapsedCards: string[], options?: RequestInit): Promise<TripCardCollapseState> =>
  customFetch<TripCardCollapseState>(`/api/travels/trips/${tripId}/card-collapse`, {
    ...options, method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collapsedCards }),
  });

export function useUpdateTripCardCollapse<TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<TripCardCollapseState, TError, { tripId: number; collapsedCards: string[] }, TContext> },
): UseMutationResult<TripCardCollapseState, TError, { tripId: number; collapsedCards: string[] }, TContext> {
  const mutationFn: MutationFunction<TripCardCollapseState, { tripId: number; collapsedCards: string[] }> = ({ tripId, collapsedCards }) =>
    updateTripCardCollapseFn(tripId, collapsedCards);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Destinations (grouped timeline)
// ---------------------------------------------------------------------------

export interface DestinationGroup {
  destination: string;
  lat?: number | null;
  lng?: number | null;
  trips: Trip[];
}

const listDestinations = (options?: RequestInit): Promise<DestinationGroup[]> =>
  customFetch<DestinationGroup[]>("/api/travels/destinations", { ...options, method: "GET" });

export const getListDestinationsQueryKey = () => [`/api/travels/destinations`] as const;

export function useListDestinations<TData = DestinationGroup[], TError = unknown>(
  options?: { query?: UseQueryOptions<DestinationGroup[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListDestinationsQueryKey();
  const queryFn: QueryFunction<DestinationGroup[]> = ({ signal }) => listDestinations({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<DestinationGroup[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

// ---------------------------------------------------------------------------
// Highlights (one-thing autocomplete)
// ---------------------------------------------------------------------------

export const getHighlightsUrl = () => `/api/travels/highlights`;
export const getHighlights = (options?: RequestInit): Promise<string[]> =>
  customFetch<string[]>(getHighlightsUrl(), { ...options, method: "GET" });
export const getGetHighlightsQueryKey = () => [`/api/travels/highlights`] as const;

export function useGetHighlights<
  TData = Awaited<ReturnType<typeof getHighlights>>,
  TError = unknown,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getHighlights>>, TError, TData>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetHighlightsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getHighlights>>> = ({ signal }) =>
    getHighlights({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getHighlights>>,
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

// ---------------------------------------------------------------------------
// App users (for picking reminder recipients)
// ---------------------------------------------------------------------------

export interface TravelsAppUser {
  id: number;
  email: string;
  displayName: string | null;
  phoneVerified: boolean;
}

const listTravelsAppUsers = (options?: RequestInit): Promise<TravelsAppUser[]> =>
  customFetch<TravelsAppUser[]>("/api/travels/users", { ...options, method: "GET" });

export const getListTravelsAppUsersQueryKey = () => [`/api/travels/users`] as const;

export function useListTravelsAppUsers<TData = TravelsAppUser[], TError = unknown>(
  options?: { query?: UseQueryOptions<TravelsAppUser[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListTravelsAppUsersQueryKey();
  const queryFn: QueryFunction<TravelsAppUser[]> = ({ signal }) => listTravelsAppUsers({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<TravelsAppUser[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

// ---------------------------------------------------------------------------
// Travels Settings (reminder email)
// ---------------------------------------------------------------------------

export interface TravelsSettings {
  reminderEmail: string | null;
  timezone: string | null;
}

const getTravelsSettings = (options?: RequestInit): Promise<TravelsSettings> =>
  customFetch<TravelsSettings>("/api/travels/settings", { ...options, method: "GET" });

export const getGetTravelsSettingsQueryKey = () => [`/api/travels/settings`] as const;

export function useGetTravelsSettings<TData = TravelsSettings, TError = unknown>(
  options?: { query?: UseQueryOptions<TravelsSettings, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetTravelsSettingsQueryKey();
  const queryFn: QueryFunction<TravelsSettings> = ({ signal }) => getTravelsSettings({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<TravelsSettings, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const putTravelsSettingsFn = (body: { reminderEmail: string | null }): Promise<TravelsSettings> =>
  customFetch<TravelsSettings>("/api/travels/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateTravelsSettings(
  options?: { mutation?: UseMutationOptions<TravelsSettings, unknown, { reminderEmail: string | null }> },
) {
  const mutationFn = (body: { reminderEmail: string | null }) => putTravelsSettingsFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const putTravelsTimezoneFn = (body: { timezone: string | null }): Promise<{ timezone: string | null }> =>
  customFetch<{ timezone: string | null }>("/api/travels/settings/timezone", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateTravelsTimezone(
  options?: { mutation?: UseMutationOptions<{ timezone: string | null }, unknown, { timezone: string | null }> },
) {
  const mutationFn = (body: { timezone: string | null }) => putTravelsTimezoneFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Gmail auto-scan + manual mode
// ---------------------------------------------------------------------------

export interface GmailStatus {
  connected: boolean;
  googleEmail: string | null;
  lastScanAt: string | null;
}

const getGmailStatus = (options?: RequestInit): Promise<GmailStatus> =>
  customFetch<GmailStatus>("/api/travels/gmail/status", { ...options, method: "GET" });

export const getGetGmailStatusQueryKey = () => [`/api/travels/gmail/status`] as const;

export function useGetGmailStatus<TData = GmailStatus, TError = unknown>(
  options?: { query?: UseQueryOptions<GmailStatus, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetGmailStatusQueryKey();
  const queryFn: QueryFunction<GmailStatus> = ({ signal }) => getGmailStatus({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<GmailStatus, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const disconnectGmailFn = (): Promise<void> =>
  customFetch<void>("/api/travels/gmail/disconnect", { method: "DELETE" });

export function useDisconnectGmail(options?: { mutation?: UseMutationOptions<void, unknown, void> }) {
  const mutationFn: MutationFunction<void, void> = () => disconnectGmailFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

export interface GmailScanResult {
  scanned: number;
  suggested: number;
  ignored: number;
}

const postGmailScanFn = (): Promise<GmailScanResult> =>
  customFetch<GmailScanResult>("/api/travels/gmail/scan", { method: "POST" });

export function useScanGmail(options?: { mutation?: UseMutationOptions<GmailScanResult, unknown, void> }) {
  const mutationFn: MutationFunction<GmailScanResult, void> = () => postGmailScanFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

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

const getGmailSuggestions = (options?: RequestInit): Promise<GmailScanDecision[]> =>
  customFetch<GmailScanDecision[]>("/api/travels/gmail/suggestions", { ...options, method: "GET" });

export const getGetGmailSuggestionsQueryKey = () => [`/api/travels/gmail/suggestions`] as const;

export function useGetGmailSuggestions<TData = GmailScanDecision[], TError = unknown>(
  options?: { query?: UseQueryOptions<GmailScanDecision[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetGmailSuggestionsQueryKey();
  const queryFn: QueryFunction<GmailScanDecision[]> = ({ signal }) => getGmailSuggestions({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<GmailScanDecision[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const dismissGmailSuggestionFn = (id: number): Promise<GmailScanDecision> =>
  customFetch<GmailScanDecision>(`/api/travels/gmail/suggestions/${id}/dismiss`, { method: "POST" });

export function useDismissGmailSuggestion(
  options?: { mutation?: UseMutationOptions<GmailScanDecision, unknown, number> },
) {
  const mutationFn: MutationFunction<GmailScanDecision, number> = (id) => dismissGmailSuggestionFn(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

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

const getGmailInbox = (
  params: { q?: string; pageToken?: string; maxResults?: number },
  options?: RequestInit,
): Promise<GmailInboxPage> => {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.pageToken) search.set("pageToken", params.pageToken);
  if (params.maxResults) search.set("maxResults", String(params.maxResults));
  const qs = search.toString();
  return customFetch<GmailInboxPage>(`/api/travels/gmail/inbox${qs ? `?${qs}` : ""}`, {
    ...options,
    method: "GET",
  });
};

export const getGetGmailInboxQueryKey = (params: { q?: string; pageToken?: string; maxResults?: number }) =>
  [`/api/travels/gmail/inbox`, params] as const;

export function useGetGmailInbox<TData = GmailInboxPage, TError = unknown>(
  params: { q?: string; pageToken?: string; maxResults?: number },
  options?: { query?: UseQueryOptions<GmailInboxPage, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetGmailInboxQueryKey(params);
  const queryFn: QueryFunction<GmailInboxPage> = ({ signal }) => getGmailInbox(params, { signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<GmailInboxPage, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

export interface LinkGmailMessageBody {
  tripId: number;
  /** When provided, only these attachment IDs are processed. */
  attachmentIds?: string[];
  /** When true, the email body text is also saved as a document. */
  includeEmailBody?: boolean;
  /** Per-item title overrides: keys are attachmentId or "body". */
  titles?: Record<string, string>;
}

const linkGmailMessageFn = (messageId: string, body: LinkGmailMessageBody): Promise<unknown> =>
  customFetch(`/api/travels/gmail/messages/${messageId}/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useLinkGmailMessage(
  options?: {
    mutation?: UseMutationOptions<unknown, unknown, { messageId: string } & LinkGmailMessageBody>;
  },
) {
  const mutationFn: MutationFunction<unknown, { messageId: string } & LinkGmailMessageBody> = ({
    messageId,
    ...body
  }) => linkGmailMessageFn(messageId, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const ignoreGmailMessageFn = (messageId: string): Promise<void> =>
  customFetch<void>(`/api/travels/gmail/messages/${messageId}/ignore`, { method: "POST" });

export function useIgnoreGmailMessage(
  options?: { mutation?: UseMutationOptions<void, unknown, string> },
) {
  const mutationFn: MutationFunction<void, string> = (messageId) => ignoreGmailMessageFn(messageId);
  return useMutation({ mutationFn, ...options?.mutation });
}

const reconsiderGmailMessageFn = (messageId: string): Promise<void> =>
  customFetch<void>(`/api/travels/gmail/messages/${messageId}/reconsider`, { method: "POST" });

export function useReconsiderGmailMessage(
  options?: { mutation?: UseMutationOptions<void, unknown, string> },
) {
  const mutationFn: MutationFunction<void, string> = (messageId) => reconsiderGmailMessageFn(messageId);
  return useMutation({ mutationFn, ...options?.mutation });
}

const unlinkGmailMessageFn = (messageId: string): Promise<void> =>
  customFetch<void>(`/api/travels/gmail/messages/${messageId}/unlink`, { method: "POST" });

export function useUnlinkGmailMessage(
  options?: { mutation?: UseMutationOptions<void, unknown, string> },
) {
  const mutationFn: MutationFunction<void, string> = (messageId) => unlinkGmailMessageFn(messageId);
  return useMutation({ mutationFn, ...options?.mutation });
}

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

const getGmailMessage = (messageId: string, options?: RequestInit): Promise<GmailMessageContent> =>
  customFetch<GmailMessageContent>(`/api/travels/gmail/messages/${messageId}`, {
    ...options,
    method: "GET",
  });

export const getGetGmailMessageQueryKey = (messageId: string) =>
  [`/api/travels/gmail/messages/${messageId}`] as const;

export function useGetGmailMessage<TData = GmailMessageContent, TError = unknown>(
  messageId: string,
  options?: { query?: UseQueryOptions<GmailMessageContent, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetGmailMessageQueryKey(messageId);
  const queryFn: QueryFunction<GmailMessageContent> = ({ signal }) =>
    getGmailMessage(messageId, { signal });
  const queryOpts = {
    queryKey,
    queryFn,
    enabled: !!messageId,
    ...queryOptions,
  } as UseQueryOptions<GmailMessageContent, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

export interface GmailBulkLinkResult {
  results: { messageId: string; status: "linked" | "already_linked" | "failed"; error?: string }[];
}

export interface GmailBulkUnlinkResult {
  results: { messageId: string; status: "unlinked" | "not_linked" | "failed"; tripId: number | null }[];
}

const bulkLinkGmailMessagesFn = (body: {
  messageIds: string[];
  tripId: number;
}): Promise<GmailBulkLinkResult> =>
  customFetch<GmailBulkLinkResult>(`/api/travels/gmail/messages/bulk-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useBulkLinkGmailMessages(
  options?: {
    mutation?: UseMutationOptions<
      GmailBulkLinkResult,
      unknown,
      { messageIds: string[]; tripId: number }
    >;
  },
) {
  const mutationFn: MutationFunction<
    GmailBulkLinkResult,
    { messageIds: string[]; tripId: number }
  > = (body) => bulkLinkGmailMessagesFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const bulkUnlinkGmailMessagesFn = (body: {
  messageIds: string[];
}): Promise<GmailBulkUnlinkResult> =>
  customFetch<GmailBulkUnlinkResult>(
    `/api/travels/gmail/messages/bulk-unlink`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

export function useBulkUnlinkGmailMessages(
  options?: {
    mutation?: UseMutationOptions<
      GmailBulkUnlinkResult,
      unknown,
      { messageIds: string[] }
    >;
  },
) {
  const mutationFn: MutationFunction<
    GmailBulkUnlinkResult,
    { messageIds: string[] }
  > = (body) => bulkUnlinkGmailMessagesFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

// Helper used by the undo-bulk-unlink flow: re-links a set of emails back to
// their original trips. Groups by tripId and calls bulk-link once per trip so
// the AI extraction runs on a proper trip context.
export const relinkGmailMessagesAfterUndo = (
  items: { messageId: string; tripId: number }[],
): Promise<void> => {
  const byTrip = new Map<number, string[]>();
  for (const { messageId, tripId } of items) {
    if (!byTrip.has(tripId)) byTrip.set(tripId, []);
    byTrip.get(tripId)!.push(messageId);
  }
  return Promise.all(
    [...byTrip.entries()].map(([tripId, messageIds]) =>
      bulkLinkGmailMessagesFn({ messageIds, tripId }),
    ),
  ).then(() => undefined);
};

// ---------------------------------------------------------------------------
// Google Calendar OAuth (per-user account connection)
// ---------------------------------------------------------------------------

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

const getCalendarStatus = (options?: RequestInit): Promise<CalendarStatus> =>
  customFetch<CalendarStatus>("/api/travels/google-calendar/status", { ...options, method: "GET" });

export const getGetCalendarStatusQueryKey = () => [`/api/travels/google-calendar/status`] as const;

export function useGetCalendarStatus<TData = CalendarStatus, TError = unknown>(
  options?: { query?: UseQueryOptions<CalendarStatus, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetCalendarStatusQueryKey();
  const queryFn: QueryFunction<CalendarStatus> = ({ signal }) => getCalendarStatus({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<CalendarStatus, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const listCalendars = (options?: RequestInit): Promise<CalendarListItem[]> =>
  customFetch<CalendarListItem[]>("/api/travels/google-calendar/calendars", { ...options, method: "GET" });

export const getListCalendarsQueryKey = () => [`/api/travels/google-calendar/calendars`] as const;

export function useListCalendars<TData = CalendarListItem[], TError = unknown>(
  options?: { query?: UseQueryOptions<CalendarListItem[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListCalendarsQueryKey();
  const queryFn: QueryFunction<CalendarListItem[]> = ({ signal }) => listCalendars({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<CalendarListItem[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const deleteCalendarConnectionFn = (): Promise<void> =>
  customFetch<void>("/api/travels/google-calendar/disconnect", { method: "DELETE" });

export function useDisconnectCalendar(
  options?: { mutation?: UseMutationOptions<void, unknown, void> },
) {
  const mutationFn = () => deleteCalendarConnectionFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

const listGoogleEventColors = (options?: RequestInit): Promise<GoogleEventColor[]> =>
  customFetch<GoogleEventColor[]>("/api/travels/google-calendar/colors", {
    ...options,
    method: "GET",
  });

export const getListGoogleEventColorsQueryKey = () => [`/api/travels/google-calendar/colors`] as const;

export function useListGoogleEventColors<TData = GoogleEventColor[], TError = unknown>(
  options?: { query?: UseQueryOptions<GoogleEventColor[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListGoogleEventColorsQueryKey();
  const queryFn: QueryFunction<GoogleEventColor[]> = ({ signal }) => listGoogleEventColors({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<GoogleEventColor[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

// ---------------------------------------------------------------------------
// Connected calendars (unlimited per-user Google calendars, each with a
// user-chosen overlay color; exactly one may be the shared "Travel" calendar)
// ---------------------------------------------------------------------------

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

const listConnectedCalendars = (options?: RequestInit): Promise<ConnectedCalendar[]> =>
  customFetch<ConnectedCalendar[]>("/api/travels/connected-calendars", { ...options, method: "GET" });

export const getListConnectedCalendarsQueryKey = () => [`/api/travels/connected-calendars`] as const;

export function useListConnectedCalendars<TData = ConnectedCalendar[], TError = unknown>(
  options?: { query?: UseQueryOptions<ConnectedCalendar[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListConnectedCalendarsQueryKey();
  const queryFn: QueryFunction<ConnectedCalendar[]> = ({ signal }) => listConnectedCalendars({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<ConnectedCalendar[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const postConnectedCalendarFn = (body: ConnectedCalendarInput): Promise<ConnectedCalendar> =>
  customFetch<ConnectedCalendar>("/api/travels/connected-calendars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useAddConnectedCalendar(
  options?: { mutation?: UseMutationOptions<ConnectedCalendar, unknown, ConnectedCalendarInput> },
) {
  const mutationFn = (body: ConnectedCalendarInput) => postConnectedCalendarFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const patchConnectedCalendarFn = (
  id: number,
  body: { primaryColor?: string; summary?: string },
): Promise<ConnectedCalendar> =>
  customFetch<ConnectedCalendar>(`/api/travels/connected-calendars/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateConnectedCalendar(
  options?: {
    mutation?: UseMutationOptions<
      ConnectedCalendar,
      unknown,
      { id: number; body: { primaryColor?: string; summary?: string } }
    >;
  },
) {
  const mutationFn = ({ id, body }: { id: number; body: { primaryColor?: string; summary?: string } }) =>
    patchConnectedCalendarFn(id, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const deleteConnectedCalendarFn = (id: number): Promise<void> =>
  customFetch<void>(`/api/travels/connected-calendars/${id}`, { method: "DELETE" });

export function useDeleteConnectedCalendar(
  options?: { mutation?: UseMutationOptions<void, unknown, number> },
) {
  const mutationFn = (id: number) => deleteConnectedCalendarFn(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

const putConnectedCalendarAsTravelFn = (id: number): Promise<{ id: number; isTravelCalendar: boolean }> =>
  customFetch<{ id: number; isTravelCalendar: boolean }>(`/api/travels/connected-calendars/${id}/travel`, {
    method: "PUT",
  });

export function useSetTravelCalendar(
  options?: { mutation?: UseMutationOptions<{ id: number; isTravelCalendar: boolean }, unknown, number> },
) {
  const mutationFn = (id: number) => putConnectedCalendarAsTravelFn(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

const listConnectedCalendarEvents = (
  id: number,
  start: string,
  end: string,
  options?: RequestInit,
): Promise<TravelCalendarEvent[]> =>
  customFetch<TravelCalendarEvent[]>(
    `/api/travels/connected-calendars/${id}/events?${new URLSearchParams({ start, end }).toString()}`,
    { ...options, method: "GET" },
  );

export const getListConnectedCalendarEventsQueryKey = (id: number, start: string, end: string) =>
  [`/api/travels/connected-calendars`, id, `events`, start, end] as const;

export function useListConnectedCalendarEvents<TData = TravelCalendarEvent[], TError = unknown>(
  id: number,
  start: string,
  end: string,
  options?: { query?: UseQueryOptions<TravelCalendarEvent[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListConnectedCalendarEventsQueryKey(id, start, end);
  const queryFn: QueryFunction<TravelCalendarEvent[]> = ({ signal }) =>
    listConnectedCalendarEvents(id, start, end, { signal });
  const queryOpts = {
    queryKey,
    queryFn,
    enabled: Boolean(id && start && end),
    ...queryOptions,
  } as UseQueryOptions<TravelCalendarEvent[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const postConnectedCalendarEventFn = (
  id: number,
  body: TravelCalendarEventInput,
): Promise<TravelCalendarEvent> =>
  customFetch<TravelCalendarEvent>(`/api/travels/connected-calendars/${id}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useCreateConnectedCalendarEvent(
  options?: {
    mutation?: UseMutationOptions<
      TravelCalendarEvent,
      unknown,
      { id: number; body: TravelCalendarEventInput }
    >;
  },
) {
  const mutationFn = ({ id, body }: { id: number; body: TravelCalendarEventInput }) =>
    postConnectedCalendarEventFn(id, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// Travel Calendar (shared, owner-assignable calendar — view/add/edit/delete
// events; every app_user may act on it, not just the owner)
// ---------------------------------------------------------------------------

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

const getTravelCalendarStatus = (options?: RequestInit): Promise<TravelCalendarStatus> =>
  customFetch<TravelCalendarStatus>("/api/travels/travel-calendar/status", { ...options, method: "GET" });

export const getGetTravelCalendarStatusQueryKey = () => [`/api/travels/travel-calendar/status`] as const;

export function useGetTravelCalendarStatus<TData = TravelCalendarStatus, TError = unknown>(
  options?: { query?: UseQueryOptions<TravelCalendarStatus, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetTravelCalendarStatusQueryKey();
  const queryFn: QueryFunction<TravelCalendarStatus> = ({ signal }) => getTravelCalendarStatus({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<TravelCalendarStatus, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const listTravelCalendarEvents = (
  start: string,
  end: string,
  options?: RequestInit,
): Promise<TravelCalendarEvent[]> =>
  customFetch<TravelCalendarEvent[]>(
    `/api/travels/travel-calendar/events?${new URLSearchParams({ start, end }).toString()}`,
    { ...options, method: "GET" },
  );

export const getListTravelCalendarEventsQueryKey = (start: string, end: string) =>
  [`/api/travels/travel-calendar/events`, start, end] as const;

export function useListTravelCalendarEvents<TData = TravelCalendarEvent[], TError = unknown>(
  start: string,
  end: string,
  options?: { query?: UseQueryOptions<TravelCalendarEvent[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListTravelCalendarEventsQueryKey(start, end);
  const queryFn: QueryFunction<TravelCalendarEvent[]> = ({ signal }) =>
    listTravelCalendarEvents(start, end, { signal });
  const queryOpts = {
    queryKey,
    queryFn,
    enabled: Boolean(start && end),
    ...queryOptions,
  } as UseQueryOptions<TravelCalendarEvent[], TError, TData> & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const postTravelCalendarEventFn = (body: TravelCalendarEventInput): Promise<TravelCalendarEvent> =>
  customFetch<TravelCalendarEvent>("/api/travels/travel-calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useCreateTravelCalendarEvent(
  options?: { mutation?: UseMutationOptions<TravelCalendarEvent, unknown, TravelCalendarEventInput> },
) {
  const mutationFn = (body: TravelCalendarEventInput) => postTravelCalendarEventFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const patchTravelCalendarEventFn = (
  eventId: string,
  body: TravelCalendarEventInput,
): Promise<TravelCalendarEvent> =>
  customFetch<TravelCalendarEvent>(
    `/api/travels/travel-calendar/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

export function useUpdateTravelCalendarEvent(
  options?: {
    mutation?: UseMutationOptions<
      TravelCalendarEvent,
      unknown,
      { eventId: string; body: TravelCalendarEventInput }
    >;
  },
) {
  const mutationFn = ({ eventId, body }: { eventId: string; body: TravelCalendarEventInput }) =>
    patchTravelCalendarEventFn(eventId, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const deleteTravelCalendarEventFn = (eventId: string): Promise<void> =>
  customFetch<void>(`/api/travels/travel-calendar/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });

export function useDeleteTravelCalendarEvent(
  options?: { mutation?: UseMutationOptions<void, unknown, string> },
) {
  const mutationFn = (eventId: string) => deleteTravelCalendarEventFn(eventId);
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// AI-detected trip suggestions from every connected calendar
// ---------------------------------------------------------------------------

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

const listCalendarTripSuggestions = (
  options?: RequestInit,
): Promise<CalendarTripSuggestion[]> =>
  customFetch<CalendarTripSuggestion[]>("/api/travels/calendar-trip-suggestions", {
    ...options,
    method: "GET",
  });

export const getListCalendarTripSuggestionsQueryKey = () =>
  [`/api/travels/calendar-trip-suggestions`] as const;

export function useListCalendarTripSuggestions<
  TData = CalendarTripSuggestion[],
  TError = unknown,
>(
  options?: { query?: UseQueryOptions<CalendarTripSuggestion[], TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListCalendarTripSuggestionsQueryKey();
  const queryFn: QueryFunction<CalendarTripSuggestion[]> = ({ signal }) =>
    listCalendarTripSuggestions({ signal });
  const queryOpts = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    CalendarTripSuggestion[],
    TError,
    TData
  > & { queryKey: QueryKey };
  const query = useQuery(queryOpts) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOpts.queryKey };
}

const postScanCalendarTripSuggestionsFn = (): Promise<{ scanned: number; created: number }> =>
  customFetch<{ scanned: number; created: number }>(
    "/api/travels/calendar-trip-suggestions/scan",
    { method: "POST" },
  );

export function useScanCalendarTripSuggestions(
  options?: { mutation?: UseMutationOptions<{ scanned: number; created: number }, unknown, void> },
) {
  const mutationFn = () => postScanCalendarTripSuggestionsFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

const postDismissCalendarTripSuggestionFn = (id: number): Promise<CalendarTripSuggestion> =>
  customFetch<CalendarTripSuggestion>(
    `/api/travels/calendar-trip-suggestions/${id}/dismiss`,
    { method: "POST" },
  );

export function useDismissCalendarTripSuggestion(
  options?: { mutation?: UseMutationOptions<CalendarTripSuggestion, unknown, number> },
) {
  const mutationFn = (id: number) => postDismissCalendarTripSuggestionFn(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

const postAcceptCalendarTripSuggestionFn = (
  id: number,
  body?: { title?: string; destination?: string },
): Promise<Trip> =>
  customFetch<Trip>(`/api/travels/calendar-trip-suggestions/${id}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export function useAcceptCalendarTripSuggestion(
  options?: {
    mutation?: UseMutationOptions<
      Trip,
      unknown,
      { id: number; body?: { title?: string; destination?: string } }
    >;
  },
) {
  const mutationFn = ({
    id,
    body,
  }: {
    id: number;
    body?: { title?: string; destination?: string };
  }) => postAcceptCalendarTripSuggestionFn(id, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

