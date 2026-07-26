// Hand-written overrides for ornament endpoints that the generated code
// doesn't handle correctly (multipart/form-data uploads).
// Mirrors the same gap documented for pottery (see pottery.ts) and travels
// (uploadTripPhoto).
import type { OrnamentsOrnamentItem } from "./generated/api.schemas";
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { OrnamentsOrnamentImage } from "./generated/api.schemas";

// Create an ornament by uploading the primary image. The server runs AI vision
// analysis to determine name, brand, series, year, etc. automatically.
export const createOrnamentFromImage = (
  formData: FormData,
): Promise<OrnamentsOrnamentItem> =>
  customFetch<OrnamentsOrnamentItem>("/api/ornaments/items", {
    method: "POST",
    body: formData,
  });

export const uploadOrnamentImage = (
  id: number,
  formData: FormData,
): Promise<OrnamentsOrnamentImage> =>
  customFetch<OrnamentsOrnamentImage>(`/api/ornaments/items/${id}/images`, {
    method: "POST",
    body: formData,
  });

export function useUploadOrnamentImage<
  TError = Error,
  TContext = unknown,
>(
  id: number,
  options?: {
    mutation?: UseMutationOptions<
      OrnamentsOrnamentImage,
      TError,
      FormData,
      TContext
    >;
  },
): UseMutationResult<OrnamentsOrnamentImage, TError, FormData, TContext> {
  return useMutation({
    mutationFn: (formData) => uploadOrnamentImage(id, formData),
    ...options?.mutation,
  });
}
