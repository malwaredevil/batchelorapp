import { useCallback, useEffect, useMemo, useState } from "react";
import { WIDGETS, type WidgetEntry } from "@/config/apps";

const STORAGE_KEY = "batchelor-widgets";

// IDs enabled by default on first visit — a curated starter set.
// Users can add or remove any widget from the full catalogue.
const DEFAULT_IDS = ["pottery-stats", "quilting-stats", "weather", "shopping-list"];

const ALL_IDS = WIDGETS.map((w) => w.id);

function getInitialIds(): string[] {
  if (typeof window === "undefined") return DEFAULT_IDS;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_IDS;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_IDS;
    // Keep only IDs that still exist in the catalogue
    const ids = parsed.filter(
      (id): id is string => typeof id === "string" && ALL_IDS.includes(id),
    );
    return ids;
  } catch {
    return DEFAULT_IDS;
  }
}

/**
 * Manages which dashboard widgets are enabled, persisted in localStorage.
 *
 * The full catalogue lives in `WIDGETS` (config/apps). This hook tracks the
 * subset the user has enabled and their order, so add/remove survive reloads.
 * There is no cap on how many can be enabled.
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

  const enabledIds = useMemo(() => new Set(ids), [ids]);

  const isEnabled = useCallback(
    (id: string) => enabledIds.has(id),
    [enabledIds],
  );

  const removeWidget = useCallback((id: string) => {
    setIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const addWidget = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const toggleWidget = useCallback((id: string) => {
    setIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const resetWidgets = useCallback(() => {
    setIds(DEFAULT_IDS);
  }, []);

  return { enabled, isEnabled, addWidget, removeWidget, toggleWidget, resetWidgets };
}
