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
  createdAt: string;
}

export interface TripDocument {
  id: number;
  tripId: number;
  userId: number;
  storagePath: string;
  documentType?: string | null;
  originalFilename?: string | null;
  extractedData?: Record<string, unknown> | null;
  lockedFields?: string[];
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
      timezone?: string;
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

export const getListTripsUrl = () => `/api/travels/trips`;
export const listTrips = (options?: RequestInit): Promise<Trip[]> =>
  customFetch<Trip[]>(getListTripsUrl(), { ...options, method: "GET" });
export const getListTripsQueryKey = () => [`/api/travels/trips`] as const;

export const getTripUrl = (id: number) => `/api/travels/trips/${id}`;
export const getTrip = (id: number, options?: RequestInit): Promise<TripDetail> =>
  customFetch<TripDetail>(getTripUrl(id), { ...options, method: "GET" });
export const getGetTripQueryKey = (id: number) =>
  [`/api/travels/trips/${id}`] as const;

export const createTrip = (body: CreateTripBody, options?: RequestInit): Promise<Trip> =>
  customFetch<Trip>(getListTripsUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const updateTrip = (
  id: number,
  body: UpdateTripBody,
  options?: RequestInit,
): Promise<Trip> =>
  customFetch<Trip>(getTripUrl(id), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const deleteTrip = (id: number, options?: RequestInit): Promise<void> =>
  customFetch<void>(getTripUrl(id), { ...options, method: "DELETE" });

export const generateItinerary = (
  id: number,
  body: GenerateItineraryBody,
  options?: RequestInit,
): Promise<ItineraryResult> =>
  customFetch<ItineraryResult>(`/api/travels/trips/${id}/itinerary`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const listTripDocuments = (id: number, options?: RequestInit): Promise<TripDocument[]> =>
  customFetch<TripDocument[]>(`/api/travels/trips/${id}/documents`, {
    ...options,
    method: "GET",
  });

export const deleteTripDocument = (
  tripId: number,
  docId: number,
  options?: RequestInit,
): Promise<void> =>
  customFetch<void>(`/api/travels/trips/${tripId}/documents/${docId}`, {
    ...options,
    method: "DELETE",
  });

export const updateTripDocument = (
  tripId: number,
  docId: number,
  body: { extractedData?: Record<string, unknown>; lockedFields?: string[] },
  options?: RequestInit,
): Promise<TripDocument> =>
  customFetch<TripDocument>(`/api/travels/trips/${tripId}/documents/${docId}`, {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const rescanTripDocument = (
  tripId: number,
  docId: number,
  options?: RequestInit,
): Promise<TripDocument> =>
  customFetch<TripDocument>(
    `/api/travels/trips/${tripId}/documents/${docId}/rescan`,
    {
      ...options,
      method: "POST",
    },
  );

export const getTripDocumentDownloadUrl = (tripId: number, docId: number) =>
  `/api/travels/trips/${tripId}/documents/${docId}/download`;

export const exploreDestination = (
  body: ExploreDestinationBody,
  options?: RequestInit,
): Promise<ExploreDestinationResult> =>
  customFetch<ExploreDestinationResult>(`/api/travels/explore`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

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

export const getTravelsStatsUrl = () => `/api/travels/stats`;
export const getTravelsStats = (options?: RequestInit): Promise<TravelsStats> =>
  customFetch<TravelsStats>(getTravelsStatsUrl(), { ...options, method: "GET" });
export const getGetTravelsStatsQueryKey = () => [`/api/travels/stats`] as const;

// ---------------------------------------------------------------------------
// Query / Mutation Hooks
// ---------------------------------------------------------------------------

export const getListTripsQueryOptions = <
  TData = Awaited<ReturnType<typeof listTrips>>,
  TError = unknown,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTrips>>, TError, TData>;
  },
) => {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListTripsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listTrips>>> = ({
    signal,
  }) => listTrips({ signal });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listTrips>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export function useListTrips<
  TData = Awaited<ReturnType<typeof listTrips>>,
  TError = unknown,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTrips>>, TError, TData>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListTripsQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOptions.queryKey };
}

export const getGetTripQueryOptions = <
  TData = Awaited<ReturnType<typeof getTrip>>,
  TError = unknown,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrip>>, TError, TData>;
  },
) => {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetTripQueryKey(id);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getTrip>>> = ({
    signal,
  }) => getTrip(id, { signal });
  return {
    queryKey,
    queryFn,
    enabled: !!id,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof getTrip>>, TError, TData> & {
    queryKey: QueryKey;
  };
};

export function useGetTrip<
  TData = Awaited<ReturnType<typeof getTrip>>,
  TError = unknown,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrip>>, TError, TData>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetTripQueryOptions(id, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOptions.queryKey };
}

export function useCreateTrip<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof createTrip>>,
      TError,
      CreateTripBody,
      TContext
    >;
  },
): UseMutationResult<Awaited<ReturnType<typeof createTrip>>, TError, CreateTripBody, TContext> {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createTrip>>,
    CreateTripBody
  > = (body) => createTrip(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useUpdateTrip<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof updateTrip>>,
      TError,
      { id: number; body: UpdateTripBody },
      TContext
    >;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof updateTrip>>,
  TError,
  { id: number; body: UpdateTripBody },
  TContext
> {
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateTrip>>,
    { id: number; body: UpdateTripBody }
  > = ({ id, body }) => updateTrip(id, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useDeleteTrip<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<void, TError, number, TContext>;
  },
): UseMutationResult<void, TError, number, TContext> {
  const mutationFn: MutationFunction<void, number> = (id) => deleteTrip(id);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useGenerateItinerary<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      ItineraryResult,
      TError,
      { id: number; body: GenerateItineraryBody },
      TContext
    >;
  },
): UseMutationResult<
  ItineraryResult,
  TError,
  { id: number; body: GenerateItineraryBody },
  TContext
> {
  const mutationFn: MutationFunction<
    ItineraryResult,
    { id: number; body: GenerateItineraryBody }
  > = ({ id, body }) => generateItinerary(id, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useDeleteTripDocument<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      void,
      TError,
      { tripId: number; docId: number },
      TContext
    >;
  },
): UseMutationResult<
  void,
  TError,
  { tripId: number; docId: number },
  TContext
> {
  const mutationFn: MutationFunction<
    void,
    { tripId: number; docId: number }
  > = ({ tripId, docId }) => deleteTripDocument(tripId, docId);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useUpdateTripDocument<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      TripDocument,
      TError,
      {
        tripId: number;
        docId: number;
        body: { extractedData?: Record<string, unknown>; lockedFields?: string[] };
      },
      TContext
    >;
  },
): UseMutationResult<
  TripDocument,
  TError,
  {
    tripId: number;
    docId: number;
    body: { extractedData?: Record<string, unknown>; lockedFields?: string[] };
  },
  TContext
> {
  const mutationFn: MutationFunction<
    TripDocument,
    {
      tripId: number;
      docId: number;
      body: { extractedData?: Record<string, unknown>; lockedFields?: string[] };
    }
  > = ({ tripId, docId, body }) => updateTripDocument(tripId, docId, body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useRescanTripDocument<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      TripDocument,
      TError,
      { tripId: number; docId: number },
      TContext
    >;
  },
): UseMutationResult<
  TripDocument,
  TError,
  { tripId: number; docId: number },
  TContext
> {
  const mutationFn: MutationFunction<
    TripDocument,
    { tripId: number; docId: number }
  > = ({ tripId, docId }) => rescanTripDocument(tripId, docId);
  return useMutation({ mutationFn, ...options?.mutation });
}

export function useExploreDestination<TError = unknown, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      ExploreDestinationResult,
      TError,
      ExploreDestinationBody,
      TContext
    >;
  },
): UseMutationResult<
  ExploreDestinationResult,
  TError,
  ExploreDestinationBody,
  TContext
> {
  const mutationFn: MutationFunction<
    ExploreDestinationResult,
    ExploreDestinationBody
  > = (body) => exploreDestination(body);
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

export const getGetTravelsStatsQueryOptions = <
  TData = Awaited<ReturnType<typeof getTravelsStats>>,
  TError = unknown,
>(
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getTravelsStats>>,
      TError,
      TData
    >;
  },
) => {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetTravelsStatsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getTravelsStats>>> = ({
    signal,
  }) => getTravelsStats({ signal });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getTravelsStats>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

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

export function useGetTravelsStats<
  TData = Awaited<ReturnType<typeof getTravelsStats>>,
  TError = unknown,
>(
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getTravelsStats>>,
      TError,
      TData
    >;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetTravelsStatsQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOptions.queryKey };
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
  syncToCalendar: boolean;
  googleEventId?: string | null;
  createdAt: string;
}

export interface CreateReminderBody {
  title: string;
  description?: string | null;
  dueDate?: string;
  recipientEmails?: string[];
  syncToCalendar?: boolean;
}

export interface UpdateReminderBody {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  done?: boolean;
  recipientEmails?: string[];
  syncToCalendar?: boolean;
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

// ---------------------------------------------------------------------------
// Google Calendar sync (shared family calendar)
// ---------------------------------------------------------------------------

export interface CalendarStatus {
  connected: boolean;
  googleEmail: string | null;
  calendarId: string | null;
  calendarSummary: string | null;
}

export interface CalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface SelectCalendarBody {
  calendarId: string;
  calendarSummary: string;
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

const putCalendarSettingsFn = (body: SelectCalendarBody): Promise<SelectCalendarBody> =>
  customFetch<SelectCalendarBody>("/api/travels/google-calendar/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useSelectCalendar(
  options?: { mutation?: UseMutationOptions<SelectCalendarBody, unknown, SelectCalendarBody> },
) {
  const mutationFn = (body: SelectCalendarBody) => putCalendarSettingsFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

const deleteCalendarConnectionFn = (): Promise<void> =>
  customFetch<void>("/api/travels/google-calendar/disconnect", { method: "DELETE" });

export function useDisconnectCalendar(
  options?: { mutation?: UseMutationOptions<void, unknown, void> },
) {
  const mutationFn = () => deleteCalendarConnectionFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

// ---------------------------------------------------------------------------
// elAIne assistant
// ---------------------------------------------------------------------------

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export type AssistantActionType =
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
  | "add_itinerary_day"
  | "regenerate_itinerary_day";

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

export const getGetAssistantConversationQueryKey = () =>
  [`/api/travels/assistant/conversation`] as const;

const getAssistantConversationFn = (
  options?: RequestInit,
): Promise<{ messages: AssistantMessage[] }> =>
  customFetch<{ messages: AssistantMessage[] }>(
    "/api/travels/assistant/conversation",
    { ...options, method: "GET" },
  );

export function useGetAssistantConversation<
  TData = { messages: AssistantMessage[] },
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<{ messages: AssistantMessage[] }, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetAssistantConversationQueryKey();
  const queryFn: QueryFunction<{ messages: AssistantMessage[] }> = ({ signal }) =>
    getAssistantConversationFn({ signal });
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

// The chat endpoint is streamed as Server-Sent Events (so elAIne's reply, and
// any proposed [[ACTION: ...]] directive, can build up incrementally in the
// UI) rather than returning a single JSON body, so it isn't a plain
// react-query mutation like the other endpoints in this file. Callers get
// incremental updates via `callbacks` and the final result via the resolved
// promise (which also resolves `onDone`).
export interface AssistantChatStreamCallbacks {
  onDelta?: (text: string) => void;
  onAction?: (action: AssistantAction) => void;
  onDone?: (result: AssistantChatResponse) => void;
}

function parseSseDataLines(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

export async function streamAssistantMessage(
  body: { message: string; pageContext?: string },
  callbacks: AssistantChatStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  const response = await fetch("/api/travels/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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

      const eventType = rawEvent.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
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
        case "done":
          done = data as AssistantChatResponse;
          callbacks.onDone?.(done);
          break;
        case "error":
          throw new Error((data as { message?: string }).message ?? "elAIne couldn't respond just now.");
      }
    }
  }

  if (!done) {
    throw new Error("elAIne's response ended unexpectedly.");
  }
  return done;
}

const newAssistantConversationFn = (): Promise<{ messages: AssistantMessage[] }> =>
  customFetch<{ messages: AssistantMessage[] }>(
    "/api/travels/assistant/conversation",
    { method: "DELETE" },
  );

export function useNewAssistantConversation(
  options?: {
    mutation?: UseMutationOptions<{ messages: AssistantMessage[] }, unknown, void>;
  },
) {
  const mutationFn = () => newAssistantConversationFn();
  return useMutation({ mutationFn, ...options?.mutation });
}

const executeAssistantActionFn = (
  body: Pick<AssistantAction, "type" | "payload">,
): Promise<AssistantActionResult> =>
  customFetch<AssistantActionResult>("/api/travels/assistant/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useExecuteAssistantAction(
  options?: {
    mutation?: UseMutationOptions<
      AssistantActionResult,
      unknown,
      Pick<AssistantAction, "type" | "payload">
    >;
  },
) {
  const mutationFn = (body: Pick<AssistantAction, "type" | "payload">) =>
    executeAssistantActionFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export const getGetAssistantSettingsQueryKey = () =>
  [`/api/travels/assistant/settings`] as const;

const getAssistantSettingsFn = (options?: RequestInit): Promise<AssistantSettings> =>
  customFetch<AssistantSettings>("/api/travels/assistant/settings", {
    ...options,
    method: "GET",
  });

export function useGetAssistantSettings<
  TData = AssistantSettings,
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<AssistantSettings, TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetAssistantSettingsQueryKey();
  const queryFn: QueryFunction<AssistantSettings> = ({ signal }) =>
    getAssistantSettingsFn({ signal });
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

export type UpdateAssistantSettingsBody = Partial<AssistantSettings>;

const putAssistantSettingsFn = (
  body: UpdateAssistantSettingsBody,
): Promise<AssistantSettings> =>
  customFetch<AssistantSettings>("/api/travels/assistant/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useUpdateAssistantSettings(
  options?: {
    mutation?: UseMutationOptions<AssistantSettings, unknown, UpdateAssistantSettingsBody>;
  },
) {
  const mutationFn = (body: UpdateAssistantSettingsBody) => putAssistantSettingsFn(body);
  return useMutation({ mutationFn, ...options?.mutation });
}

export const getListHouseholdMemoryQueryKey = () =>
  [`/api/travels/assistant/memory`] as const;

const listHouseholdMemoryFn = (options?: RequestInit): Promise<HouseholdMemoryItem[]> =>
  customFetch<HouseholdMemoryItem[]>("/api/travels/assistant/memory", {
    ...options,
    method: "GET",
  });

export function useListHouseholdMemory<
  TData = HouseholdMemoryItem[],
  TError = unknown,
>(options?: {
  query?: UseQueryOptions<HouseholdMemoryItem[], TError, TData>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListHouseholdMemoryQueryKey();
  const queryFn: QueryFunction<HouseholdMemoryItem[]> = ({ signal }) =>
    listHouseholdMemoryFn({ signal });
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

const deleteHouseholdMemoryFn = (id: number): Promise<void> =>
  customFetch<void>(`/api/travels/assistant/memory/${id}`, { method: "DELETE" });

export function useDeleteHouseholdMemory(
  options?: { mutation?: UseMutationOptions<void, unknown, number> },
) {
  const mutationFn = (id: number) => deleteHouseholdMemoryFn(id);
  return useMutation({ mutationFn, ...options?.mutation });
}
