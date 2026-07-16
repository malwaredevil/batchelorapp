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
} from "lucide-react";
import { LockButton } from "@/quilting/components/LockButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette, colorToHex } from "@workspace/web-core";
import { ShareModal } from "@/quilting/components/share-modal";
import { toast } from "sonner";
import {
  useGetQuilt,
  useDeleteQuilt,
  useUpdateQuilt,
  useReanalyzeQuilt,
  useListQuiltingCategories,
  getListQuiltsQueryKey,
  getGetQuiltQueryKey,
  type QuiltingCategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/quilting/components/tag-selector";
import { PreviewZoomModal } from "@/quilting/components/PreviewZoomModal";
import { downloadCollectionImage } from "@/quilting/lib/svg-export";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";

type QuiltData = {
  id: number;
  name: string;
  dateCompleted?: string | null;
  sizeWidth?: number | null;
  sizeHeight?: number | null;
  recipient?: string | null;
  notes?: string | null;
  lockedFields: string[];
  completionPercentage?: number | null;
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  imageUrl: string;
  dominantColors?: string[];
  linkedFabricIds: number[];
  linkedFabrics?: Array<{
    id: number;
    name: string;
    imageUrl: string;
    colorway?: string | null;
    dominantColors?: string[];
  }>;
};

const AI_FIELDS = ["name", "notes"];

export default function QuiltDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const quiltId = Number(id);

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [catEditing, setCatEditing] = useState(false);
  const [localNewCats, setLocalNewCats] = useState<QuiltingCategory[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const rawSearch = useSearch();
  useEffect(() => {
    if (new URLSearchParams(rawSearch).get("edit") === "1") setIsEditing(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState({
    name: "",
    dateCompleted: "",
    sizeWidth: "",
    sizeHeight: "",
    recipient: "",
    notes: "",
    completionPercentage: 0,
  });

  const { data: quilt, isLoading, isError } = useGetQuilt(quiltId);
  const { data: allCategories } = useListQuiltingCategories();

  usePageAssistantContext(
    "quilting-quilt-detail",
    isLoading || !quilt
      ? undefined
      : `Quilt Detail page (quiltId: ${quilt.id}): "${quilt.name}"${quilt.recipient ? `, made for ${quilt.recipient}` : ""}${quilt.dateCompleted ? `, completed ${quilt.dateCompleted}` : ""}${quilt.sizeWidth && quilt.sizeHeight ? `, size ${quilt.sizeWidth}x${quilt.sizeHeight}"` : ""}.`,
  );

  const deleteQuilt = useDeleteQuilt({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        queryClient.removeQueries({ queryKey: getGetQuiltQueryKey(quiltId) });
        toast.success("Quilt deleted");
        navigate("/quilting/quilts");
      },
      onError: () => toast.error("Failed to delete quilt."),
    },
  });

  const updateQuilt = useUpdateQuilt({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetQuiltQueryKey(quiltId), data);
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        toast.success("Saved");
        setIsEditing(false);
      },
      onError: () => toast.error("Failed to save."),
    },
  });

  const reanalyzeQuilt = useReanalyzeQuilt({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetQuiltQueryKey(quiltId), data);
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        toast.success("AI analysis refreshed");
      },
      onError: () => toast.error("Failed to refresh AI analysis."),
    },
  });

  function enterEdit() {
    if (!quilt) return;
    const q = quilt as unknown as QuiltData;
    setDraft({
      name: q.name,
      dateCompleted: q.dateCompleted ?? "",
      sizeWidth: q.sizeWidth != null ? String(q.sizeWidth) : "",
      sizeHeight: q.sizeHeight != null ? String(q.sizeHeight) : "",
      recipient: q.recipient ?? "",
      notes: q.notes ?? "",
      completionPercentage: q.completionPercentage ?? 0,
    });
    setSelectedCategoryIds(q.categories.map((c) => c.id));
    setIsEditing(true);
  }

  function handleSave() {
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCategoryIds.includes(c.id))
      .map((c) => c.name);
    updateQuilt.mutate({
      id: quiltId,
      data: {
        name: draft.name || undefined,
        dateCompleted: draft.dateCompleted || null,
        sizeWidth: draft.sizeWidth ? parseFloat(draft.sizeWidth) || null : null,
        sizeHeight: draft.sizeHeight
          ? parseFloat(draft.sizeHeight) || null
          : null,
        recipient: draft.recipient || null,
        notes: draft.notes || null,
        categories: categoryNames,
        completionPercentage: draft.completionPercentage,
      },
    });
  }

  function toggleLock(field: string) {
    if (!quilt) return;
    const q = quilt as unknown as QuiltData;
    const current = q.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((x) => x !== field)
      : [...current, field];
    updateQuilt.mutate({ id: quiltId, data: { lockedFields: next } });
    toast.success(
      next.includes(field) ? `"${field}" locked` : `"${field}" unlocked`,
    );
  }

  function handleRefreshAI() {
    reanalyzeQuilt.mutate({ id: quiltId });
    toast.info("Refreshing AI analysis…");
  }

  function handleRename() {
    if (!renameValue.trim()) return;
    updateQuilt.mutate(
      { id: quiltId, data: { name: renameValue.trim() } },
      { onSuccess: () => setRenamingName(false) },
    );
  }

  function enterCatEdit() {
    const q = quilt as unknown as QuiltData;
    setSelectedCategoryIds(q.categories?.map((c) => c.id) ?? []);
    setLocalNewCats([]);
    setCatEditing(true);
  }

  function handleSaveCategories() {
    const merged = [
      ...(allCategories ?? []),
      ...localNewCats.filter(
        (nc) => !(allCategories ?? []).some((a) => a.id === nc.id),
      ),
    ];
    const categoryNames = merged
      .filter((c) => selectedCategoryIds.includes(c.id))
      .map((c) => c.name);
    updateQuilt.mutate(
      { id: quiltId, data: { categories: categoryNames } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetQuiltQueryKey(quiltId), data);
          queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
          toast.success("Categories saved");
          setCatEditing(false);
        },
        onError: () => toast.error("Failed to save categories"),
      },
    );
  }

  if (isLoading) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/quilting/quilts")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="aspect-video w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !quilt) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Quilt not found.</p>
        <Button variant="outline" onClick={() => navigate("/quilting/quilts")}>
          Back
        </Button>
      </div>
    );
  }

  const q = quilt as unknown as QuiltData;
  const lockedFields = q.lockedFields ?? [];
  const d = draft;
  const set = (k: keyof typeof draft, v: string | number) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="mx-auto max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={() => navigate("/quilting/quilts")}
      >
        <ArrowLeft className="h-4 w-4" />
        Quilts
      </Button>

      <div className="grid gap-6 md:grid-cols-2">
        <div
          className="relative overflow-hidden rounded-2xl border border-card-border bg-muted cursor-zoom-in group"
          onClick={() => setLightboxOpen(true)}
        >
          <img
            src={q.imageUrl}
            alt={q.name}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
            <ZoomIn className="h-10 w-10 text-white drop-shadow-lg" />
          </div>
        </div>
        <PreviewZoomModal
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          title={q.name}
        >
          <img
            src={q.imageUrl}
            alt={q.name}
            className="max-h-[85vh] max-w-[85vw] rounded object-contain"
            draggable={false}
          />
        </PreviewZoomModal>

        <div className="flex flex-col gap-4">
          {/* Title row */}
          {renamingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="h-9 flex-1 text-lg font-semibold"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setRenamingName(false);
                }}
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleRename}
                disabled={updateQuilt.isPending}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRenamingName(false)}
              >
                <XIcon className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <h1 className="flex-1 text-2xl font-bold tracking-tight leading-tight">
                {isEditing ? d.name || q.name : q.name}
              </h1>
              <div className="flex shrink-0 flex-wrap gap-1">
                {isEditing ? (
                  <>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={updateQuilt.isPending}
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
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleRefreshAI}
                      disabled={reanalyzeQuilt.isPending}
                      title="Re-run AI analysis"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${reanalyzeQuilt.isPending ? "animate-spin" : ""}`}
                      />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleLock("name")}
                      disabled={updateQuilt.isPending}
                      title={
                        lockedFields.includes("name")
                          ? "Name locked — click to unlock."
                          : "Name unlocked — click to lock."
                      }
                      className={
                        lockedFields.includes("name")
                          ? "border-red-400 text-red-600 hover:border-red-500 hover:text-red-700"
                          : "border-green-400 text-green-600 hover:border-green-500 hover:text-green-700"
                      }
                    >
                      {lockedFields.includes("name") ? (
                        <Lock className="h-4 w-4" />
                      ) : (
                        <LockOpen className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={enterEdit}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      title="Download photo"
                      onClick={() =>
                        downloadCollectionImage(q.imageUrl, q.name)
                      }
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <ShareModal
                      data={{
                        type: "quilt",
                        name: q.name,
                        subtitle: q.recipient
                          ? `Made for ${q.recipient}`
                          : undefined,
                        details: {
                          Completed: q.dateCompleted ?? undefined,
                          Size:
                            q.sizeWidth && q.sizeHeight
                              ? `${q.sizeWidth}" × ${q.sizeHeight}"`
                              : undefined,
                          "Fabrics used":
                            q.linkedFabrics?.length ?? q.linkedFabricIds.length,
                        },
                        hashtags: ["#finishedquilt", "#handmadequilt"],
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (
                          confirm("Delete this quilt? This cannot be undone.")
                        )
                          deleteQuilt.mutate({ id: quiltId });
                      }}
                      disabled={deleteQuilt.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Quilt details
            </p>
            {isEditing ? (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 flex items-center text-xs text-muted-foreground">
                    Name
                    <LockButton
                      field="name"
                      lockedFields={lockedFields}
                      onToggle={toggleLock}
                    />
                  </label>
                  <Input
                    value={d.name}
                    onChange={(e) => set("name", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Completed
                  </label>
                  <Input
                    value={d.dateCompleted}
                    onChange={(e) => set("dateCompleted", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="2024-06-01"
                  />
                </div>
                {!d.dateCompleted && (
                  <div>
                    <label className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>WIP Progress</span>
                      <span className="font-medium text-foreground">
                        {d.completionPercentage}%
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={d.completionPercentage}
                      onChange={(e) =>
                        set("completionPercentage", parseInt(e.target.value))
                      }
                      className="w-full accent-primary h-2 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-0.5">
                      <span>Not started</span>
                      <span>Done</span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Width (in)
                    </label>
                    <Input
                      value={d.sizeWidth}
                      onChange={(e) => set("sizeWidth", e.target.value)}
                      type="number"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Height (in)
                    </label>
                    <Input
                      value={d.sizeHeight}
                      onChange={(e) => set("sizeHeight", e.target.value)}
                      type="number"
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Recipient
                  </label>
                  <Input
                    value={d.recipient}
                    onChange={(e) => set("recipient", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {!q.dateCompleted && (q.completionPercentage ?? 0) > 0 && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-muted-foreground">
                        WIP Progress
                      </span>
                      <span className="font-medium">
                        {q.completionPercentage ?? 0}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${q.completionPercentage ?? 0}%`,
                          backgroundColor:
                            (q.completionPercentage ?? 0) >= 80
                              ? "#10b981"
                              : (q.completionPercentage ?? 0) >= 40
                                ? "#f59e0b"
                                : "#f87171",
                        }}
                      />
                    </div>
                  </div>
                )}
                {q.dateCompleted && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Completed</span>
                    <span className="font-medium">{q.dateCompleted}</span>
                  </div>
                )}
                {q.sizeWidth && q.sizeHeight && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Size</span>
                    <span className="font-medium">
                      {q.sizeWidth}" × {q.sizeHeight}"
                    </span>
                  </div>
                )}
                {q.recipient && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recipient</span>
                    <span className="font-medium">{q.recipient}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {(q.dominantColors?.length ?? 0) > 0 && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Colours
              </p>
              <div className="flex flex-wrap gap-2">
                {q.dominantColors!.map((c) => (
                  <div key={c} className="flex items-center gap-1.5">
                    <span
                      className="h-6 w-6 rounded-full border border-black/10 shadow-sm"
                      style={{ backgroundColor: colorToHex(c) }}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {c}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-card-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Tag className="h-3 w-3" /> Categories
              </p>
              {!catEditing && !isEditing && (
                <button
                  onClick={enterCatEdit}
                  className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                  title="Edit categories"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
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
                disabled={updateQuilt.isPending}
              />
            ) : catEditing ? (
              <>
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
                  onCreated={(cat) => {
                    setSelectedCategoryIds((prev) => [...prev, cat.id]);
                    setLocalNewCats((prev) =>
                      prev.some((c) => c.id === cat.id) ? prev : [...prev, cat],
                    );
                  }}
                  disabled={updateQuilt.isPending}
                />
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveCategories}
                    disabled={updateQuilt.isPending}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    {updateQuilt.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCatEditing(false)}
                    disabled={updateQuilt.isPending}
                  >
                    <XIcon className="mr-1.5 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </>
            ) : q.categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {q.categories.map((cat) => (
                  <Badge
                    key={cat.id}
                    variant="outline"
                    className="border-transparent"
                    style={(() => {
                      const palette = cat.bgColor
                        ? {
                            bgColor: cat.bgColor,
                            textColor: cat.textColor ?? "#fff",
                          }
                        : getCategoryPalette(cat.name);
                      return {
                        backgroundColor: palette.bgColor,
                        color: palette.textColor,
                      };
                    })()}
                  >
                    {cat.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No categories — click <Pencil className="inline h-2.5 w-2.5" />{" "}
                to add
              </p>
            )}
          </section>

          {q.linkedFabrics && q.linkedFabrics.length > 0 && (
            <section className="rounded-xl border border-card-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fabrics used ({q.linkedFabrics.length})
              </p>
              {(() => {
                const allColors = [
                  ...new Set(
                    q.linkedFabrics!.flatMap((f) => f.dominantColors ?? []),
                  ),
                ].filter(Boolean);
                return allColors.length > 0 ? (
                  <div className="mb-3">
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      Colour palette
                    </p>
                    <div className="flex h-6 overflow-hidden rounded">
                      {allColors.slice(0, 12).map((color, i) => (
                        <div
                          key={i}
                          className="flex-1"
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}
              <div className="grid grid-cols-2 gap-2">
                {q.linkedFabrics.map((fabric) => (
                  <a
                    key={fabric.id}
                    href={`/quilting/fabrics/${fabric.id}`}
                    className="group flex items-center gap-2 overflow-hidden rounded-lg border border-card-border bg-background p-1.5 transition-colors hover:border-primary/40"
                  >
                    <img
                      src={fabric.imageUrl}
                      alt={fabric.name}
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium leading-tight group-hover:text-primary">
                        {fabric.name}
                      </p>
                      {fabric.colorway && (
                        <p className="truncate text-xs text-muted-foreground">
                          {fabric.colorway}
                        </p>
                      )}
                      {fabric.dominantColors &&
                        fabric.dominantColors.length > 0 && (
                          <div className="mt-0.5 flex gap-0.5">
                            {fabric.dominantColors.slice(0, 5).map((c, i) => (
                              <div
                                key={i}
                                className="h-2 w-2 rounded-full border border-black/10"
                                style={{ backgroundColor: c }}
                                title={c}
                              />
                            ))}
                          </div>
                        )}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-card-border bg-card p-4">
            <p className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
              {!isEditing && AI_FIELDS.includes("notes") && (
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
                  placeholder="Notes about this quilt…"
                />
              </>
            ) : q.notes ? (
              <p className="text-sm leading-relaxed">{q.notes}</p>
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
