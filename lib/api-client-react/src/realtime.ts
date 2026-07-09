import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Mirrors the server's REALTIME_TABLES (artifacts/api-server/src/lib/realtime.ts).
 * Keep in sync — this is intentionally a plain string union rather than
 * generated, since the SSE payload is a thin invalidation signal, not an
 * OpenAPI-described response body.
 */
export type RealtimeTable =
  | "pottery_items"
  | "quilting_fabrics"
  | "quilting_patterns"
  | "quilting_finished_quilts"
  | "travels_trips";

/** Which React Query key prefixes to invalidate when a given table changes. */
const TABLE_QUERY_KEY_PREFIXES: Record<RealtimeTable, string[]> = {
  pottery_items: ["/api/pottery/items", "/api/pottery/stats"],
  quilting_fabrics: ["/api/quilting/fabrics", "/api/quilting/stats"],
  quilting_patterns: ["/api/quilting/patterns", "/api/quilting/stats"],
  quilting_finished_quilts: ["/api/quilting/quilts", "/api/quilting/stats"],
  travels_trips: ["/api/travels/trips", "/api/travels/stats"],
};

/**
 * Subscribes to the server's Realtime relay SSE endpoint
 * (`GET /api/realtime/stream`, session-cookie authenticated, same-origin) and
 * invalidates the matching React Query cache keys whenever a household-shared
 * collection table changes elsewhere — no polling, no direct Supabase access
 * from the browser. Safe to mount once per app root; reconnects automatically
 * on transient drops (native EventSource behavior).
 */
export function useRealtimeInvalidation(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource("/api/realtime/stream");

    source.addEventListener("change", (event: MessageEvent<string>) => {
      let table: RealtimeTable | undefined;
      try {
        const parsed = JSON.parse(event.data) as { table?: RealtimeTable };
        table = parsed.table;
      } catch {
        return;
      }
      if (!table) return;

      const prefixes = TABLE_QUERY_KEY_PREFIXES[table];
      if (!prefixes) return;

      queryClient.invalidateQueries({
        predicate: (query) => {
          const firstKey = query.queryKey[0];
          return (
            typeof firstKey === "string" &&
            prefixes.some((prefix) => firstKey.startsWith(prefix))
          );
        },
      });
    });

    return () => {
      source.close();
    };
  }, [queryClient, enabled]);
}
