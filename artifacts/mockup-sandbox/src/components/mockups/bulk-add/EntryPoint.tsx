import { Camera, Plus, Layers, Search, SortAsc } from "lucide-react";

const stats = [
  { label: "Fabrics", value: 46, active: true },
  { label: "Patterns", value: 0 },
  { label: "Quilts", value: 0 },
  { label: "Blocks", value: 13 },
  { label: "Layouts", value: 1 },
];

const fabrics = [
  { name: "Moda Grunge Basics — Bluebell", type: "Solid", color: "#b3c9e8" },
  { name: "Red Geometric Cotton Print", type: "Geometric", color: "#e87a7a" },
  { name: "Forest Flora Batik", type: "Batik", color: "#7ab87a" },
  { name: "Cream Linen Texture", type: "Solid", color: "#e8d9b3" },
];

export function EntryPoint() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1 text-[11px] text-muted-foreground">
        <span>9:41</span>
        <span>●●●</span>
      </div>

      <div className="px-4 pb-6">
        {/* Stats bar */}
        <div className="mb-5 grid grid-cols-5 gap-2">
          {stats.map(({ label, value, active }) => (
            <div
              key={label}
              className={`rounded-xl border p-3 ${
                active
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/50 bg-card"
              }`}
            >
              <p
                className={`text-lg font-bold ${active ? "text-primary" : "text-foreground"}`}
              >
                {value}
              </p>
              <p className="text-[10px] font-medium text-muted-foreground leading-tight mt-0.5">
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* Page header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Fabrics</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              46 in your stash
            </p>
          </div>

          {/* Action buttons — the key change */}
          <div className="flex items-center gap-2">
            {/* NEW: Bulk Add button */}
            <button className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm active:opacity-80">
              <Camera className="h-3.5 w-3.5 text-primary" />
              <span>Bulk Add</span>
            </button>
            {/* Existing: single add */}
            <button className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm active:opacity-80">
              <Plus className="h-3.5 w-3.5" />
              <span>Add fabric</span>
            </button>
          </div>
        </div>

        {/* Search row */}
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <div className="h-9 rounded-lg border border-border/60 bg-card pl-9 flex items-center">
              <span className="text-xs text-muted-foreground">
                Search fabrics…
              </span>
            </div>
          </div>
          <button className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 text-xs text-muted-foreground">
            <SortAsc className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Fabric grid (2 col) */}
        <div className="grid grid-cols-2 gap-3">
          {fabrics.map((f) => (
            <div
              key={f.name}
              className="rounded-xl border border-border/50 bg-card overflow-hidden"
            >
              <div
                className="aspect-square"
                style={{ backgroundColor: f.color + "60" }}
              />
              <div className="p-2.5">
                <p className="text-[11px] font-semibold text-foreground truncate">
                  {f.name}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {f.type}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
