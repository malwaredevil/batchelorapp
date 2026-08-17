import { useState, useMemo } from "react";
import { Search, X as XIcon, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { appendScreenshotToken } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Lightweight structural type — avoids importing generated API types from
// @workspace/api-client-react in a shared component (the token helper below
// is a plain utility export, not a generated type, so it's fine to import).
// ---------------------------------------------------------------------------

export interface FabricCategory {
  id: number;
  name: string;
  bgColor?: string | null;
  textColor?: string | null;
}

export interface FabricItem {
  id: number;
  name: string;
  imageUrl?: string | null;
  tileImageUrl?: string | null;
  dominantColors?: string[] | null;
  categories?: FabricCategory[] | null;
}

export interface FabricTallyItem {
  fabricId: number;
  name: string;
  imageUrl: string | null;
  count: number;
}

// ---------------------------------------------------------------------------
// Pure helpers — usable outside the component
// ---------------------------------------------------------------------------

/**
 * Scan a cell array and count how many times each fabric appears.
 * Returns sorted by count descending.
 */
export function computeFabricTally(
  cells: string[],
  fabrics: FabricItem[],
): FabricTallyItem[] {
  const counts = new Map<number, number>();
  for (const cell of cells) {
    if (cell.startsWith("fab:")) {
      const id = parseInt(cell.slice(4), 10);
      if (!isNaN(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return [];
  return Array.from(counts.entries())
    .map(([id, count]) => {
      const fabric = fabrics.find((f) => f.id === id);
      if (!fabric) return null;
      return {
        fabricId: id,
        name: fabric.name,
        imageUrl: fabric.imageUrl ?? null,
        count,
      };
    })
    .filter((x): x is FabricTallyItem => x !== null)
    .sort((a, b) => b.count - a.count);
}

/**
 * Build a map from fabric ID → signed image URL for SVG <pattern> rendering.
 * Fabrics without an image URL are omitted.
 */
export function buildFabricUrlMap(
  fabrics: FabricItem[],
): Record<number, string> {
  const map: Record<number, string> = {};
  for (const f of fabrics) {
    // Use the full fabric photo so the pattern shows the fabric at a natural
    // zoom level (not the small zoomed-in vectorized tile). Falls back to the
    // tile-image endpoint if no photo URL is available.
    const url =
      f.imageUrl ??
      (f.id ? `/api/quilting/fabrics/${f.id}/tile-image.png` : f.tileImageUrl);
    // These URLs feed raw SVG `<image href>` pattern fills, which can't
    // attach the X-Screenshot-Token header — append it as a query param
    // (no-op for normal users) so the automated screenshot tool can render
    // fabric fills too. See `appendScreenshotToken()` for details.
    if (url) map[f.id] = appendScreenshotToken(url);
  }
  return map;
}

// ---------------------------------------------------------------------------
// FabricPicker component
// ---------------------------------------------------------------------------

/**
 * Shared fabric picker panel used by the Block Designer, Whole-Quilt Designer,
 * and Layout Composer.
 *
 * - Shows a searchable list of fabrics with thumbnails.
 * - Clicking a fabric selects it as `fab:{id}`.
 * - Shows a "Used fabrics" tally strip at the top when provided.
 */
export function FabricPicker({
  fabrics,
  activeValue,
  onSelect,
  tally = [],
  placeholder = "Stamp with fabric",
}: {
  fabrics: FabricItem[] | undefined;
  activeValue: string;
  onSelect: (val: string) => void;
  tally?: FabricTallyItem[];
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<number>>(
    new Set(),
  );

  // Derive sorted unique categories from all fabrics
  const allCategories = useMemo<FabricCategory[]>(() => {
    if (!fabrics) return [];
    const seen = new Map<number, FabricCategory>();
    for (const f of fabrics) {
      for (const cat of f.categories ?? []) {
        if (!seen.has(cat.id)) seen.set(cat.id, cat);
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [fabrics]);

  function toggleCategory(id: number) {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = (fabrics ?? []).filter((f) => {
    // Text search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchesText =
        f.name.toLowerCase().includes(q) ||
        (f.dominantColors ?? []).some((c) => c.toLowerCase().includes(q));
      if (!matchesText) return false;
    }
    // Category chip filter (OR logic across selected chips)
    if (selectedCategoryIds.size > 0) {
      const fabricCatIds = new Set((f.categories ?? []).map((c) => c.id));
      const matchesCategory = Array.from(selectedCategoryIds).some((id) =>
        fabricCatIds.has(id),
      );
      if (!matchesCategory) return false;
    }
    return true;
  });

  return (
    <div className="space-y-2">
      {/* ── Used-fabrics tally ─── */}
      {tally.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Used in this design
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tally.map((item) => (
              <button
                key={item.fabricId}
                title={`${item.name} — ${item.count} cell${item.count !== 1 ? "s" : ""}`}
                onClick={() => onSelect(`fab:${item.fabricId}`)}
                className={`relative flex flex-col items-center gap-0.5 rounded p-0.5 transition-colors hover:bg-muted/60 ${
                  activeValue === `fab:${item.fabricId}`
                    ? "ring-2 ring-primary ring-offset-1"
                    : ""
                }`}
              >
                {item.imageUrl ? (
                  <img
                    src={appendScreenshotToken(item.imageUrl)}
                    alt={item.name}
                    className="h-9 w-9 rounded-sm object-cover shadow-sm"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-sm bg-muted" />
                )}
                <span className="text-[9px] tabular-nums text-muted-foreground">
                  ×{item.count}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 border-t border-border/50" />
        </div>
      )}

      {/* ── Label ─── */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {placeholder}
      </p>

      {/* ── Search ─── */}
      <div className="relative">
        <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fabrics…"
          className="h-7 pl-6 text-xs"
        />
      </div>

      {/* ── Category chip filter ─── */}
      {allCategories.length > 0 && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            {allCategories.map((cat) => {
              const isSelected = selectedCategoryIds.has(cat.id);
              const hasBgColor = !!cat.bgColor;
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  title={cat.name}
                  className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
                    isSelected
                      ? hasBgColor
                        ? "ring-2 ring-offset-1 ring-primary/60 opacity-100"
                        : "bg-primary/15 text-primary ring-1 ring-primary/40"
                      : hasBgColor
                        ? "opacity-60 hover:opacity-90"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  }`}
                  style={
                    hasBgColor
                      ? {
                          backgroundColor: cat.bgColor ?? undefined,
                          color: cat.textColor ?? undefined,
                        }
                      : undefined
                  }
                >
                  {isSelected && <Check className="h-2.5 w-2.5 shrink-0" />}
                  {cat.name}
                </button>
              );
            })}
          </div>
          {selectedCategoryIds.size > 0 && (
            <button
              onClick={() => setSelectedCategoryIds(new Set())}
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <XIcon className="h-2.5 w-2.5" />
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ── Loading ─── */}
      {!fabrics && (
        <div className="space-y-1.5 pt-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-10 w-10 rounded" />
              <Skeleton className="h-3 flex-1 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* ── Empty / no-match ─── */}
      {fabrics?.length === 0 && (
        <p className="py-2 text-center text-[11px] text-muted-foreground">
          No fabrics yet. Add some in the Fabrics section.
        </p>
      )}
      {fabrics && fabrics.length > 0 && filtered.length === 0 && (
        <p className="py-2 text-center text-[11px] text-muted-foreground">
          No fabrics match your search.
        </p>
      )}

      {/* ── Fabric list ─── */}
      <div className="space-y-0.5">
        {filtered.map((fabric) => {
          const fabValue = `fab:${fabric.id}`;
          const isActive = activeValue === fabValue;

          return (
            <div key={fabric.id} className="relative">
              <button
                onClick={() => onSelect(fabValue)}
                className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/40 ${
                  isActive
                    ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                    : ""
                }`}
              >
                {/* Thumbnail */}
                {fabric.imageUrl ? (
                  <img
                    src={appendScreenshotToken(fabric.imageUrl)}
                    alt={fabric.name}
                    className="h-9 w-9 shrink-0 rounded-sm object-cover ring-1 ring-inset ring-black/10"
                    style={
                      isActive
                        ? {
                            outline: "2px solid hsl(var(--primary))",
                            outlineOffset: 1,
                          }
                        : {}
                    }
                  />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded-sm bg-muted ring-1 ring-inset ring-black/10" />
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className="truncate text-[10px] font-medium leading-tight text-foreground"
                    title={fabric.name}
                  >
                    {fabric.name}
                  </span>
                  {/* Dominant colour dots */}
                  {(fabric.dominantColors ?? []).length > 0 && (
                    <div className="flex gap-0.5">
                      {(fabric.dominantColors ?? []).slice(0, 5).map((c, i) => (
                        <span
                          key={i}
                          className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {isActive && (
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-primary">
                    ✓
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
