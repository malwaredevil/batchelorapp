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
  Sparkles,
  Grid3x3,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  PlusCircle,
  Copy,
} from "lucide-react";
import { LockButton } from "@/quilting/components/LockButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette, colorToHex } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetPattern,
  useDeletePattern,
  useUpdatePattern,
  useReanalyzePattern,
  useEnrichPattern,
  useExtractPatternBlocks,
  useAddPatternImage,
  useDeletePatternImage,
  useUpdatePatternImage,
  useSetPatternImageDefault,
  useListQuiltingCategories,
  useCreateBlock,
  getListPatternsQueryKey,
  getGetPatternQueryKey,
  getListBlocksQueryKey,
  type QuiltingExtractBlocksResult,
  type QuiltingCategory,
  type QuiltingCreateBlockInputGridSize,
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
import { PatternAnalysisPanel } from "@/quilting/components/PatternAnalysisPanel";
import {
  CollectionDetailHero,
  CollectionDetailPanelStack,
  CollectionDetailSection,
  CollectionDetailField,
  CollectionDetailSkeleton,
  CollectionErrorState,
  getPhotoRecognitionRefetchInterval,
  PhotoRecognitionStatus,
  ReminderBellButton,
  useToggleLockedField,
  mergeSelectedCategoryNames,
} from "@workspace/collection-ui";

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
  dominantColors?: string[];
  lockedFields: string[];
  categories: Array<{
    id: number;
    name: string;
    bgColor: string | null;
    textColor: string | null;
  }>;
  imageUrl?: string | null;
  images: Array<{
    id: number;
    url: string;
    label: string | null;
    position: number;
  }>;
  recognitionRefreshStatus?: "pending" | "complete" | null;
};

const AI_FIELDS = ["name", "designer", "blockSize", "difficulty", "notes"];

export default function PatternDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const patternId = Number(id);

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [catEditing, setCatEditing] = useState(false);
  const [localNewCats, setLocalNewCats] = useState<QuiltingCategory[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [renamingName, setRenamingName] = useState(false);
  const [renameValue, setRenameValue] = useState("");
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

  const {
    data: pattern,
    isLoading,
    isError,
    refetch,
  } = useGetPattern(patternId, {
    query: {
      queryKey: getGetPatternQueryKey(patternId),
      refetchInterval: (query) =>
        getPhotoRecognitionRefetchInterval(
          query.state.data?.recognitionRefreshStatus,
        ),
    },
  });
  const { data: allCategories } = useListQuiltingCategories();

  usePageAssistantContext(
    "quilting-pattern-detail",
    isLoading || !pattern
      ? undefined
      : `Pattern Detail page: ${formatElaineContextEntity({ entity: "pattern", id: pattern.id, label: pattern.name, details: [pattern.designer ? `by ${pattern.designer}` : "", `block size: ${pattern.blockSize ?? "unknown"}`, `difficulty: ${pattern.difficulty ?? "unknown"}`, `source: ${pattern.sourceType ?? "unknown"}`].filter(Boolean) })}.`,
  );

  const deletePattern = useDeletePattern({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        queryClient.removeQueries({
          queryKey: getGetPatternQueryKey(patternId),
        });
        toast.success("Pattern deleted");
        navigate("/quilting/patterns");
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

  const createBlockFromExtraction = useCreateBlock({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
        toast.success("Block design created — opening in the Block Designer");
        navigate(`/quilting/blocks/${String(data.id)}/edit`);
      },
      onError: () => toast.error("Failed to create block design."),
    },
  });

  function handleCreateBlockFromExtraction() {
    if (!extractedBlocks || !pattern) return;
    const p = pattern as unknown as PatternData;
    createBlockFromExtraction.mutate({
      data: {
        name: `${p.name} block`,
        gridSize: extractedBlocks.gridSize as QuiltingCreateBlockInputGridSize,
        cells: extractedBlocks.cells,
      },
    });
  }

  async function handleCopyExtractedJson() {
    if (!extractedBlocks) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(extractedBlocks, null, 2),
      );
      toast.success("Schema copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  const addPatternImage = useAddPatternImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetPatternQueryKey(patternId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListPatternsQueryKey(),
        });
        toast.success("Photo added");
      },
      onError: () => toast.error("Failed to add photo."),
    },
  });

  const deletePatternImageMutation = useDeletePatternImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetPatternQueryKey(patternId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListPatternsQueryKey(),
        });
        toast.success("Photo deleted");
      },
      onError: () => toast.error("Failed to delete photo."),
    },
  });

  const relabelImageMutation = useUpdatePatternImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetPatternQueryKey(patternId),
        });
        toast.success("Label saved");
      },
      onError: () => toast.error("Failed to save label."),
    },
  });

  const setDefaultMutation = useSetPatternImageDefault({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetPatternQueryKey(patternId), data);
        void queryClient.invalidateQueries({
          queryKey: getListPatternsQueryKey(),
        });
        toast.success("Default photo updated");
      },
      onError: () => toast.error("Failed to update default photo."),
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

  const toggleLock = useToggleLockedField(
    pattern as unknown as PatternData | undefined,
    (p) => p.lockedFields,
    (next) =>
      updatePattern.mutate({ id: patternId, data: { lockedFields: next } }),
  );

  function handleRefreshAI() {
    reanalyzePattern.mutate({ id: patternId });
    toast.info("Refreshing AI analysis…");
  }

  function handleRename() {
    if (!renameValue.trim()) return;
    updatePattern.mutate(
      { id: patternId, data: { name: renameValue.trim() } },
      { onSuccess: () => setRenamingName(false) },
    );
  }

  function enterCatEdit() {
    const p = pattern as unknown as PatternData;
    setSelectedCategoryIds(p.categories?.map((c) => c.id) ?? []);
    setLocalNewCats([]);
    setCatEditing(true);
  }

  function handleSaveCategories() {
    const categoryNames = mergeSelectedCategoryNames(
      allCategories,
      localNewCats,
      selectedCategoryIds,
    );
    updatePattern.mutate(
      { id: patternId, data: { categories: categoryNames } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetPatternQueryKey(patternId), data);
          queryClient.invalidateQueries({
            queryKey: getListPatternsQueryKey(),
          });
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

  if (isError || !pattern) {
    return (
      <CollectionErrorState
        message="Pattern not found."
        onRetry={() => refetch()}
      />
    );
  }

  const p = pattern as unknown as PatternData;
  const lockedFields = p.lockedFields ?? [];
  const d = draft;
  const set = (k: keyof typeof draft, v: string) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="mx-auto max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={() => navigate("/quilting/patterns")}
      >
        <ArrowLeft className="h-4 w-4" />
        Patterns
      </Button>

      <CollectionDetailHero>
        {/* Col 1: shared item image gallery */}
        <div className="space-y-4">
          {(() => {
            const sortedSupplementals = (p.images ?? [])
              .slice()
              .sort((a, b) => a.position - b.position);
            const allLightboxImages = [
              ...(p.imageUrl ? [p.imageUrl] : []),
              ...sortedSupplementals.map((img) => img.url),
            ];
            const allLightboxLabels = [
              ...(p.imageUrl ? ["Default"] : []),
              ...sortedSupplementals.map(
                (img, i) => img.label ?? `Photo ${i + (p.imageUrl ? 2 : 1)}`,
              ),
            ];
            return (
              <>
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
                    ...(p.imageUrl
                      ? [
                          {
                            id: -1,
                            url: p.imageUrl,
                            label: null,
                            isPrimary: true,
                          },
                        ]
                      : []),
                    ...sortedSupplementals.map((img) => ({
                      id: img.id,
                      url: img.url,
                      label: img.label ?? null,
                      isPrimary: false,
                    })),
                  ]}
                  onAddImage={async (file) => {
                    await addPatternImage.mutateAsync({
                      id: patternId,
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
                    deletePatternImageMutation.mutate({
                      id: patternId,
                      imageId,
                    });
                  }}
                  onSetPrimary={(imageId) => {
                    const img = sortedSupplementals.find(
                      (i) => i.id === imageId,
                    );
                    const expectedVersion = img
                      ? extractImageVersion(img.url)
                      : undefined;
                    setDefaultMutation.mutate({
                      id: patternId,
                      imageId,
                      data: expectedVersion ? { expectedVersion } : {},
                    });
                  }}
                  onRelabel={async (imageId, label) => {
                    await relabelImageMutation.mutateAsync({
                      id: patternId,
                      imageId,
                      data: { label },
                    });
                  }}
                  onZoom={(url) => {
                    const idx = allLightboxImages.indexOf(url);
                    if (idx >= 0) setLightboxIndex(idx);
                  }}
                  isUploading={addPatternImage.isPending}
                  isMutating={
                    setDefaultMutation.isPending ||
                    deletePatternImageMutation.isPending ||
                    relabelImageMutation.isPending
                  }
                  maxImages={11}
                />
              </>
            );
          })()}
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
                disabled={updatePattern.isPending}
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
                {isEditing ? d.name || p.name : p.name}
              </h1>
              <div className="flex shrink-0 flex-wrap gap-1">
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
                    <ReminderBellButton
                      entityType="quilting_pattern"
                      entityId={patternId}
                      defaultTitle={`Reminder: ${p.name}`}
                    />
                    {p.imageUrl && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleRefreshAI}
                        disabled={reanalyzePattern.isPending}
                        title="Re-run AI analysis"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${reanalyzePattern.isPending ? "animate-spin" : ""}`}
                        />
                      </Button>
                    )}
                    {p.designer && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => enrichPattern.mutate({ id: patternId })}
                        disabled={enrichPattern.isPending}
                        title="Enrich designer info"
                      >
                        <Sparkles
                          className={`h-4 w-4 ${enrichPattern.isPending ? "animate-pulse" : ""}`}
                        />
                      </Button>
                    )}
                    {p.imageUrl && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => extractBlocks.mutate({ id: patternId })}
                        disabled={extractBlocks.isPending}
                        title="Extract block schema from image"
                      >
                        <Grid3x3
                          className={`h-4 w-4 ${extractBlocks.isPending ? "animate-pulse" : ""}`}
                        />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleLock("name")}
                      disabled={updatePattern.isPending}
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
                    {p.imageUrl && (
                      <Button
                        variant="outline"
                        size="icon"
                        title="Download photo"
                        onClick={() =>
                          downloadCollectionImage(p.imageUrl!, p.name)
                        }
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (
                          confirm("Delete this pattern? This cannot be undone.")
                        )
                          deletePattern.mutate({ id: patternId });
                      }}
                      disabled={deletePattern.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <PhotoRecognitionStatus status={p.recognitionRefreshStatus} />
      </CollectionDetailHero>

      <CollectionDetailPanelStack>
        <CollectionDetailSection title="Pattern details">
          {isEditing && (
            <CollectionDetailField
              label="Name"
              value={p.name}
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
          {(
            [
              ["designer", "Designer", p.designer, true, undefined],
              ["blockSize", "Block size", p.blockSize, true, "e.g. 6 inch"],
              [
                "difficulty",
                "Difficulty",
                p.difficulty,
                true,
                "beginner / intermediate / advanced",
              ],
              [
                "sourceType",
                "Source",
                p.sourceType,
                false,
                "book, magazine, online…",
              ],
              [
                "sourceReference",
                "Reference",
                p.sourceReference,
                false,
                undefined,
              ],
              ["acquiredAt", "Acquired", p.acquiredAt, false, "2024-01"],
            ] as [
              keyof typeof draft & string,
              string,
              string | null | undefined,
              boolean,
              string | undefined,
            ][]
          )
            .filter(([, , v]) => isEditing || v)
            .map(([k, label, v, isAI, placeholder]) => (
              <CollectionDetailField
                key={k}
                label={label}
                value={v || "—"}
                valueClassName="capitalize"
                editing={isEditing}
                editSlot={
                  <Input
                    value={d[k]}
                    onChange={(e) => set(k, e.target.value)}
                    className="h-8 text-sm"
                    placeholder={placeholder}
                  />
                }
                locked={lockedFields.includes(k)}
                onToggleLock={isAI ? () => toggleLock(k) : undefined}
              />
            ))}
        </CollectionDetailSection>

        {!isEditing &&
          (p.designerBio || p.designerWebsite || p.publicationName) && (
            <CollectionDetailSection title="Designer info">
              <div className="space-y-2 text-sm">
                {p.designerBio && (
                  <p className="text-muted-foreground leading-relaxed">
                    {p.designerBio}
                  </p>
                )}
                {p.publicationName && (
                  <CollectionDetailField
                    label="Publication"
                    value={`${p.publicationName}${p.publicationYear ? ` (${p.publicationYear})` : ""}`}
                  />
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
            </CollectionDetailSection>
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
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  {extractedBlocks.cells.length} cells extracted. Create a block
                  design from this schema to start editing it in the Block
                  Designer.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreateBlockFromExtraction}
                    disabled={createBlockFromExtraction.isPending}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {createBlockFromExtraction.isPending
                      ? "Creating…"
                      : "Create block design"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopyExtractedJson()}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy JSON
                  </Button>
                </div>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    View raw schema
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-2 leading-relaxed">
                    {JSON.stringify(extractedBlocks, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </section>
        )}

        {(p.dominantColors ?? []).length > 0 && (
          <CollectionDetailSection title="Colours">
            <div className="flex flex-wrap gap-2">
              {(p.dominantColors ?? []).map((c) => (
                <div
                  key={c}
                  title={c}
                  className="h-7 w-7 rounded-full border border-black/10 shadow-sm"
                  style={{ backgroundColor: colorToHex(c) }}
                />
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
              disabled={updatePattern.isPending}
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
                disabled={updatePattern.isPending}
              />
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveCategories}
                  disabled={updatePattern.isPending}
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  {updatePattern.isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCatEditing(false)}
                  disabled={updatePattern.isPending}
                >
                  <XIcon className="mr-1.5 h-3.5 w-3.5" />
                  Cancel
                </Button>
              </div>
            </>
          ) : p.categories.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {p.categories.map((cat) => (
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
                placeholder="Notes about this pattern…"
              />
            </>
          ) : (
            <CollectionDetailField
              label="Notes"
              value={
                p.notes ? (
                  <span className="leading-relaxed">{p.notes}</span>
                ) : (
                  "No notes"
                )
              }
              empty={!p.notes}
              locked={lockedFields.includes("notes")}
              onToggleLock={() => toggleLock("notes")}
            />
          )}
        </CollectionDetailSection>

        <PatternAnalysisPanel patternId={p.id} />

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
