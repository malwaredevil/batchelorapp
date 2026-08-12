import { useState, useEffect, useCallback } from "react";

/**
 * Persists a banner's dismissed state in localStorage under a caller-provided
 * key, so closing a banner keeps it closed across reloads/remounts instead of
 * resetting to visible every time the component mounts.
 *
 * Bake enough uniqueness into the key that a genuinely NEW instance of the
 * banner isn't permanently suppressed by an old dismissal — e.g. include the
 * year in a yearly birthday banner's key, or an incident id/date in a status
 * alert's key, so next year's birthday or a brand-new incident still shows.
 *
 * Pass `null` to skip persistence entirely (e.g. while a prerequisite value
 * like a user id hasn't loaded yet) — the banner will show every mount until
 * a real key is available.
 *
 * `storage` defaults to `"local"` (persists across browser sessions/reloads
 * indefinitely). Use `"session"` for live status alerts that should stay
 * dismissed for the current tab/session but reappear on the next visit in
 * case the underlying condition is still ongoing.
 */
export function usePersistedDismiss(
  key: string | null,
  storage: "local" | "session" = "local",
): [dismissed: boolean, dismiss: () => void] {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!key) {
      setDismissed(false);
      return;
    }
    try {
      const store = storage === "session" ? sessionStorage : localStorage;
      setDismissed(store.getItem(key) === "1");
    } catch {
      // storage blocked (private mode etc.) — fall back to showing the banner
      setDismissed(false);
    }
  }, [key, storage]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (!key) return;
    try {
      const store = storage === "session" ? sessionStorage : localStorage;
      store.setItem(key, "1");
    } catch {
      // storage blocked — dismissal still applies for the rest of this mount
    }
  }, [key, storage]);

  return [dismissed, dismiss];
}
