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

/** Mark `key` as in-flight. Prefer `trackAsyncAction` when you have a single
 * promise to await — use this directly only when a batch/bulk operation needs
 * to mark several keys "processing" up front, ahead of one shared request. */
export function markAsyncActionProcessing(key: string): void {
  statuses.set(key, "processing");
  notify();
}

/** Mark `key` "success" or "error" and auto-clear back to idle after the same
 * short delay `trackAsyncAction` uses. Pair with `markAsyncActionProcessing`
 * for bulk operations where one request's outcome must be split across many
 * item keys (e.g. a bulk endpoint's per-item succeeded/failed id lists). */
export function markAsyncActionSettled(
  key: string,
  status: "success" | "error",
  opts?: {
    /**
     * When true, the settled status stays visible until explicitly cleared
     * (via `clearSettledAsyncActionStatuses`) instead of auto-clearing after
     * a short delay. Used by bulk runs, where the per-card check/X icons
     * should persist until the user presses "Done".
     */
    sticky?: boolean;
  },
): void {
  statuses.set(key, status);
  notify();
  if (opts?.sticky) return;
  const displayMs =
    status === "success" ? SUCCESS_DISPLAY_MS : ERROR_DISPLAY_MS;
  setTimeout(() => {
    if (statuses.get(key) === status) {
      statuses.delete(key);
      notify();
    }
  }, displayMs);
}

/**
 * Clear all settled ("success"/"error") statuses whose key starts with
 * `prefix`, leaving in-flight "processing" entries untouched. Used by a bulk
 * run's "Done" button to dismiss the sticky per-card outcome icons without
 * disturbing any single-item refresh that may still be running.
 */
export function clearSettledAsyncActionStatuses(prefix: string): void {
  let changed = false;
  for (const [key, status] of statuses) {
    if (key.startsWith(prefix) && status !== "processing") {
      statuses.delete(key);
      changed = true;
    }
  }
  if (changed) notify();
}

/**
 * Unconditionally clear the statuses for the given keys (including
 * "processing" entries). Used when a bulk run's results arrive after the user
 * already dismissed the run (pressed "Done" mid-flight): the stale outcome
 * must not surface as sticky icons, and the "processing" spinners it left
 * behind must not linger forever.
 */
export function clearAsyncActionStatuses(keys: Iterable<string>): void {
  let changed = false;
  for (const key of keys) {
    if (statuses.delete(key)) changed = true;
  }
  if (changed) notify();
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
  markAsyncActionProcessing(key);
  promise.then(
    () => markAsyncActionSettled(key, "success"),
    () => markAsyncActionSettled(key, "error"),
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
