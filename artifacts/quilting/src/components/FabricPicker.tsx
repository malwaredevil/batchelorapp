import { useState, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Lightweight structural type — avoids importing from @workspace/api-client-react
// in a shared component.
// ---------------------------------------------------------------------------
export interface FabricItem {
  id: number;
  name: string;
  imageUrl?: string | null;
  dominantColors?: string[] | null;
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
    if (f.imageUrl) map[f.id] = f.imageUrl;
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
 * - Hovering shows a magnified preview popup to the left of the item.
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
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const filtered = (fabrics ?? []).filter((f) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      (f.dominantColors ?? []).some((c) => c.toLowerCase().includes(q))
    );
  });

  function onEnter(id: number) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredId(id), 250);
  }
  function onLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredId(null);
  }

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
                    src={item.imageUrl}
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
          const isHovered = hoveredId === fabric.id;

          return (
            <div
              key={fabric.id}
              className="relative"
              onMouseEnter={() => onEnter(fabric.id)}
              onMouseLeave={onLeave}
            >
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
                    src={fabric.imageUrl}
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

              {/* Hover magnification — shows to the left of the panel */}
              {isHovered && fabric.imageUrl && (
                <div
                  className="pointer-events-none absolute right-full top-0 z-50 mr-2 overflow-hidden rounded-lg border border-border bg-background shadow-xl"
                  style={{ width: 160, height: 160 }}
                >
                  <img
                    src={fabric.imageUrl}
                    alt={fabric.name}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                    <p className="truncate text-[10px] text-white">
                      {fabric.name}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
