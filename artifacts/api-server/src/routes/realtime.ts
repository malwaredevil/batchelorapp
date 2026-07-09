import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { onRealtimeChange } from "../lib/realtime";

const router: IRouter = Router();

const KEEP_ALIVE_INTERVAL_MS = 25_000;

// Authenticated SSE endpoint: relays lightweight `{table}` invalidation
// signals from the server-side Supabase Realtime subscription
// (lib/realtime.ts) to the browser, which invalidates the matching React
// Query cache keys instead of polling. Never carries row data — only which
// table changed — so it stays a thin cache-invalidation signal, not a new
// data-read path.
router.get("/stream", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  sendEvent("connected", { ok: true });

  const unsubscribe = onRealtimeChange((table) => {
    sendEvent("change", { table });
  });

  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, KEEP_ALIVE_INTERVAL_MS);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

export default router;
