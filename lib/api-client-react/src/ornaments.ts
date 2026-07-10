// Hand-written override for the ornaments "add supplemental image" endpoint.
// The generated `addOrnamentImage` (see generated/api.ts) does not send a
// request body at all, since the OpenAPI spec doesn't model this
// multipart/form-data upload — mirrors the same gap documented for pottery
// (see pottery.ts) and travels (uploadTripPhoto).
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { OrnamentsOrnamentImage } from "./generated/api.schemas";

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
