import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WIDGETS, type WidgetEntry } from "@/config/apps";

const STORAGE_KEY = "batchelor-widgets";

const DEFAULT_IDS = ["pottery-stats", "quilting-stats", "weather", "shopping-list"];

const ALL_IDS = WIDGETS.map((w) => w.id);

function readLocalStorage(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter(
      (id): id is string => typeof id === "string" && ALL_IDS.includes(id),
    );
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage quota full — ignore
  }
}

const PREFS_URL = `${import.meta.env.BASE_URL}api/hub/preferences`.replace(
  /\/\//g,
  "/",
);

async function fetchServerPrefs(): Promise<string[] | null> {
  try {
    const res = await fetch(PREFS_URL, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { widgetIds: string[] | null };
    if (!Array.isArray(data.widgetIds)) return null;
    return data.widgetIds.filter((id) => ALL_IDS.includes(id));
  } catch {
    return null;
  }
}

async function saveServerPrefs(ids: string[]): Promise<void> {
  try {
    await fetch(PREFS_URL, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetIds: ids }),
    });
  } catch {
    // silent — localStorage already saved locally
  }
}

/**
 * Manages which dashboard widgets are enabled.
 *
 * Persistence strategy (per-user, server-authoritative):
 *  1. On mount, show localStorage immediately so there's no flash.
 *  2. Fetch from server — if found, override (server is authoritative; this means
 *     two people using the same browser each keep their own layout).
 *  3. Every change writes localStorage (instant) and debounces a server PUT (800 ms).
 *
 * If the user is not logged in the server returns 401, which is silently ignored —
 * the hook continues working purely from localStorage in that case.
 */
export function useWidgets() {
  const [ids, setIdsRaw] = useState<string[]>(
    () => readLocalStorage() ?? DEFAULT_IDS,
  );

  // True once the server fetch has resolved (success or failure).
  const [serverReady, setServerReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Step 1: hydrate from server on mount.
  useEffect(() => {
    fetchServerPrefs().then((serverIds) => {
      if (serverIds !== null) {
        setIdsRaw(serverIds);
        writeLocalStorage(serverIds);
      }
      setServerReady(true);
    });
  }, []);

  // Wrapped setter: always updates localStorage and schedules a server save.
  const setIds = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setIdsRaw((prev) => {
        const next =
          typeof updater === "function" ? updater(prev) : updater;
        writeLocalStorage(next);

        // Debounce server write — only after first server response so we don't
        // accidentally overwrite server data with stale localStorage on mount.
        if (serverReady) {
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            void saveServerPrefs(next);
          }, 800);
        }

        return next;
      });
    },
    [serverReady],
  );

  const byId = useMemo(() => {
    const map = new Map<string, WidgetEntry>();
    for (const w of WIDGETS) map.set(w.id, w);
    return map;
  }, []);

  const enabled = useMemo(
    () =>
      ids
        .map((id) => byId.get(id))
        .filter((w): w is WidgetEntry => w !== undefined),
    [ids, byId],
  );

  const enabledIds = useMemo(() => new Set(ids), [ids]);

  const isEnabled = useCallback(
    (id: string) => enabledIds.has(id),
    [enabledIds],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setIds((prev) => prev.filter((x) => x !== id));
    },
    [setIds],
  );

  const addWidget = useCallback(
    (id: string) => {
      setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    [setIds],
  );

  const toggleWidget = useCallback(
    (id: string) => {
      setIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    },
    [setIds],
  );

  const resetWidgets = useCallback(() => {
    setIds(DEFAULT_IDS);
  }, [setIds]);

  return {
    enabled,
    isEnabled,
    addWidget,
    removeWidget,
    toggleWidget,
    resetWidgets,
    serverReady,
  };
}
