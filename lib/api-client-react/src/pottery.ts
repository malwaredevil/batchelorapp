// Hand-written hooks for pottery multipart/form-data endpoints (image
// uploads, AI compare-photo upload). Orval/OpenAPI codegen does not model
// multipart/form-data request bodies for pottery today, so these follow the
// same customFetch + react-query pattern used by the generated hooks and by
// the hand-written travels upload hooks (uploadTripPhoto/useUploadTripPhoto).
import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import {
  getListPotteryQueryKey,
  getGetCollectionStatsQueryKey,
  getGetPotteryQueryKey,
} from "./generated/api";
import type {
  PotteryPotteryItem,
  PotteryCompareResult,
  PotteryPotteryImage,
} from "./generated/api.schemas";

export interface UploadPotteryInput {
  image: File;
  name?: string;
  quantity?: number;
  notes?: string;
  dimensions?: string;
  categoryIds?: number[];
}

function buildUploadPotteryFormData(data: UploadPotteryInput): FormData {
  const formData = new FormData();
  formData.append("image", data.image);
  if (data.name) formData.append("name", data.name);
  if (data.quantity && data.quantity > 1) {
    formData.append("quantity", String(data.quantity));
  }
  if (data.notes) formData.append("notes", data.notes);
  if (data.dimensions) formData.append("dimensions", data.dimensions);
  if (data.categoryIds && data.categoryIds.length > 0) {
    formData.append("categoryIds", JSON.stringify(data.categoryIds));
  }
  return formData;
}

export const uploadPottery = (
  data: UploadPotteryInput,
): Promise<PotteryPotteryItem> =>
  customFetch<PotteryPotteryItem>("/api/pottery/items", {
    method: "POST",
    body: buildUploadPotteryFormData(data),
  });

export function useUploadPottery<TError = Error, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      PotteryPotteryItem,
      TError,
      UploadPotteryInput,
      TContext
    >;
  },
): UseMutationResult<PotteryPotteryItem, TError, UploadPotteryInput, TContext> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadPottery,
    ...options?.mutation,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
      queryClient.invalidateQueries({
        queryKey: getGetCollectionStatsQueryKey(),
      });
      options?.mutation?.onSuccess?.(...args);
    },
  });
}

export const uploadPotteryCompare = (data: {
  image: File;
}): Promise<PotteryCompareResult> => {
  const formData = new FormData();
  formData.append("image", data.image);
  return customFetch<PotteryCompareResult>("/api/pottery/compare", {
    method: "POST",
    body: formData,
  });
};

export function useUploadCompare<TError = Error, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      PotteryCompareResult,
      TError,
      { image: File },
      TContext
    >;
  },
): UseMutationResult<PotteryCompareResult, TError, { image: File }, TContext> {
  return useMutation({
    mutationFn: uploadPotteryCompare,
    ...options?.mutation,
  });
}

export const uploadPotteryImage = (
  itemId: number,
  data: { image: File; label?: string },
): Promise<PotteryPotteryImage> => {
  const formData = new FormData();
  formData.append("image", data.image);
  if (data.label) formData.append("label", data.label);
  return customFetch<PotteryPotteryImage>(
    `/api/pottery/items/${itemId}/images`,
    { method: "POST", body: formData },
  );
};

export function useUploadPotteryImage<TError = Error, TContext = unknown>(
  itemId: number,
  options?: {
    mutation?: UseMutationOptions<
      PotteryPotteryImage,
      TError,
      { image: File; label?: string },
      TContext
    >;
  },
): UseMutationResult<
  PotteryPotteryImage,
  TError,
  { image: File; label?: string },
  TContext
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => uploadPotteryImage(itemId, data),
    ...options?.mutation,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: getGetPotteryQueryKey(itemId),
      });
      options?.mutation?.onSuccess?.(...args);
    },
  });
}
