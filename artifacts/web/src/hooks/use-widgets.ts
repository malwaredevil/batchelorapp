import { useCallback, useEffect, useMemo, useState } from "react";
import { WIDGETS, type WidgetEntry } from "@/config/apps";

const STORAGE_KEY = "batchelor-widgets";

const ALL_IDS = WIDGETS.map((w) => w.id);

function getInitialIds(): string[] {
  if (typeof window === "undefined") return ALL_IDS;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return ALL_IDS;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return ALL_IDS;
    const ids = parsed.filter(
      (id): id is string => typeof id === "string" && ALL_IDS.includes(id),
    );
    return ids;
  } catch {
    return ALL_IDS;
  }
}

/**
 * Manages which dashboard widgets are enabled, persisted in localStorage.
 *
 * The full catalogue lives in `WIDGETS` (config/apps). This hook tracks the
 * subset the user has enabled and their order, so add/remove survive reloads.
 */
export function useWidgets() {
  const [ids, setIds] = useState<string[]>(getInitialIds);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }, [ids]);

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

  const available = useMemo(
    () => WIDGETS.filter((w) => !ids.includes(w.id)),
    [ids],
  );

  const removeWidget = useCallback((id: string) => {
    setIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const addWidget = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const resetWidgets = useCallback(() => {
    setIds(ALL_IDS);
  }, []);

  return { enabled, available, addWidget, removeWidget, resetWidgets };
}
