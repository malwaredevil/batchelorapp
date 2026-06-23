import { useState, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  Trash2,
  Pencil,
  Lock,
  LockOpen,
  RefreshCw,
  Check,
  X as XIcon,
  Tag,
  Download,
  ZoomIn,
  Sparkles,
  Grid3x3,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetPattern,
  useDeletePattern,
  useUpdatePattern,
  useReanalyzePattern,
  useEnrichPattern,
  useExtractPatternBlocks,
  useListQuiltingCategories,
  getListPatternsQueryKey,
  getGetPatternQueryKey,
  type QuiltingExtractBlocksResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/components/tag-selector";
import { ImageLightbox } from "@/components/image-lightbox";
import { downloadCollectionImage } from "@/lib/svg-export";

type PatternData = {
  id: number;
  name: string;
  designer?: string | null;
  blockSize?: string | null;
  difficulty?: string | null;
  sourceType?: string | null;
  sourceReference?: string | null;
  notes?: string | null;
  acquiredAt?: string | null;
  designerBio?: string | null;
  designerWebsite?: string | null;
  publicationName?: string | null;
  publicationYear?: string | null;
  lockedFields: string[];
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  imageUrl?: string | null;
};

const AI_FIELDS = ["name", "designer", "blockSize", "difficulty", "notes"];

function LockButton({
  field,
  lockedFields,
  onToggle,
}: {
  field: string;
  lockedFields: string[];
  onToggle: (f: string) => void;
}) {
  const locked = lockedFields.includes(field);
  return (
    <button
      onClick={() => onToggle(field)}
      title={
        locked
          ? "AI will not change this — click to unlock"
          : "AI may update this — click to lock"
      }
      className={`ml-1 rounded p-0.5 transition-colors ${locked ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/25 hover:text-muted-foreground/60"}`}
    >
      {locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
    </button>
  );
}

export default function PatternDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const patternId = Number(id);

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [extractedBlocks, setExtractedBlocks] =
    useState<QuiltingExtractBlocksResult | null>(null);
  const [showExtracted, setShowExtracted] = useState(false);
  const rawSearch = useSearch();
  useEffect(() => {
    if (new URLSearchParams(rawSearch).get("edit") === "1") setIsEditing(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState({
    name: "",
    designer: "",
    blockSize: "",
    difficulty: "",
    sourceType: "",
    sourceReference: "",
    notes: "",
    acquiredAt: "",
  });

  const { data: pattern, isLoading, isError } = useGetPattern(patternId);
  const { data: allCategories } = useListQuiltingCategories();

  const deletePattern = useDeletePattern({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        queryClient.removeQueries({
          queryKey: getGetPatternQueryKey(patternId),
        });
        toast.success("Pattern deleted");
        navigate("/patterns");
      },
      onError: () => toast.error("Failed to delete pattern."),
    },
  });

  const updatePattern = useUpdatePattern({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetPatternQueryKey(patternId), data);
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast.success("Saved");
        setIsEditing(false);
      },
      onError: () => toast.error("Failed to save."),
    },
  });

  const reanalyzePattern = useReanalyzePattern({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetPatternQueryKey(patternId), data);
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast.success("AI analysis refreshed");
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(
          msg.includes("no image")
            ? "This pattern has no image to analyse."
            : "Failed to refresh AI analysis.",
        );
      },
    },
  });

  const enrichPattern = useEnrichPattern({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetPatternQueryKey(patternId), data);
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast.success("Designer info enriched");
      },
      onError: () => toast.error("Failed to enrich designer info."),
    },
  });

  const extractBlocks = useExtractPatternBlocks({
    mutation: {
      onSuccess: (data) => {
        setExtractedBlocks(data);
        setShowExtracted(true);
        toast.success("Block schema extracted");
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(
          msg.includes("no image")
            ? "This pattern has no image to extract blocks from."
            : "Failed to extract block schema.",
        );
      },
    },
  });

  function enterEdit() {
    if (!pattern) return;
    const p = pattern as unknown as PatternData;
    setDraft({
      name: p.name,
      designer: p.designer ?? "",
      blockSize: p.blockSize ?? "",
      difficulty: p.difficulty ?? "",
      sourceType: p.sourceType ?? "",
      sourceReference: p.sourceReference ?? "",
      notes: p.notes ?? "",
      acquiredAt: p.acquiredAt ?? "",
    });
    setSelectedCategoryIds(p.categories.map((c) => c.id));
    setIsEditing(true);
  }

  function handleSave() {
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCategoryIds.includes(c.id))
      .map((c) => c.name);
    updatePattern.mutate({
      id: patternId,
      data: {
        name: draft.name || undefined,
        designer: draft.designer || null,
        blockSize: draft.blockSize || null,
        difficulty: draft.difficulty || null,
        sourceType: draft.sourceType || null,
        sourceReference: draft.sourceReference || null,
        notes: draft.notes || null,
        acquiredAt: draft.acquiredAt || null,
        categories: categoryNames,
      },
    });
  }

  function toggleLock(field: string) {
    if (!pattern) return;
    const p = pattern as unknown as PatternData;
    const current = p.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((x) => x !== field)
      : [...current, field];
    updatePattern.mutate({ id: patternId, data: { lockedFields: next } });
    toast.success(
      next.includes(field) ? `"${field}" locked` : `"${field}" unlocked`,
    );
  }

  function handleRefreshAI() {
    reanalyzePattern.mutate({ id: patternId });
    toast.info("Refreshing AI analysis…");
  }

  if (isLoading) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/patterns")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !pattern) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Pattern not found.</p>
        <Button variant="outline" onClick={() => navigate("/patterns")}>
          Back
        </Button>
      </div>
    );
  }

  const p = pattern as unknown as PatternData;
  const lockedFields = p.lockedFields ?? [];
  const d = draft;
  const set = (k: keyof typeof draft, v: string) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/patterns")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="flex-1 truncate text-xl font-bold">
          {isEditing ? d.name || p.name : p.name}
        </h1>
        {isEditing ? (
          <>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updatePattern.isPending}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(false)}
            >
              <XIcon className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          </>
        ) : (
          <>
            {p.imageUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshAI}
                disabled={reanalyzePattern.isPending}
                title="Re-run AI analysis on this pattern's photo"
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${reanalyzePattern.isPending ? "animate-spin" : ""}`}
                />
                <span className="hidden sm:inline">Refresh AI</span>
              </Button>
            )}
            {p.designer && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => enrichPattern.mutate({ id: patternId })}
                disabled={enrichPattern.isPending}
                title="Look up designer bio, website and publication info"
              >
                <Sparkles
                  className={`mr-1.5 h-3.5 w-3.5 ${enrichPattern.isPending ? "animate-pulse" : ""}`}
                />
                <span className="hidden sm:inline">Enrich</span>
              </Button>
            )}
            {p.imageUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => extractBlocks.mutate({ id: patternId })}
                disabled={extractBlocks.isPending}
                title="Extract block grid schema from pattern image"
              >
                <Grid3x3
                  className={`mr-1.5 h-3.5 w-3.5 ${extractBlocks.isPending ? "animate-pulse" : ""}`}
                />
                <span className="hidden sm:inline">Extract blocks</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={enterEdit}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {p.imageUrl && (
              <Button
                variant="outline"
                size="icon"
                title="Download photo"
                onClick={() => downloadCollectionImage(p.imageUrl!, p.name)}
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (confirm("Delete this pattern? This cannot be undone.")) {
                  deletePattern.mutate({ id: patternId });
                }
              }}
              disabled={deletePattern.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {p.imageUrl ? (
          <div
            className="relative overflow-hidden rounded-2xl border border-card-border bg-muted cursor-zoom-in group"
            onClick={() => setLightboxOpen(true)}
          >
            <img
              src={p.imageUrl}
              alt={p.name}
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
              <ZoomIn className="h-10 w-10 text-white drop-shadow-lg" />
            </div>
          </div>
        ) : (
          <div className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 text-muted-foreground/40">
            No photo
          </div>
        )}
        {p.imageUrl && (
          <ImageLightbox
            src={p.imageUrl}
            alt={p.name}
            open={lightboxOpen}
            onClose={() => setLightboxOpen(false)}
          />
        )}

        <div className="space-y-5">
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pattern details
            </p>
            {isEditing ? (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 flex items-center text-xs text-muted-foreground">
                    Name
                    {AI_FIELDS.includes("name") && (
                      <LockButton
                        field="name"
                        lockedFields={lockedFields}
                        onToggle={toggleLock}
                      />
                    )}
                  </label>
                  <Input
                    value={d.name}
                    onChange={(e) => set("name", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center text-xs text-muted-foreground">
                    Designer
                    <LockButton
                      field="designer"
                      lockedFields={lockedFields}
                      onToggle={toggleLock}
                    />
                  </label>
                  <Input
                    value={d.designer}
                    onChange={(e) => set("designer", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center text-xs text-muted-foreground">
                    Block size
                    <LockButton
                      field="blockSize"
                      lockedFields={lockedFields}
                      onToggle={toggleLock}
                    />
                  </label>
                  <Input
                    value={d.blockSize}
                    onChange={(e) => set("blockSize", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="e.g. 6 inch"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center text-xs text-muted-foreground">
                    Difficulty
                    <LockButton
                      field="difficulty"
                      lockedFields={lockedFields}
                      onToggle={toggleLock}
                    />
                  </label>
                  <Input
                    value={d.difficulty}
                    onChange={(e) => set("difficulty", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="beginner / intermediate / advanced"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Source type
                  </label>
                  <Input
                    value={d.sourceType}
                    onChange={(e) => set("sourceType", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="book, magazine, online…"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Source reference
                  </label>
                  <Input
                    value={d.sourceReference}
                    onChange={(e) => set("sourceReference", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Acquired
                  </label>
                  <Input
                    value={d.acquiredAt}
                    onChange={(e) => set("acquiredAt", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="2024-01"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {(
                  [
                    ["designer", "Designer", p.designer, true],
                    ["blockSize", "Block size", p.blockSize, true],
                    ["difficulty", "Difficulty", p.difficulty, true],
                    ["sourceType", "Source", p.sourceType, false],
                    ["sourceReference", "Reference", p.sourceReference, false],
                    ["acquiredAt", "Acquired", p.acquiredAt, false],
                  ] as [string, string, string | null | undefined, boolean][]
                )
                  .filter(([, , v]) => v)
                  .map(([k, label, v, isAI]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="flex items-center gap-0.5 text-muted-foreground">
                        {label}
                        {isAI && (
                          <LockButton
                            field={k}
                            lockedFields={lockedFields}
                            onToggle={toggleLock}
                          />
                        )}
                      </span>
                      <span className="max-w-[60%] text-right font-medium capitalize">
                        {v}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {!isEditing &&
            (p.designerBio || p.designerWebsite || p.publicationName) && (
              <section className="rounded-xl border border-card-border bg-card p-4">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> Designer info
                </p>
                <div className="space-y-2 text-sm">
                  {p.designerBio && (
                    <p className="text-muted-foreground leading-relaxed">
                      {p.designerBio}
                    </p>
                  )}
                  {p.publicationName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Publication</span>
                      <span className="font-medium text-right max-w-[60%]">
                        {p.publicationName}
                        {p.publicationYear ? ` (${p.publicationYear})` : ""}
                      </span>
                    </div>
                  )}
                  {p.designerWebsite && (
                    <a
                      href={p.designerWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline text-xs"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {p.designerWebsite}
                    </a>
                  )}
                </div>
              </section>
            )}

          {!isEditing && extractedBlocks && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <button
                className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                onClick={() => setShowExtracted((v) => !v)}
              >
                <span className="flex items-center gap-1.5">
                  <Grid3x3 className="h-3 w-3" />
                  Extracted block schema
                  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-normal normal-case text-muted-foreground">
                    {extractedBlocks.gridSize}×{extractedBlocks.gridSize} ·{" "}
                    {extractedBlocks.confidence} confidence
                  </span>
                </span>
                {showExtracted ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              {showExtracted && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {extractedBlocks.cells.length} cells extracted. Open the
                    block designer and paste the schema to start designing.
                  </p>
                  <pre className="overflow-x-auto rounded-lg bg-muted p-2 text-xs leading-relaxed">
                    {JSON.stringify(extractedBlocks, null, 2)}
                  </pre>
                </div>
              )}
            </section>
          )}

          {(isEditing || p.categories.length > 0) && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Tag className="h-3 w-3" /> Categories
              </p>
              {isEditing ? (
                <TagSelector
                  allCategories={allCategories ?? []}
                  selectedIds={selectedCategoryIds}
                  onToggle={(id) =>
                    setSelectedCategoryIds((prev) =>
                      prev.includes(id)
                        ? prev.filter((x) => x !== id)
                        : [...prev, id],
                    )
                  }
                  onCreated={(cat) =>
                    setSelectedCategoryIds((prev) => [...prev, cat.id])
                  }
                  disabled={updatePattern.isPending}
                />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {p.categories.map((cat) => (
                    <Badge
                      key={cat.id}
                      variant="outline"
                      className="border-transparent"
                      style={(() => {
                        const palette = cat.bgColor
                          ? { bgColor: cat.bgColor, textColor: cat.textColor ?? "#fff" }
                          : getCategoryPalette(cat.name);
                        return { backgroundColor: palette.bgColor, color: palette.textColor };
                      })()}
                    >
                      {cat.name}
                    </Badge>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
              {!isEditing && (
                <LockButton
                  field="notes"
                  lockedFields={lockedFields}
                  onToggle={toggleLock}
                />
              )}
            </p>
            {isEditing ? (
              <>
                <div className="mb-1 flex items-center">
                  <LockButton
                    field="notes"
                    lockedFields={lockedFields}
                    onToggle={toggleLock}
                  />
                  <span className="ml-1 text-xs text-muted-foreground">
                    lock notes
                  </span>
                </div>
                <Textarea
                  value={d.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={4}
                  className="text-sm"
                  placeholder="Notes about this pattern…"
                />
              </>
            ) : p.notes ? (
              <p className="text-sm leading-relaxed">{p.notes}</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">No notes</p>
            )}
          </section>

          {!isEditing && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <LockOpen className="h-3 w-3" />
              Tap a lock icon to protect a field from AI updates.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
