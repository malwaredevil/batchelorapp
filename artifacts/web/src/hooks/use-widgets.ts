import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WIDGETS, type WidgetEntry } from "@/config/apps";
import { getPreferences, updatePreferences } from "@workspace/api-client-react";

// ── Slot types (static catalogue widget OR configurable RSS instance) ──────────
export interface StaticSlot {
  t: "s";
  id: string;
}
export interface RssSlot {
  t: "r";
  iid: string;
  title: string;
  url: string;
}
export type WidgetSlot = StaticSlot | RssSlot;

// ── Constants ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "batchelor-widgets-v2";
const LEGACY_KEY = "batchelor-widgets";
const CARD_ORDER_STORAGE_KEY = "batchelor-app-card-order-v1";

const ALL_STATIC_IDS = new Set(WIDGETS.map((w) => w.id));

const DEFAULT_SLOTS: WidgetSlot[] = [
  { t: "s", id: "pottery-stats" },
  { t: "s", id: "quilting-stats" },
  { t: "s", id: "weather" },
  { t: "s", id: "shopping-list" },
];

export const DEFAULT_APP_CARD_ORDER = [
  "pottery",
  "quilting",
  "travels",
  "ornaments",
  "elaine",
  "office",
] as const;

const VALID_APP_IDS = new Set<string>(DEFAULT_APP_CARD_ORDER);

// ── Parsing helpers ───────────────────────────────────────────────────────────
function parseSlots(raw: unknown): WidgetSlot[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return [];
  // Legacy: string[]
  if (typeof raw[0] === "string") {
    return (raw as string[])
      .filter((id) => ALL_STATIC_IDS.has(id))
      .map((id) => ({ t: "s" as const, id }));
  }
  // New: WidgetSlot[]
  return raw.filter((item): item is WidgetSlot => {
    if (typeof item !== "object" || item === null) return false;
    const s = item as Record<string, unknown>;
    if (s["t"] === "s") return typeof s["id"] === "string";
    if (s["t"] === "r")
      return typeof s["iid"] === "string" && typeof s["url"] === "string";
    return false;
  });
}

function parseAppCardOrder(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const filtered = (raw as unknown[]).filter(
    (x): x is string => typeof x === "string" && VALID_APP_IDS.has(x),
  );
  // Must include all known app IDs (append any missing to the end)
  const set = new Set(filtered);
  for (const id of DEFAULT_APP_CARD_ORDER) {
    if (!set.has(id)) filtered.push(id);
  }
  return filtered.length > 0 ? filtered : null;
}

function readLocalStorage(): WidgetSlot[] | null {
  if (typeof window === "undefined") return null;
  try {
    const v2 = window.localStorage.getItem(STORAGE_KEY);
    if (v2) {
      const p = parseSlots(JSON.parse(v2) as unknown);
      if (p) return p;
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const p = parseSlots(JSON.parse(legacy) as unknown);
      if (p) return p;
    }
    return null;
  } catch {
    return null;
  }
}

function readCardOrderLocalStorage(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CARD_ORDER_STORAGE_KEY);
    if (raw) return parseAppCardOrder(JSON.parse(raw) as unknown);
    return null;
  } catch {
    return null;
  }
}

function writeLocalStorage(slots: WidgetSlot[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    /* quota full */
  }
}

function writeCardOrderLocalStorage(order: string[]) {
  try {
    window.localStorage.setItem(CARD_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* quota full */
  }
}

// ── Server sync ───────────────────────────────────────────────────────────────
interface ServerPrefs {
  slots: WidgetSlot[] | null;
  appCardOrder: string[] | null;
}

async function fetchServerPrefs(): Promise<ServerPrefs> {
  try {
    const data = await getPreferences();
    return {
      slots: data.slots !== undefined ? parseSlots(data.slots) : null,
      appCardOrder:
        data.appCardOrder !== undefined && data.appCardOrder !== null
          ? parseAppCardOrder(data.appCardOrder)
          : null,
    };
  } catch {
    return { slots: null, appCardOrder: null };
  }
}

async function saveServerPrefs(
  slots: WidgetSlot[],
  appCardOrder: string[],
): Promise<void> {
  try {
    await updatePreferences({ slots, appCardOrder });
  } catch {
    /* silent — localStorage still has it */
  }
}

function genIid(): string {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────
/**
 * Manages the ordered list of dashboard widget slots AND app card order.
 *
 * A slot is either:
 *  - StaticSlot  { t:"s", id }           — one of the catalogue widgets
 *  - RssSlot     { t:"r", iid, title, url } — a user-configured RSS instance
 *
 * Persistence: localStorage (immediate) + server PUT (debounced 800 ms).
 * Server is authoritative on mount: fetch overrides localStorage so both users
 * in a household keep completely independent layouts.
 */
export function useWidgets() {
  const [slots, setSlotsRaw] = useState<WidgetSlot[]>(
    () => readLocalStorage() ?? DEFAULT_SLOTS,
  );
  const [appCardOrder, setAppCardOrderRaw] = useState<string[]>(
    () => readCardOrderLocalStorage() ?? [...DEFAULT_APP_CARD_ORDER],
  );
  const [serverReady, setServerReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Keep a ref so debounced saves always see latest values
  const latestSlotsRef = useRef(slots);
  const latestOrderRef = useRef(appCardOrder);
  latestSlotsRef.current = slots;
  latestOrderRef.current = appCardOrder;

  // Hydrate from server on mount
  useEffect(() => {
    fetchServerPrefs().then((prefs) => {
      if (prefs.slots !== null) {
        setSlotsRaw(prefs.slots);
        writeLocalStorage(prefs.slots);
      }
      if (prefs.appCardOrder !== null) {
        setAppCardOrderRaw(prefs.appCardOrder);
        writeCardOrderLocalStorage(prefs.appCardOrder);
      }
      setServerReady(true);
    });
  }, []);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveServerPrefs(latestSlotsRef.current, latestOrderRef.current);
    }, 800);
  }, []);

  const setSlots = useCallback(
    (updater: WidgetSlot[] | ((prev: WidgetSlot[]) => WidgetSlot[])) => {
      setSlotsRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        writeLocalStorage(next);
        if (serverReady) scheduleSave();
        return next;
      });
    },
    [serverReady, scheduleSave],
  );

  const setAppCardOrder = useCallback(
    (order: string[]) => {
      setAppCardOrderRaw(order);
      writeCardOrderLocalStorage(order);
      if (serverReady) scheduleSave();
    },
    [serverReady, scheduleSave],
  );

  const byId = useMemo(() => {
    const map = new Map<string, WidgetEntry>();
    for (const w of WIDGETS) map.set(w.id, w);
    return map;
  }, []);

  const enabledStaticIds = useMemo(
    () =>
      new Set(
        slots.filter((s): s is StaticSlot => s.t === "s").map((s) => s.id),
      ),
    [slots],
  );

  const isStaticEnabled = useCallback(
    (id: string) => enabledStaticIds.has(id),
    [enabledStaticIds],
  );

  const toggleStatic = useCallback(
    (id: string) => {
      setSlots((prev) =>
        prev.some((s) => s.t === "s" && s.id === id)
          ? prev.filter((s) => !(s.t === "s" && s.id === id))
          : [...prev, { t: "s", id }],
      );
    },
    [setSlots],
  );

  /** Add a new RSS widget instance; returns the generated instanceId. */
  const addRss = useCallback((): string => {
    const iid = genIid();
    setSlots((prev) => [...prev, { t: "r", iid, title: "", url: "" }]);
    return iid;
  }, [setSlots]);

  const updateRss = useCallback(
    (iid: string, config: Partial<Pick<RssSlot, "title" | "url">>) => {
      setSlots((prev) =>
        prev.map((s) =>
          s.t === "r" && s.iid === iid ? { ...s, ...config } : s,
        ),
      );
    },
    [setSlots],
  );

  /** Remove a slot by its `id` (static) or `iid` (RSS). */
  const removeSlot = useCallback(
    (key: string) => {
      setSlots((prev) =>
        prev.filter((s) => (s.t === "s" ? s.id !== key : s.iid !== key)),
      );
    },
    [setSlots],
  );

  const resetWidgets = useCallback(() => {
    setSlots(DEFAULT_SLOTS);
  }, [setSlots]);

  return {
    slots,
    appCardOrder,
    setAppCardOrder,
    byId,
    isStaticEnabled,
    toggleStatic,
    addRss,
    updateRss,
    removeSlot,
    resetWidgets,
    serverReady,
    totalCount: slots.length,
  };
}
