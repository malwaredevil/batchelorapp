import { Camera, CheckCircle2, Loader2, X, ArrowLeft, AlertCircle } from "lucide-react";

type ItemStatus = "processing" | "done" | "error";

interface QueueItem {
  id: number;
  thumb: string;
  status: ItemStatus;
  name?: string;
}

const queueItems: QueueItem[] = [
  { id: 1, thumb: "#b3c9e8", status: "done",       name: "Blue Floral Batik" },
  { id: 2, thumb: "#e8d4b3", status: "done",       name: "Cream Linen Texture" },
  { id: 3, thumb: "#e87a7a", status: "processing"  },
  { id: 4, thumb: "#7ab87a", status: "processing"  },
];

const doneCount  = queueItems.filter((i) => i.status === "done").length;
const totalCount = queueItems.length;

export function BulkCapture() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground font-sans overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0 text-[11px] text-muted-foreground shrink-0">
        <span>9:41</span>
        <span>●●●</span>
      </div>

      {/* Nav bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <button className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          <span>Fabrics</span>
        </button>
        <h1 className="text-sm font-semibold">Bulk Add</h1>
        <button className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Capture zone ── */}
      <div className="mx-4 mb-4 shrink-0">
        <div className="relative flex aspect-[4/3] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-card">
          {/* Corner accents */}
          <div className="absolute left-3 top-3 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-primary/60" />
          <div className="absolute right-3 top-3 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-primary/60" />
          <div className="absolute bottom-3 left-3 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-primary/60" />
          <div className="absolute bottom-3 right-3 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-primary/60" />

          {/* Camera icon */}
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Camera className="h-7 w-7 text-primary" />
          </div>
          <p className="text-sm font-semibold text-foreground">Tap to capture</p>
          <p className="mt-1 text-xs text-muted-foreground">Tap again after each shot to add more</p>

          {/* Count badge */}
          <div className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {totalCount} captured
          </div>
        </div>
      </div>

      {/* ── Action button ── */}
      <div className="mx-4 mb-5 shrink-0">
        <button className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground shadow-sm">
          Done
        </button>
      </div>

      {/* ── Processing queue ── */}
      <div className="mx-4 shrink-0 mb-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Processing queue
          </p>
          <p className="text-xs text-muted-foreground">
            {doneCount}/{totalCount} saved
          </p>
        </div>
      </div>

      <div className="mx-4 flex-1 space-y-2 overflow-y-auto pb-6">
        {queueItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2.5"
          >
            {/* Thumbnail swatch */}
            <div
              className="h-10 w-10 shrink-0 rounded-lg"
              style={{ backgroundColor: item.thumb }}
            />

            {/* Label */}
            <div className="flex-1 min-w-0">
              {item.status === "done" ? (
                <>
                  <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">Saved to collection</p>
                </>
              ) : item.status === "error" ? (
                <>
                  <p className="truncate text-sm font-medium text-destructive">Upload failed</p>
                  <p className="text-[10px] text-muted-foreground">Tap to retry</p>
                </>
              ) : (
                <>
                  <p className="truncate text-sm font-medium text-muted-foreground">Analysing…</p>
                  <p className="text-[10px] text-muted-foreground">AI cataloguing in progress</p>
                </>
              )}
            </div>

            {/* Status icon */}
            {item.status === "done" && (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
            )}
            {item.status === "processing" && (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
            )}
            {item.status === "error" && (
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
