import { RefreshCw, Search, SortAsc, Plus, Camera } from "lucide-react";

type Status = "processing" | "done";

interface Fabric {
  id: number;
  name: string;
  type: string;
  color: string;
  status?: Status;
}

const fabrics: Fabric[] = [
  // Newly added — still processing
  { id: 1, name: "", type: "", color: "#e8d4b3", status: "processing" },
  { id: 2, name: "", type: "", color: "#c9b3e8", status: "processing" },
  { id: 3, name: "", type: "", color: "#e87a7a", status: "processing" },
  // Existing fabrics already in collection
  { id: 4, name: "Blue Floral Batik", type: "Batik", color: "#b3c9e8" },
  { id: 5, name: "Moda Grunge Basics — Bluebell", type: "Solid", color: "#9bc4e8" },
  { id: 6, name: "Red Geometric Cotton Print", type: "Geometric", color: "#e89b9b" },
  { id: 7, name: "Forest Flora Batik", type: "Batik", color: "#7ab87a" },
  { id: 8, name: "Cream Linen Texture", type: "Solid", color: "#e8d9b3" },
];

const processingCount = fabrics.filter((f) => f.status === "processing").length;

export function FabricsAfterDone() {
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
          {[
            { label: "Fabrics", value: 49, active: true },
            { label: "Patterns", value: 0 },
            { label: "Quilts", value: 0 },
            { label: "Blocks", value: 13 },
            { label: "Layouts", value: 1 },
          ].map(({ label, value, active }) => (
            <div
              key={label}
              className={`rounded-xl border p-3 ${
                active ? "border-primary/40 bg-primary/5" : "border-border/50 bg-card"
              }`}
            >
              <p className={`text-lg font-bold ${active ? "text-primary" : "text-foreground"}`}>
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
            <p className="text-xs text-muted-foreground mt-0.5">49 in your stash</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm">
              <Camera className="h-3.5 w-3.5 text-primary" />
              <span>Bulk Add</span>
            </button>
            <button className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm">
              <Plus className="h-3.5 w-3.5" />
              <span>Add fabric</span>
            </button>
          </div>
        </div>

        {/* Processing banner */}
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <p className="text-xs font-medium text-primary">
            Adding {processingCount} fabrics — AI cataloguing in progress…
          </p>
        </div>

        {/* Search row */}
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <div className="h-9 rounded-lg border border-border/60 bg-card pl-9 flex items-center">
              <span className="text-xs text-muted-foreground">Search fabrics…</span>
            </div>
          </div>
          <button className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 text-xs text-muted-foreground">
            <SortAsc className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Fabric grid */}
        <div className="grid grid-cols-2 gap-3">
          {fabrics.map((fabric) => {
            const isProcessing = fabric.status === "processing";
            return (
              <div
                key={fabric.id}
                className={`relative rounded-xl border bg-card overflow-hidden transition-all ${
                  isProcessing
                    ? "border-primary/40 animate-pulse"
                    : "border-border/50"
                }`}
              >
                {/* Image area */}
                <div
                  className="relative aspect-square"
                  style={{ backgroundColor: fabric.color + (isProcessing ? "80" : "60") }}
                >
                  {/* Spinning badge — top-right, same as bulk-analyze maintenance page */}
                  {isProcessing && (
                    <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    </span>
                  )}
                </div>

                {/* Info area */}
                <div className="p-2.5">
                  {isProcessing ? (
                    <>
                      <div className="h-2.5 w-3/4 rounded-full bg-muted mb-1.5" />
                      <div className="h-2 w-1/2 rounded-full bg-muted/60" />
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold text-foreground truncate">{fabric.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{fabric.type}</p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
