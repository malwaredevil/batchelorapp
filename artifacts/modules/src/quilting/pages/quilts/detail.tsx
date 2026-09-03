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
  Download,
} from "lucide-react";
import { LockButton } from "@/quilting/components/LockButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette, colorToHex } from "@workspace/web-core";
import { ShareModal } from "@/quilting/components/share-modal";
import { toast } from "sonner";
import {
  useGetQuilt,
  useDeleteQuilt,
  useUpdateQuilt,
  useReanalyzeQuilt,
  useAddQuiltImage,
  useDeleteQuiltImage,
  useUpdateQuiltImage,
  useSetQuiltImageDefault,
  useListQuiltingCategories,
  getListQuiltsQueryKey,
  getGetQuiltQueryKey,
  type QuiltingCategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/quilting/components/tag-selector";
import { ImageLightbox } from "@/quilting/components/image-lightbox";
import {
  ItemImageGallery,
  extractImageVersion,
} from "@workspace/image-capture";
import { downloadCollectionImage } from "@/quilting/lib/svg-export";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";
import {
  formatElaineContextList,
  formatElaineContextEntity,
} from "@workspace/elaine-ui";
import {
  CollectionDetailHero,
  CollectionDetailPanelStack,
  CollectionDetailSection,
  CollectionDetailField,
  getPhotoRecognitionRefetchInterval,
  PhotoRecognitionStatus,
  CollectionDetailSkeleton,
  CollectionErrorState,
  ReminderBellButton,
  useToggleLockedField,
  mergeSelectedCategoryNames,
} from "@workspace/collection-ui";

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
  recognitionRefreshStatus?: "pending" | "complete" | null;
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  imageUrl: string;
  images: Array<{
    id: number;
    url: string;
    label: string | null;
    position: number;
  }>;
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
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

  const {
    data: quilt,
    isLoading,
    isError,
    refetch,
  } = useGetQuilt(quiltId, {
    query: {
      queryKey: getGetQuiltQueryKey(quiltId),
      refetchInterval: (query) =>
        getPhotoRecognitionRefetchInterval(
          query.state.data?.recognitionRefreshStatus,
        ),
    },
  });
  const { data: allCategories } = useListQuiltingCategories();

  usePageAssistantContext(
    "quilting-quilt-detail",
    isLoading || !quilt
      ? undefined
      : `Quilt Detail page: ${formatElaineContextEntity({ entity: "quilt", id: quilt.id, label: quilt.name, details: [quilt.recipient ? `made for ${quilt.recipient}` : "", quilt.dateCompleted ? `completed ${quilt.dateCompleted}` : "", quilt.sizeWidth && quilt.sizeHeight ? `size ${quilt.sizeWidth}x${quilt.sizeHeight}"` : ""].filter(Boolean) })}.`,
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

  const addQuiltImage = useAddQuiltImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetQuiltQueryKey(quiltId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListQuiltsQueryKey(),
        });
        toast.success("Photo added");
      },
      onError: () => toast.error("Failed to add photo."),
    },
  });

  const deleteQuiltImageMutation = useDeleteQuiltImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetQuiltQueryKey(quiltId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListQuiltsQueryKey(),
        });
        toast.success("Photo deleted");
      },
      onError: () => toast.error("Failed to delete photo."),
    },
  });

  const relabelImageMutation = useUpdateQuiltImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetQuiltQueryKey(quiltId),
        });
        toast.success("Label saved");
      },
      onError: () => toast.error("Failed to save label."),
    },
  });

  const setDefaultMutation = useSetQuiltImageDefault({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetQuiltQueryKey(quiltId), data);
        void queryClient.invalidateQueries({
          queryKey: getListQuiltsQueryKey(),
        });
        toast.success("Default photo updated");
      },
      onError: () => toast.error("Failed to update default photo."),
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

  const toggleLock = useToggleLockedField(
    quilt as unknown as QuiltData | undefined,
    (q) => q.lockedFields,
    (next) => updateQuilt.mutate({ id: quiltId, data: { lockedFields: next } }),
  );

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
    const categoryNames = mergeSelectedCategoryNames(
      allCategories,
      localNewCats,
      selectedCategoryIds,
    );
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
    return <CollectionDetailSkeleton />;
  }

  if (isError || !quilt) {
    return (
      <CollectionErrorState
        message="Quilt not found."
        onRetry={() => refetch()}
      />
    );
  }

  const q = quilt as unknown as QuiltData;
  const lockedFields = q.lockedFields ?? [];
  const d = draft;
  const set = (k: keyof typeof draft, v: string | number) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  const sortedSupplementals = (q.images ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const allLightboxImages = [
    q.imageUrl,
    ...sortedSupplementals.map((img) => img.url),
  ];
  const allLightboxLabels = [
    "Default",
    ...sortedSupplementals.map((img, i) => img.label ?? `Photo ${i + 2}`),
  ];

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

      <CollectionDetailHero>
        {/* Col 1: shared item image gallery */}
        <div className="space-y-4">
          <ImageLightbox
            src={
              lightboxIndex !== null
                ? (allLightboxImages[lightboxIndex] ?? "")
                : ""
            }
            open={lightboxIndex !== null}
            onClose={() => setLightboxIndex(null)}
            images={allLightboxImages}
            currentIndex={lightboxIndex ?? 0}
            onNavigate={setLightboxIndex}
            labels={allLightboxLabels}
          />
          <ItemImageGallery
            images={[
              { id: -1, url: q.imageUrl, label: null, isPrimary: true },
              ...sortedSupplementals.map((img) => ({
                id: img.id,
                url: img.url,
                label: img.label ?? null,
                isPrimary: false,
              })),
            ]}
            onAddImage={async (file) => {
              await addQuiltImage.mutateAsync({
                id: quiltId,
                data: { image: file },
              });
            }}
            onDeleteImage={(imageId, isPrimary) => {
              if (isPrimary) {
                toast.error(
                  "Set another photo as default first, then you can delete this one.",
                );
                return;
              }
              deleteQuiltImageMutation.mutate({ id: quiltId, imageId });
            }}
            onSetPrimary={(imageId) => {
              const img = sortedSupplementals.find((i) => i.id === imageId);
              const expectedVersion = img
                ? extractImageVersion(img.url)
                : undefined;
              setDefaultMutation.mutate({
                id: quiltId,
                imageId,
                data: expectedVersion ? { expectedVersion } : {},
              });
            }}
            onRelabel={async (imageId, label) => {
              await relabelImageMutation.mutateAsync({
                id: quiltId,
                imageId,
                data: { label },
              });
            }}
            onZoom={(url) => {
              const idx = allLightboxImages.indexOf(url);
              if (idx >= 0) setLightboxIndex(idx);
            }}
            isUploading={addQuiltImage.isPending}
            isMutating={
              setDefaultMutation.isPending ||
              deleteQuiltImageMutation.isPending ||
              relabelImageMutation.isPending
            }
            maxImages={11}
          />
        </div>

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
                    <ReminderBellButton
                      entityType="quilting_quilt"
                      entityId={quiltId}
                      defaultTitle={`Reminder: ${q.name}`}
                    />
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
        </div>
        <PhotoRecognitionStatus status={q.recognitionRefreshStatus} />
      </CollectionDetailHero>

      <CollectionDetailPanelStack>
        <CollectionDetailSection title="Quilt details">
          {isEditing && (
            <CollectionDetailField
              label="Name"
              value={q.name}
              editing
              editSlot={
                <Input
                  value={d.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="h-8 text-sm"
                />
              }
              locked={lockedFields.includes("name")}
              onToggleLock={() => toggleLock("name")}
            />
          )}
          {(isEditing || q.dateCompleted) && (
            <CollectionDetailField
              label="Completed"
              value={q.dateCompleted ?? "—"}
              editing={isEditing}
              editSlot={
                <Input
                  value={d.dateCompleted}
                  onChange={(e) => set("dateCompleted", e.target.value)}
                  className="h-8 text-sm"
                  placeholder="2024-06-01"
                />
              }
            />
          )}
          {/* WIP progress — quilt-specific slider/bar, not a plain text field */}
          {isEditing && !d.dateCompleted && (
            <div className="py-1.5 border-b border-border/60 last:border-0">
              <label className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
          {!isEditing &&
            !q.dateCompleted &&
            (q.completionPercentage ?? 0) > 0 && (
              <div className="py-1.5 border-b border-border/60 last:border-0">
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    WIP Progress
                  </span>
                  <span className="text-sm font-medium">
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
          {isEditing ? (
            <>
              <CollectionDetailField
                label="Width (in)"
                value={q.sizeWidth ?? "—"}
                editing
                editSlot={
                  <Input
                    value={d.sizeWidth}
                    onChange={(e) => set("sizeWidth", e.target.value)}
                    type="number"
                    className="h-8 text-sm"
                  />
                }
              />
              <CollectionDetailField
                label="Height (in)"
                value={q.sizeHeight ?? "—"}
                editing
                editSlot={
                  <Input
                    value={d.sizeHeight}
                    onChange={(e) => set("sizeHeight", e.target.value)}
                    type="number"
                    className="h-8 text-sm"
                  />
                }
              />
            </>
          ) : (
            q.sizeWidth != null &&
            q.sizeHeight != null && (
              <CollectionDetailField
                label="Size"
                value={`${q.sizeWidth}" × ${q.sizeHeight}"`}
              />
            )
          )}
          {(isEditing || q.recipient) && (
            <CollectionDetailField
              label="Recipient"
              value={q.recipient ?? "—"}
              editing={isEditing}
              editSlot={
                <Input
                  value={d.recipient}
                  onChange={(e) => set("recipient", e.target.value)}
                  className="h-8 text-sm"
                />
              }
            />
          )}
        </CollectionDetailSection>

        {(q.dominantColors?.length ?? 0) > 0 && (
          <CollectionDetailSection title="Colours">
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
          </CollectionDetailSection>
        )}

        <CollectionDetailSection
          title="Categories"
          action={
            !catEditing && !isEditing ? (
              <button
                onClick={enterCatEdit}
                className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                title="Edit categories"
              >
                <Pencil className="h-3 w-3" />
              </button>
            ) : undefined
          }
        >
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
              No categories — click <Pencil className="inline h-2.5 w-2.5" /> to
              add
            </p>
          )}
        </CollectionDetailSection>

        {q.linkedFabrics && q.linkedFabrics.length > 0 && (
          <CollectionDetailSection
            title={`Fabrics used (${q.linkedFabrics.length})`}
          >
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
          </CollectionDetailSection>
        )}

        <CollectionDetailSection title="Notes">
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
          ) : (
            <CollectionDetailField
              label="Notes"
              value={
                q.notes ? (
                  <span className="leading-relaxed">{q.notes}</span>
                ) : (
                  "No notes"
                )
              }
              empty={!q.notes}
              locked={lockedFields.includes("notes")}
              onToggleLock={
                AI_FIELDS.includes("notes")
                  ? () => toggleLock("notes")
                  : undefined
              }
            />
          )}
        </CollectionDetailSection>

        {!isEditing && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground/60">
            <LockOpen className="h-3 w-3" />
            Tap a lock icon to protect a field from AI updates.
          </p>
        )}
      </CollectionDetailPanelStack>
    </div>
  );
}
