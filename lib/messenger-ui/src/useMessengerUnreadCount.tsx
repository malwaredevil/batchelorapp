import { useEffect } from "react";
import {
  useGetUnreadCount,
  getGetUnreadCountQueryKey,
} from "@workspace/api-client-react";

export function useMessengerUnreadCount() {
  const { data } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 10_000 },
  });

  const count = data?.count ?? 0;

  useEffect(() => {
    try {
      if (count > 0) {
        if ("setAppBadge" in navigator) {
          (
            navigator as Navigator & { setAppBadge: (n: number) => void }
          ).setAppBadge(count);
        }
      } else {
        if ("clearAppBadge" in navigator) {
          (
            navigator as Navigator & { clearAppBadge: () => void }
          ).clearAppBadge();
        }
      }
    } catch {
      // API not supported in this browser
    }
  }, [count]);

  return count;
}
