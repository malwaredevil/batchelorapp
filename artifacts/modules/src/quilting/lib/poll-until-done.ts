import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Architecture hardening (#754): background-job polling that previously ran
 * unconditionally on a fixed interval for a fixed duration (e.g. every 3s for
 * 60-90s), even after the job had already finished and even while the browser
 * tab was hidden. That wastes requests/DB queries for no benefit once the
 * answer is already known.
 *
 * This helper keeps the same "poll until timeout" shape callers already use,
 * but adds two cheap improvements:
 *  - stops immediately once `isDone(data)` says the job reached a terminal
 *    state, instead of always running for the full window.
 *  - pauses polling while the tab is hidden (`document.visibilitychange`)
 *    and resumes (with one immediate poll) when it becomes visible again,
 *    instead of polling a tab nobody is looking at.
 *
 * Returns a cleanup function; call it from the component's effect/unmount
 * path (existing call sites already call `clearInterval` on unmount, so this
 * is a drop-in replacement for that pattern).
 */
export function pollUntilDone<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  isDone: (data: T | undefined) => boolean,
  {
    intervalMs = 3000,
    timeoutMs = 90_000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
): () => void {
  let stopped = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const deadline = Date.now() + timeoutMs;

  const stop = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const tick = async () => {
    if (stopped || document.hidden) return;
    await queryClient.invalidateQueries({ queryKey });
    if (stopped) return;
    const data = queryClient.getQueryData<T>(queryKey);
    if (isDone(data) || Date.now() >= deadline) {
      stop();
    }
  };

  const onVisibilityChange = () => {
    if (!document.hidden && !stopped && intervalId !== null) {
      // Tab just became visible again — refresh immediately rather than
      // waiting up to `intervalMs` for the next tick.
      void tick();
    }
  };

  intervalId = setInterval(() => void tick(), intervalMs);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stopped = true;
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
