import { createClient } from "@supabase/supabase-js";
import { EventEmitter } from "node:events";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Server-side Supabase Realtime relay (issue #128). The browser NEVER talks
 * to Supabase directly — no anon key is shipped to the client, and no RLS
 * policy changes were made. Instead, this module holds one long-lived
 * Realtime channel authenticated with the service-role key (already used
 * everywhere else in this server, e.g. storage-core.ts), listens for
 * postgres_changes on the household-shared collection tables, and
 * re-broadcasts a lightweight `{table}` invalidation signal — never row
 * data — to already-authenticated browsers via routes/realtime.ts's SSE
 * endpoint. This preserves the existing browser-to-API trust boundary.
 */
export const REALTIME_TABLES = [
  "pottery_items",
  "quilting_fabrics",
  "quilting_patterns",
  "quilting_finished_quilts",
  "travels_trips",
] as const;

export type RealtimeTable = (typeof REALTIME_TABLES)[number];

const CHANGE_EVENT = "change";

const emitter = new EventEmitter();
// Every open SSE connection registers a listener; uncapping avoids a
// misleading MaxListenersExceededWarning under normal household usage.
emitter.setMaxListeners(0);

let started = false;

export function initRealtimeRelay(): void {
  if (started) return;
  started = true;

  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const channel = supabase.channel("api-server-realtime-relay");
  for (const table of REALTIME_TABLES) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      () => {
        emitter.emit(CHANGE_EVENT, table satisfies RealtimeTable);
      },
    );
  }

  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED") {
      logger.info(
        { tables: REALTIME_TABLES },
        "[realtime] subscribed to postgres_changes relay",
      );
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      logger.error(
        { status, err },
        "[realtime] channel subscription issue — invalidation signals will not be delivered until it recovers",
      );
    }
  });
}

export function onRealtimeChange(
  listener: (table: RealtimeTable) => void,
): () => void {
  emitter.on(CHANGE_EVENT, listener);
  return () => emitter.off(CHANGE_EVENT, listener);
}
