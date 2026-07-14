import { useEffect, useRef } from "react";
import { useGetUnreadCount, getGetUnreadCountQueryKey } from "@workspace/api-client-react";

export function useMessengerUnreadCount() {
  const { data } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 30_000 },
  });

  const count = data?.count ?? 0;
  const prevRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = count;

    if (count > prev) {
      try {
        if ("setAppBadge" in navigator) {
          (navigator as Navigator & { setAppBadge: (n: number) => void }).setAppBadge(
            count,
          );
        }
      } catch {
        // not supported
      }
    } else if (count === 0) {
      try {
        if ("clearAppBadge" in navigator) {
          (navigator as Navigator & { clearAppBadge: () => void }).clearAppBadge();
        }
      } catch {
        // not supported
      }
    }
  }, [count]);

  return count;
}
