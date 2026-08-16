import { useSyncExternalStore } from "react";

export type AsyncActionStatus = "processing" | "success" | "error";

// How long a finished status stays visible before auto-clearing back to idle.
const SUCCESS_DISPLAY_MS = 2500;
const ERROR_DISPLAY_MS = 5000;

// Module-scoped (not component-scoped) so status survives client-side
// navigation away from whatever page triggered the action — the underlying
// request keeps running regardless of which component is mounted, and this
// store lets any component (even one that mounts later, on a different
// page) observe its live status. Only a full page reload resets it, which
// is fine: a full reload also aborts the underlying in-flight request.
const statuses = new Map<string, AsyncActionStatus>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Current status for a tracked async action, or `undefined` when idle. */
export function getAsyncActionStatus(
  key: string,
): AsyncActionStatus | undefined {
  return statuses.get(key);
}

/** True while the action for `key` is in flight — use to block duplicate triggers. */
export function isAsyncActionBusy(key: string): boolean {
  return statuses.get(key) === "processing";
}

/**
 * Track an in-flight async action (e.g. an AI re-analysis request) under `key`
 * so any component can render its live status via `useAsyncActionStatus`.
 * Automatically transitions to "success"/"error" when `promise` settles, then
 * clears back to idle after a short delay. Callers should still handle the
 * promise's rejection themselves (e.g. to show a toast) — this only tracks
 * status for display, it never swallows the error.
 */
export function trackAsyncAction(key: string, promise: Promise<unknown>): void {
  statuses.set(key, "processing");
  notify();
  promise.then(
    () => {
      statuses.set(key, "success");
      notify();
      setTimeout(() => {
        if (statuses.get(key) === "success") {
          statuses.delete(key);
          notify();
        }
      }, SUCCESS_DISPLAY_MS);
    },
    () => {
      statuses.set(key, "error");
      notify();
      setTimeout(() => {
        if (statuses.get(key) === "error") {
          statuses.delete(key);
          notify();
        }
      }, ERROR_DISPLAY_MS);
    },
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to the live status for `key`. */
export function useAsyncActionStatus(
  key: string,
): AsyncActionStatus | undefined {
  return useSyncExternalStore(
    subscribe,
    () => getAsyncActionStatus(key),
    () => undefined,
  );
}
