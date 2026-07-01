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
  hasRentalCar: boolean;
  accommodationName?: string | null;
  accommodationArea?: string | null;
  notes?: string | null;
  travellerCount: number;
  travelers?: string[] | null;
  theOneThing?: string[] | null;
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
  hasRentalCar?: boolean;
  accommodationName?: string;
  accommodationArea?: string;
  notes?: string;
  travellerCount?: number;
  travelers?: string[];
  theOneThing?: string[];
}

export type UpdateTripBody = Partial<CreateTripBody> & {
  itinerary?: unknown;
  packingList?: unknown;
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
  nextTrip: { destination: string; startDate: string } | null;
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
