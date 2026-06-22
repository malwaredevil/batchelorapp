import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getListPotteryQueryKey,
  getGetCollectionStatsQueryKey,
  getGetPotteryQueryKey,
} from "@workspace/api-client-react";
import type {
  PotteryPotteryItem as PotteryItem,
  PotteryCompareResult as CompareResult,
  PotteryPotteryImage as PotteryImage,
} from "@workspace/api-client-react";

export function useUploadPottery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      image: File;
      name?: string;
      quantity?: number;
      notes?: string;
      dimensions?: string;
      categoryIds?: number[];
    }) => {
      const formData = new FormData();
      formData.append("image", data.image);
      if (data.name) formData.append("name", data.name);
      if (data.quantity && data.quantity > 1)
        formData.append("quantity", String(data.quantity));
      if (data.notes) formData.append("notes", data.notes);
      if (data.dimensions) formData.append("dimensions", data.dimensions);
      if (data.categoryIds && data.categoryIds.length > 0) {
        formData.append("categoryIds", JSON.stringify(data.categoryIds));
      }

      const res = await fetch("/api/pottery/items", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Upload failed");
      }

      return (await res.json()) as PotteryItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() });
      queryClient.invalidateQueries({
        queryKey: getGetCollectionStatsQueryKey(),
      });
    },
  });
}

export function useUploadCompare() {
  return useMutation({
    mutationFn: async (data: { image: File }) => {
      const formData = new FormData();
      formData.append("image", data.image);

      const res = await fetch("/api/pottery/compare", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Compare failed");
      }

      return (await res.json()) as CompareResult;
    },
  });
}

/** Add a supplemental image to a pottery piece. */
export function useUploadPotteryImage(itemId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { image: File; label?: string }) => {
      const formData = new FormData();
      formData.append("image", data.image);
      if (data.label) formData.append("label", data.label);
      const res = await fetch(`/api/pottery/items/${itemId}/images`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Upload failed");
      }
      return (await res.json()) as PotteryImage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getGetPotteryQueryKey(itemId),
      });
    },
  });
}

/** Update the label (and/or position) of a supplemental image. */
export function useRelabelPotteryImage(itemId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { imageId: number; label: string | null }) => {
      const res = await fetch(`/api/pottery/items/${itemId}/images/${data.imageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: data.label }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Update failed");
      }
      return (await res.json()) as PotteryImage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getGetPotteryQueryKey(itemId),
      });
    },
  });
}

/** Delete a supplemental image. */
export function useRemovePotteryImage(itemId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: number) => {
      const res = await fetch(`/api/pottery/items/${itemId}/images/${imageId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Delete failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getGetPotteryQueryKey(itemId),
      });
    },
  });
}
