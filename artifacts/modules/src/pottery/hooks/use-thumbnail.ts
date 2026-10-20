import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  setPotteryThumbnail,
  getGetPotteryQueryKey,
  getListPotteryQueryKey,
} from "@workspace/api-client-react";
import {
  getImageVersion,
  type ThumbnailFramingValue,
} from "@workspace/collection-ui";

/** Saves (or clears with null) a pottery thumbnail framing. */
export function useSaveThumbnail() {
  const queryClient = useQueryClient();
  return useCallback(
    async (
      itemId: number,
      imageUrl: string,
      thumbnail: ThumbnailFramingValue | null,
    ) => {
      const sourceVersion = getImageVersion(imageUrl);
      if (!sourceVersion) {
        throw new Error("Photo version unavailable. Reload and try again.");
      }
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: getGetPotteryQueryKey(itemId),
          }),
          queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() }),
        ]);
      try {
        const updated = await setPotteryThumbnail(itemId, {
          sourceVersion,
          thumbnail: thumbnail
            ? {
                mode: thumbnail.mode,
                x: thumbnail.x,
                y: thumbnail.y,
                zoom: thumbnail.zoom,
              }
            : null,
        });
        queryClient.setQueryData(getGetPotteryQueryKey(itemId), updated);
        await refresh();
      } catch (err) {
        if ((err as { status?: number } | null)?.status === 409) {
          await refresh();
          throw new Error(
            "This photo changed while you were framing it. The latest photo is loading; adjust the thumbnail again.",
          );
        }
        throw err;
      }
    },
    [queryClient],
  );
}
