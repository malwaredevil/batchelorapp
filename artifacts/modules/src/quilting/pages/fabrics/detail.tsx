import { useState, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  Trash2,
  Tag,
  Pencil,
  Lock,
  LockOpen,
  RefreshCw,
  Check,
  X as XIcon,
  Download,
  Sparkles,
} from "lucide-react";
import { LockButton } from "@/quilting/components/LockButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getCategoryPalette } from "@workspace/web-core";
import { toast } from "sonner";
import {
  useGetFabric,
  useDeleteFabric,
  useUpdateFabric,
  useReanalyzeFabric,
  useListQuiltingCategories,
  useGetFabricPairings,
  useAddFabricImage,
  useDeleteFabricImage,
  useUpdateFabricImage,
  useSetFabricImageDefault,
  getListFabricsQueryKey,
  getGetFabricQueryKey,
  type QuiltingCategory,
  type QuiltingFabric,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/quilting/components/tag-selector";
import { ImageLightbox } from "@/quilting/components/image-lightbox";
import { ItemImageGallery } from "@workspace/image-capture";
import { downloadCollectionImage } from "@/quilting/lib/svg-export";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";
import {
  formatElaineContextList,
  formatElaineContextEntity,
} from "@workspace/elaine-ui";
import { FabricIdentityResearchPanel } from "@/quilting/components/FabricIdentityResearchPanel";
import { FabricCreaseRemoverModal } from "@/quilting/components/FabricCreaseRemoverModal";
import {
  CollectionDetailHero,
  CollectionDetailPanelStack,
  CollectionDetailSection,
  CollectionDetailField,
  CollectionDetailSkeleton,
  CollectionErrorState,
  ReminderBellButton,
} from "@workspace/collection-ui";

type Fabric = {
  id: number;
  name: string;
  lineName?: string | null;
  designer?: string | null;
  manufacturer?: string | null;
  colorway?: string | null;
  printType?: string | null;
  fiberContent?: string | null;
  widthInches?: number | null;
  quantity: number;
  quantityUnit: string;
  sku?: string | null;
  notes?: string | null;
  aiDescription?: string | null;
  dominantColors: string[];
  motifs: string[];
  styleDescriptors: string[];
  acquiredAt?: string | null;
  lockedFields: string[];
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
};

const AI_FIELDS: (keyof Fabric)[] = [
  "name",
  "lineName",
  "designer",
  "manufacturer",
  "colorway",
  "printType",
  "fiberContent",
  "dominantColors",
  "motifs",
  "styleDescriptors",
];

function FabricPairings({ fabricId }: { fabricId: number }) {
  const [, navigate] = useLocation();
  const { data: pairings, isLoading } = useGetFabricPairings(fabricId);

  if (isLoading) {
    return (
      <section className="rounded-xl border border-card-border bg-card p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pairs well with
        </p>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (!pairings || pairings.length === 0) return null;

  return (
    <section className="rounded-xl border border-card-border bg-card p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Pairs well with
      </p>
      <div className="grid grid-cols-4 gap-2">
        {pairings.map((fabric: QuiltingFabric) => (
          <button
            key={fabric.id}
            onClick={() => navigate(`/quilting/fabrics/${fabric.id}`)}
            className="group flex flex-col items-center gap-1 rounded-lg p-1 hover:bg-muted/50 transition-colors text-left"
          >
            <div className="aspect-square w-full overflow-hidden rounded-lg bg-muted">
              {fabric.imageUrl ? (
                <img
                  src={fabric.imageUrl}
                  alt={fabric.name}
                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <Tag className="h-5 w-5 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <p className="w-full truncate text-center text-xs text-muted-foreground leading-tight">
              {fabric.name}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function FabricDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fabricId = Number(id);

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [catEditing, setCatEditing] = useState(false);
  const [localNewCats, setLocalNewCats] = useState<QuiltingCategory[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [renamingName, setRenamingName] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [creaseModalOpen, setCreaseModalOpen] = useState(false);
  const rawSearch = useSearch();
  useEffect(() => {
    if (new URLSearchParams(rawSearch).get("edit") === "1") setIsEditing(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<{
    name: string;
    lineName: string;
    designer: string;
    manufacturer: string;
    colorway: string;
    printType: string;
    fiberContent: string;
    widthInches: string;
    quantity: string;
    quantityUnit: string;
    sku: string;
    notes: string;
    acquiredAt: string;
    dominantColors: string;
    motifs: string;
  }>({
    name: "",
    lineName: "",
    designer: "",
    manufacturer: "",
    colorway: "",
    printType: "",
    fiberContent: "",
    widthInches: "",
    quantity: "",
    quantityUnit: "",
    sku: "",
    notes: "",
    acquiredAt: "",
    dominantColors: "",
    motifs: "",
  });

  const { data: fabric, isLoading, isError, refetch } = useGetFabric(fabricId);
  const { data: allCategories } = useListQuiltingCategories();

  usePageAssistantContext(
    "quilting-fabric-detail",
    isLoading || !fabric
      ? undefined
      : `Fabric Detail page: ${formatElaineContextEntity({ entity: "fabric", id: fabric.id, label: fabric.name, details: [fabric.designer ? `by ${fabric.designer}` : "", fabric.lineName ? `line "${fabric.lineName}"` : "", `${fabric.quantity} ${fabric.quantityUnit} on hand`, `print type: ${fabric.printType ?? "unknown"}`, `colours: ${(fabric.dominantColors ?? []).join(", ") || "none"}`, `categories: ${(fabric.categories ?? []).map((c: { name: string }) => c.name).join(", ") || "none"}`].filter(Boolean) })}.`,
  );

  const deleteFabric = useDeleteFabric({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        queryClient.removeQueries({ queryKey: getGetFabricQueryKey(fabricId) });
        toast.success("Fabric deleted");
        navigate("/quilting/fabrics");
      },
      onError: () => toast.error("Failed to delete fabric."),
    },
  });

  const updateFabric = useUpdateFabric({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetFabricQueryKey(fabricId), data);
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("Saved");
        setIsEditing(false);
      },
      onError: () => toast.error("Failed to save."),
    },
  });

  const reanalyzeFabric = useReanalyzeFabric({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetFabricQueryKey(fabricId), data);
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("AI analysis refreshed");
      },
      onError: () => toast.error("Failed to refresh AI analysis."),
    },
  });

  const addFabricImage = useAddFabricImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFabricQueryKey(fabricId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListFabricsQueryKey(),
        });
        toast.success("Photo added");
      },
      onError: () => toast.error("Failed to add photo."),
    },
  });

  const deleteFabricImageMutation = useDeleteFabricImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFabricQueryKey(fabricId),
        });
        void queryClient.invalidateQueries({
          queryKey: getListFabricsQueryKey(),
        });
        toast.success("Photo deleted");
      },
      onError: () => toast.error("Failed to delete photo."),
    },
  });

  const relabelImageMutation = useUpdateFabricImage({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFabricQueryKey(fabricId),
        });
        toast.success("Label saved");
      },
      onError: () => toast.error("Failed to save label."),
    },
  });

  const setDefaultMutation = useSetFabricImageDefault({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetFabricQueryKey(fabricId), data);
        void queryClient.invalidateQueries({
          queryKey: getListFabricsQueryKey(),
        });
        toast.success("Default photo updated");
      },
      onError: () => toast.error("Failed to update default photo."),
    },
  });

  function enterEdit() {
    if (!fabric) return;
    const f = fabric as unknown as Fabric;
    setDraft({
      name: f.name,
      lineName: f.lineName ?? "",
      designer: f.designer ?? "",
      manufacturer: f.manufacturer ?? "",
      colorway: f.colorway ?? "",
      printType: f.printType ?? "",
      fiberContent: f.fiberContent ?? "",
      widthInches: f.widthInches != null ? String(f.widthInches) : "",
      quantity: String(f.quantity),
      quantityUnit: f.quantityUnit,
      sku: f.sku ?? "",
      notes: f.notes ?? "",
      acquiredAt: f.acquiredAt ?? "",
      dominantColors: f.dominantColors.join(", "),
      motifs: f.motifs.join(", "),
    });
    setSelectedCategoryIds(f.categories.map((c) => c.id));
    setIsEditing(true);
  }

  function handleSave() {
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCategoryIds.includes(c.id))
      .map((c) => c.name);
    updateFabric.mutate({
      id: fabricId,
      data: {
        name: draft.name || undefined,
        lineName: draft.lineName || null,
        designer: draft.designer || null,
        manufacturer: draft.manufacturer || null,
        colorway: draft.colorway || null,
        printType: draft.printType || null,
        fiberContent: draft.fiberContent || null,
        widthInches: draft.widthInches
          ? parseFloat(draft.widthInches) || null
          : null,
        quantity: draft.quantity
          ? parseFloat(draft.quantity) || undefined
          : undefined,
        quantityUnit: draft.quantityUnit || undefined,
        sku: draft.sku || null,
        notes: draft.notes || null,
        acquiredAt: draft.acquiredAt || null,
        dominantColors: draft.dominantColors
          ? draft.dominantColors
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        motifs: draft.motifs
          ? draft.motifs
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        categories: categoryNames,
      },
    });
  }

  function toggleLock(field: string) {
    if (!fabric) return;
    const f = fabric as unknown as Fabric;
    const current = f.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((x) => x !== field)
      : [...current, field];
    updateFabric.mutate({ id: fabricId, data: { lockedFields: next } });
    toast.success(
      next.includes(field)
        ? `"${field}" locked — AI won't change this`
        : `"${field}" unlocked`,
    );
  }

  function handleRefreshAI() {
    reanalyzeFabric.mutate({ id: fabricId });
    toast.info("Refreshing AI analysis…");
  }

  function handleRename() {
    if (!renameValue.trim()) return;
    updateFabric.mutate(
      { id: fabricId, data: { name: renameValue.trim() } },
      { onSuccess: () => setRenamingName(false) },
    );
  }

  function enterCatEdit() {
    const f = fabric as unknown as Fabric;
    setSelectedCategoryIds(f.categories?.map((c) => c.id) ?? []);
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
    updateFabric.mutate(
      { id: fabricId, data: { categories: categoryNames } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetFabricQueryKey(fabricId), data);
          queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
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

  if (isError || !fabric) {
    return (
      <CollectionErrorState
        message="Fabric not found."
        onRetry={() => refetch()}
      />
    );
  }

  const f = fabric as unknown as Fabric;
  const lockedFields = f.lockedFields ?? [];
  const field = (k: keyof typeof draft) => draft[k];
  const set = (k: keyof typeof draft, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <div className="mx-auto max-w-3xl">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2"
          onClick={() => navigate("/quilting/fabrics")}
        >
          <ArrowLeft className="h-4 w-4" />
          Fabrics
        </Button>

        <CollectionDetailHero>
          {/* Col 1: shared item image gallery */}
          <div className="space-y-4">
            {(() => {
              const sortedSupplementals = f.images
                .slice()
                .sort((a, b) => a.position - b.position);
              const allLightboxImages = [
                f.imageUrl,
                ...sortedSupplementals.map((img) => img.url),
              ];
              const allLightboxLabels = [
                "Default",
                ...sortedSupplementals.map(
                  (img, i) => img.label ?? `Photo ${i + 2}`,
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
                      {
                        id: -1,
                        url: f.imageUrl,
                        label: null,
                        isPrimary: true,
                      },
                      ...sortedSupplementals.map((img) => ({
                        id: img.id,
                        url: img.url,
                        label: img.label ?? null,
                        isPrimary: false,
                      })),
                    ]}
                    onAddImage={async (file) => {
                      await addFabricImage.mutateAsync({
                        id: fabricId,
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
                      deleteFabricImageMutation.mutate({
                        id: fabricId,
                        imageId,
                      });
                    }}
                    onSetPrimary={(imageId) =>
                      setDefaultMutation.mutate({ id: fabricId, imageId })
                    }
                    onRelabel={async (imageId, label) => {
                      await relabelImageMutation.mutateAsync({
                        id: fabricId,
                        imageId,
                        data: { label },
                      });
                    }}
                    onZoom={(url) => {
                      const idx = allLightboxImages.indexOf(url);
                      if (idx >= 0) setLightboxIndex(idx);
                    }}
                    isUploading={addFabricImage.isPending}
                    isMutating={
                      setDefaultMutation.isPending ||
                      deleteFabricImageMutation.isPending ||
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
                  disabled={updateFabric.isPending}
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
                  {isEditing ? draft.name || f.name : f.name}
                </h1>
                <div className="flex shrink-0 gap-1">
                  {isEditing ? (
                    <>
                      <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={updateFabric.isPending}
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
                        entityType="quilting_fabric"
                        entityId={f.id}
                        defaultTitle={`Reminder: ${f.name}`}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleRefreshAI}
                        disabled={reanalyzeFabric.isPending}
                        title="Re-run AI analysis on this fabric's photo"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${reanalyzeFabric.isPending ? "animate-spin" : ""}`}
                        />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => toggleLock("name")}
                        disabled={updateFabric.isPending}
                        title={
                          lockedFields.includes("name")
                            ? "Name is locked — click to unlock."
                            : "Name is unlocked — click to lock."
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
                        title="AI Enhance"
                        onClick={() => setCreaseModalOpen(true)}
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        title="Download photo"
                        onClick={() =>
                          downloadCollectionImage(f.imageUrl, f.name)
                        }
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (
                            confirm(
                              "Delete this fabric? This cannot be undone.",
                            )
                          )
                            deleteFabric.mutate({ id: fabricId });
                        }}
                        disabled={deleteFabric.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
            {!isEditing && (
              <div className="space-y-4">
                {f.aiDescription && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {f.aiDescription}
                  </p>
                )}
                {f.dominantColors.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-0.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Colours
                      <LockButton
                        field="dominantColors"
                        lockedFields={lockedFields}
                        onToggle={toggleLock}
                      />
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.dominantColors.map((color) => (
                        <span
                          key={color}
                          className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card px-2.5 py-1 text-xs capitalize"
                        >
                          <span
                            className="h-3 w-3 rounded-full border border-black/10 shadow-sm"
                            style={{ backgroundColor: color }}
                            aria-hidden="true"
                          />
                          {color}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {f.motifs.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-0.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Motifs
                      <LockButton
                        field="motifs"
                        lockedFields={lockedFields}
                        onToggle={toggleLock}
                      />
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.motifs.map((motif) => (
                        <Badge
                          key={motif}
                          variant="outline"
                          className="capitalize"
                        >
                          {motif}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Categories
                    <button
                      type="button"
                      onClick={enterCatEdit}
                      className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                      title="Edit categories"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {f.categories.length > 0 ? (
                      f.categories.map((cat) => (
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
                      ))
                    ) : (
                      <span className="text-xs italic text-muted-foreground">
                        No categories
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CollectionDetailHero>

        {/* Record information belongs below the hero at full width. Keeping
            these panels out of the narrow image-side column matches the shared
            collection-detail contract and makes long AI/category data easier
            to scan. */}
        <CollectionDetailPanelStack>
          {/* Inventory */}
          <CollectionDetailSection title="Inventory">
            <CollectionDetailField
              label="Quantity"
              value={`${f.quantity} ${f.quantityUnit}`}
              editing={isEditing}
              editSlot={
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    value={field("quantity")}
                    onChange={(e) => set("quantity", e.target.value)}
                    type="number"
                    min="0"
                    step="0.25"
                    className="h-8 text-sm"
                  />
                  <Input
                    value={field("quantityUnit")}
                    onChange={(e) => set("quantityUnit", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="yards"
                  />
                </div>
              }
            />
            {(isEditing || f.widthInches != null) && (
              <CollectionDetailField
                label="Width (inches)"
                value={f.widthInches != null ? `${f.widthInches}"` : "—"}
                editing={isEditing}
                editSlot={
                  <Input
                    value={field("widthInches")}
                    onChange={(e) => set("widthInches", e.target.value)}
                    type="number"
                    min="0"
                    className="h-8 text-sm"
                  />
                }
              />
            )}
            {(isEditing || f.sku) && (
              <CollectionDetailField
                label="SKU"
                value={f.sku ?? "—"}
                valueClassName="font-mono"
                editing={isEditing}
                editSlot={
                  <Input
                    value={field("sku")}
                    onChange={(e) => set("sku", e.target.value)}
                    className="h-8 text-sm"
                  />
                }
              />
            )}
            {(isEditing || f.acquiredAt) && (
              <CollectionDetailField
                label="Acquired"
                value={f.acquiredAt ?? "—"}
                editing={isEditing}
                editSlot={
                  <Input
                    value={field("acquiredAt")}
                    onChange={(e) => set("acquiredAt", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="2024-01"
                  />
                }
              />
            )}
          </CollectionDetailSection>

          {/* Fabric details */}
          <CollectionDetailSection title="Fabric details">
            {(
              [
                ["name", "Name", f.name, true],
                ["lineName", "Line name", f.lineName, false],
                ["designer", "Designer", f.designer, false],
                ["manufacturer", "Manufacturer", f.manufacturer, false],
                ["colorway", "Colorway", f.colorway, false],
                ["printType", "Print type", f.printType, false],
                ["fiberContent", "Fibre content", f.fiberContent, false],
              ] as [
                keyof typeof draft & string,
                string,
                string | null | undefined,
                boolean,
              ][]
            )
              .filter(([, , v, editOnly]) => isEditing || (!editOnly && v))
              .map(([k, label, v]) => (
                <CollectionDetailField
                  key={k}
                  label={label}
                  value={v || "—"}
                  valueClassName="capitalize"
                  editing={isEditing}
                  editSlot={
                    <Input
                      value={field(k)}
                      onChange={(e) => set(k, e.target.value)}
                      className="h-8 text-sm"
                    />
                  }
                  locked={lockedFields.includes(k)}
                  onToggleLock={
                    AI_FIELDS.includes(k as keyof Fabric)
                      ? () => toggleLock(k)
                      : undefined
                  }
                />
              ))}
          </CollectionDetailSection>

          {/* Colors / Motifs */}
          {isEditing && (
            <CollectionDetailSection title="Characteristics">
              <CollectionDetailField
                label="Dominant colours"
                value={f.dominantColors.join(", ") || "—"}
                editing
                editSlot={
                  <Input
                    value={field("dominantColors")}
                    onChange={(e) => set("dominantColors", e.target.value)}
                    placeholder="red, blue, gold"
                    className="h-8 text-sm"
                  />
                }
                locked={lockedFields.includes("dominantColors")}
                onToggleLock={() => toggleLock("dominantColors")}
              />
              <CollectionDetailField
                label="Motifs"
                value={f.motifs.join(", ") || "—"}
                editing
                editSlot={
                  <Input
                    value={field("motifs")}
                    onChange={(e) => set("motifs", e.target.value)}
                    placeholder="floral, leaves"
                    className="h-8 text-sm"
                  />
                }
                locked={lockedFields.includes("motifs")}
                onToggleLock={() => toggleLock("motifs")}
              />
            </CollectionDetailSection>
          )}

          {/* Categories */}
          {(isEditing || catEditing) && (
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
                  disabled={updateFabric.isPending}
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
                        prev.some((c) => c.id === cat.id)
                          ? prev
                          : [...prev, cat],
                      );
                    }}
                    disabled={updateFabric.isPending}
                  />
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveCategories}
                      disabled={updateFabric.isPending}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      {updateFabric.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCatEditing(false)}
                      disabled={updateFabric.isPending}
                    >
                      <XIcon className="mr-1.5 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </div>
                </>
              ) : null}
            </CollectionDetailSection>
          )}

          {/* AI description */}

          {/* Pairings — fabrics that pair well */}
          <FabricPairings fabricId={f.id} />

          {/* Identity research */}
          <FabricIdentityResearchPanel fabricId={f.id} />

          {/* Notes */}
          <CollectionDetailSection title="Notes">
            {isEditing ? (
              <Textarea
                value={field("notes")}
                onChange={(e) => set("notes", e.target.value)}
                rows={4}
                className="text-sm"
                placeholder="Any notes about this fabric…"
              />
            ) : f.notes ? (
              <p className="text-sm leading-relaxed">{f.notes}</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">No notes</p>
            )}
          </CollectionDetailSection>

          {/* Lock hint */}
          {!isEditing && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <LockOpen className="h-3 w-3" />
              Tap a lock icon to protect a field from AI updates.
            </p>
          )}
        </CollectionDetailPanelStack>
      </div>

      <FabricCreaseRemoverModal
        fabricId={f.id}
        fabricName={f.name}
        imageUrl={f.imageUrl}
        open={creaseModalOpen}
        onClose={() => setCreaseModalOpen(false)}
      />
    </>
  );
}
