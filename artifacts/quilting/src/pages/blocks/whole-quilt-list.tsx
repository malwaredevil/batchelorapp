import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  PlusCircle,
  Search,
  X,
  MoreVertical,
  SortAsc,
  SortDesc,
  Trash2,
  Copy,
  Download,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  loadAllDesigns,
  deleteDesignById,
  upsertDesign,
  migrateFromLegacy,
  buildWholequiltThumbnailSvg,
  type WholequiltDesign,
} from "@/lib/whole-quilt-storage";
import { downloadSvgAsJpeg } from "@/lib/svg-export";

type SortOption = "newest" | "oldest" | "az" | "za";

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  az: "Name A → Z",
  za: "Name Z → A",
};

function thumbnailDataUri(design: WholequiltDesign): string {
  const svg = buildWholequiltThumbnailSvg(design, 240);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function DesignCard({
  design,
  onDelete,
  onDuplicate,
  onExport,
}: {
  design: WholequiltDesign;
  onDelete: (id: string) => void;
  onDuplicate: (design: WholequiltDesign) => void;
  onExport: (design: WholequiltDesign) => void;
}) {
  const [, navigate] = useLocation();
  const thumb = thumbnailDataUri(design);
  const totalCols = design.quiltCols * design.blockGridSize;
  const totalRows = design.quiltRows * design.blockGridSize;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-card-border bg-card transition-shadow hover:shadow-md">
      <button
        className="block w-full text-left"
        onClick={() => navigate(`/whole-quilt/designer?id=${design.id}`)}
      >
        <div className="aspect-square overflow-hidden bg-muted">
          <img
            src={thumb}
            alt={design.name}
            className="h-full w-full object-contain transition-transform group-hover:scale-105"
          />
        </div>
        <div className="p-3 pr-8">
          <p className="truncate text-sm font-semibold text-foreground">
            {design.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {design.quiltCols}×{design.quiltRows} blocks · {totalCols}×
            {totalRows} cells
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDate(design.updatedAt || design.createdAt)}
          </p>
        </div>
      </button>

      <div className="absolute right-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full bg-background/80 opacity-100 shadow-sm transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" />
              <span className="sr-only">Options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => navigate(`/whole-quilt/designer?id=${design.id}`)}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(design)}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport(design)}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Export as JPEG
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(design.id)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function WholeQuiltList() {
  const [, navigate] = useLocation();
  const [designs, setDesigns] = useState<WholequiltDesign[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("newest");

  // Load designs (migrating from legacy single-design format if needed)
  useEffect(() => {
    migrateFromLegacy();
    setDesigns(loadAllDesigns());
  }, []);

  function reload() {
    setDesigns(loadAllDesigns());
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this quilt design? This cannot be undone.")) return;
    deleteDesignById(id);
    reload();
    toast.success("Design deleted");
  }

  function handleDuplicate(design: WholequiltDesign) {
    const now = new Date().toISOString();
    const copy: WholequiltDesign = {
      ...design,
      id: crypto.randomUUID(),
      name: `${design.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    upsertDesign(copy);
    reload();
    toast.success("Design duplicated");
  }

  async function handleExport(design: WholequiltDesign) {
    const svg = buildWholequiltThumbnailSvg(design, 1200);
    const filename = `${design.name || "quilt-design"}.jpg`;
    try {
      await downloadSvgAsJpeg(svg, filename);
      toast.success("Exported!");
    } catch {
      toast.error("Export failed.");
    }
  }

  // Filter + sort
  const filtered = designs
    .filter(
      (d) => !search || d.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "az") return a.name.localeCompare(b.name);
      if (sort === "za") return b.name.localeCompare(a.name);
      if (sort === "oldest")
        return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return (b.updatedAt ?? b.createdAt ?? "").localeCompare(
        a.updatedAt ?? a.createdAt ?? "",
      );
    });

  const sortIcon =
    sort.startsWith("a") || sort === "newest" ? (
      <SortDesc className="h-3.5 w-3.5" />
    ) : (
      <SortAsc className="h-3.5 w-3.5" />
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Whole-Quilt Designs</h1>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => navigate("/whole-quilt/designer?new=1")}
        >
          <PlusCircle className="mr-1.5 h-4 w-4" />
          New design
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search designs…"
            className="pl-9 pr-8"
          />
          {search && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              {sortIcon}
              <span className="ml-1.5 hidden sm:inline">
                {SORT_LABELS[sort]}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.entries(SORT_LABELS) as [SortOption, string][]).map(
              ([key, label]) => (
                <DropdownMenuItem key={key} onClick={() => setSort(key)}>
                  {label}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-20 text-center">
          {designs.length === 0 ? (
            <>
              <p className="text-muted-foreground">No quilt designs yet.</p>
              <Button onClick={() => navigate("/whole-quilt/designer?new=1")}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Create your first design
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              No designs match your search.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((design) => (
            <DesignCard
              key={design.id}
              design={design}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onExport={handleExport}
            />
          ))}
        </div>
      )}
    </div>
  );
}
