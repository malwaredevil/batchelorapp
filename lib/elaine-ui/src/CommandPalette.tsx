import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Search, Clock, MapPin, Package, Scissors, X } from "lucide-react";

const OPEN_EVENT = "batchelor:open-command-palette";

/**
 * Opens the CommandPalette from anywhere in the app (e.g. a nav bar search
 * button) without needing shared state — CommandPalette listens for this
 * event globally.
 */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * Small nav-bar affordance that makes the command palette discoverable.
 * Shows a "Search... ⌘K" pill on desktop and a bare search icon on mobile.
 */
export function SearchTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Search"
      title="Search"
      className={
        className ??
        "flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      }
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="hidden items-center gap-1 sm:inline-flex">
        Search
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none">
          ⌘K
        </kbd>
      </span>
    </button>
  );
}

interface SearchResult {
  id: number;
  title: string;
  subtitle?: string;
  url: string;
}

interface SearchGroup {
  type: string;
  label: string;
  results: SearchResult[];
}

interface FlatItem {
  id: number;
  title: string;
  subtitle?: string;
  url: string;
  type: string;
}

interface RecentItem {
  title: string;
  subtitle?: string;
  url: string;
  type: string;
}

const RECENT_KEY = "batchelor-cmd-recent";
const MAX_RECENT = 5;

function loadRecent(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(item: RecentItem) {
  const existing = loadRecent().filter((r) => r.url !== item.url);
  localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...existing].slice(0, MAX_RECENT)));
}

function ResultIcon({ type }: { type: string }) {
  if (type === "travels_trip" || type === "travels_reminder") {
    return <MapPin className="h-4 w-4 shrink-0" style={{ color: "#3b82f6" }} />;
  }
  if (type === "pottery") {
    return <Package className="h-4 w-4 shrink-0" style={{ color: "#f97316" }} />;
  }
  if (type.startsWith("quilting")) {
    return <Scissors className="h-4 w-4 shrink-0" style={{ color: "#a855f7" }} />;
  }
  return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hasQuery = query.trim().length > 0;

  const allItems = useMemo<FlatItem[]>(() => {
    if (hasQuery) {
      return groups.flatMap((g) => g.results.map((r) => ({ ...r, type: g.type })));
    }
    return recent.map((r) => ({ ...r, id: 0 }));
  }, [groups, recent, hasQuery]);

  const openPalette = useCallback(() => {
    setRecent(loadRecent());
    setQuery("");
    setGroups([]);
    setSelectedIndex(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  const navigate = useCallback(
    (url: string, item: Omit<RecentItem, "url">) => {
      saveRecent({ ...item, url });
      closePalette();
      window.location.href = url;
    },
    [closePalette],
  );

  // cmd+K / ctrl+K global shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) return false;
          setRecent(loadRecent());
          setQuery("");
          setGroups([]);
          setSelectedIndex(0);
          return true;
        });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Allow opening from outside (e.g. a nav bar search button) via openCommandPalette()
  useEffect(() => {
    function onOpenRequest() {
      openPalette();
    }
    window.addEventListener(OPEN_EVENT, onOpenRequest);
    return () => window.removeEventListener(OPEN_EVENT, onOpenRequest);
  }, [openPalette]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePalette();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, closePalette]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=24`);
        if (res.ok) {
          const data = (await res.json()) as { groups: SearchGroup[] };
          setGroups(data.groups ?? []);
          setSelectedIndex(0);
        }
      } catch {
        // silently ignore fetch errors
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closePalette();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const item = allItems[selectedIndex];
        if (item) navigate(item.url, item);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, allItems, selectedIndex, navigate, closePalette]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  let flatIdx = 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
        paddingLeft: "1rem",
        paddingRight: "1rem",
      }}
    >
      <div
        ref={containerRef}
        style={{ width: "100%", maxWidth: "600px" }}
        className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        {/* Input row */}
        <div className="flex items-center gap-2 px-4 border-b border-border">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search trips, pottery, fabrics…"
            className="flex-1 bg-transparent py-4 text-sm text-foreground placeholder:text-muted-foreground outline-none"
            aria-label="Search"
          />
          {loading ? (
            <div
              className="h-4 w-4 shrink-0 rounded-full border-2 border-t-transparent border-muted-foreground animate-spin"
            />
          ) : (
            <button
              onClick={closePalette}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Result list */}
        <div ref={listRef} className="max-h-[26rem] overflow-y-auto">
          {hasQuery ? (
            groups.length === 0 && !loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No results for &ldquo;{query}&rdquo;
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.type}>
                  <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </div>
                  {group.results.map((result) => {
                    const fi = flatIdx++;
                    return (
                      <button
                        key={`${group.type}-${result.id}`}
                        data-idx={fi}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          fi === selectedIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50 text-foreground"
                        }`}
                        onClick={() =>
                          navigate(result.url, {
                            title: result.title,
                            subtitle: result.subtitle,
                            type: group.type,
                          })
                        }
                        onMouseEnter={() => setSelectedIndex(fi)}
                      >
                        <ResultIcon type={group.type} />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate font-medium">{result.title}</span>
                          {result.subtitle && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {result.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )
          ) : recent.length > 0 ? (
            <div>
              <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Recent
              </div>
              {recent.map((item, i) => (
                <button
                  key={i}
                  data-idx={i}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50 text-foreground"
                  }`}
                  onClick={() => navigate(item.url, item)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{item.title}</span>
                    {item.subtitle && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                  <ResultIcon type={item.type} />
                </button>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Start typing to search across trips, pottery, and fabrics
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono text-xs">esc</kbd>
            close
          </span>
          <span className="ml-auto opacity-60">Batchelor Search</span>
        </div>
      </div>
    </div>
  );
}
