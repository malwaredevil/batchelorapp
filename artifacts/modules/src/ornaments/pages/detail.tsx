import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import {
  Loader2,
  Trash2,
  Search,
  ShoppingBag,
  RefreshCcw,
  Download,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { ImageLightbox } from "@/quilting/components/image-lightbox";
import { ItemImageGallery } from "@workspace/image-capture";
import {
  useGetOrnament,
  useUpdateOrnament,
  useDeleteOrnament,
  useLookupOrnamentBookValue,
  useLookupOrnamentEbayPrice,
  useReanalyzeOrnament,
  getGetOrnamentQueryKey,
  getListOrnamentsQueryKey,
  useSetOrnamentPrimaryImage,
  useDeleteOrnamentImage,
  useUploadOrnamentImage,
  getUploadErrorMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { useAppConfigSummary } from "@workspace/elaine-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CategorySelector } from "@/ornaments/components/category-selector";
import { generateInsurancePdf } from "@/ornaments/lib/pdf-export";
import { IdentityResearchPanel } from "@/ornaments/components/IdentityResearchPanel";
import { SeriesLinkPanel } from "@/ornaments/components/SeriesLinkPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CollectionDetailLayout,
  CollectionDetailSkeleton,
  CollectionDetailField,
  CollectionDetailSection,
} from "@workspace/collection-ui";

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default function OrnamentDetail() {
  const [, params] = useRoute("/ornaments/ornament/:id");
  const id = Number(params?.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const {
    data: ornament,
    isLoading,
    isError,
  } = useGetOrnament(id, {
    query: { enabled: !!id, queryKey: getGetOrnamentQueryKey(id) },
  });

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    brand: "",
    series: "",
    year: "",
    notes: "",
    aiDesc: "",
    dimensions: "",
    condition: "",
  });
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [ebayResult, setEbayResult] = useState<{
    priceMinUsd: number;
    priceMaxUsd: number;
    priceMedianUsd: number;
    listingCount: number;
    searchQuery?: string;
  } | null>(null);

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "ornaments-detail",
    ornament
      ? [
          `Ornament detail — itemId: ${ornament.id}`,
          `Name: "${ornament.name || ""}"`,
          ornament.brand ? `Brand: ${ornament.brand}` : null,
          ornament.seriesOrCollection
            ? `Series/Collection: "${ornament.seriesOrCollection}"`
            : null,
          ornament.year ? `Year: ${ornament.year}` : null,
          ornament.barcodeValue
            ? `Barcode/UPC: ${ornament.barcodeValue}`
            : null,
          ornament.condition ? `Condition: ${ornament.condition}` : null,
          ornament.bookValue != null
            ? `Book value on file: $${ornament.bookValue.toFixed(2)}${ornament.bookValueSource ? ` (source: ${ornament.bookValueSource})` : ""}`
            : "No book value on file yet.",
          ornament.aiDescription
            ? `AI description: "${ornament.aiDescription.slice(0, 200)}"`
            : null,
          configSummary ? `\n${configSummary}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : `Loading ornament ${id}...`,
  );

  const updateOrnament = useUpdateOrnament({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetOrnamentQueryKey(id), data);
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        setIsEditing(false);
        toast.success("Saved.");
      },
      onError: () => toast.error("Could not save changes."),
    },
  });

  const deleteOrnament = useDeleteOrnament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        toast.success("Ornament deleted");
        setLocation("/ornaments/");
      },
      onError: () => toast.error("Failed to delete ornament"),
    },
  });

  const lookupBookValue = useLookupOrnamentBookValue();
  const lookupEbay = useLookupOrnamentEbayPrice();
  const reanalyze = useReanalyzeOrnament();
  const addImage = useUploadOrnamentImage(id);
  const setPrimaryImage = useSetOrnamentPrimaryImage();
  const deleteImage = useDeleteOrnamentImage();

  function enterEdit() {
    if (!ornament) return;
    setDraft({
      name: ornament.name || "",
      brand: ornament.brand || "Hallmark",
      series: ornament.seriesOrCollection || "",
      year: ornament.year ? String(ornament.year) : "",
      notes: ornament.notes || "",
      aiDesc: ornament.aiDescription || "",
      dimensions: ornament.dimensions || "",
      condition: ornament.condition || "",
    });
    setSelectedCategoryIds(ornament.categories?.map((c) => c.id) || []);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  function save() {
    if (!draft.name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    updateOrnament.mutate({
      id,
      data: {
        name: draft.name.trim(),
        brand: draft.brand.trim() || undefined,
        seriesOrCollection: draft.series.trim() || undefined,
        year: draft.year ? parseInt(draft.year, 10) : undefined,
        notes: draft.notes.trim() || undefined,
        aiDescription: draft.aiDesc.trim() || undefined,
        dimensions: draft.dimensions.trim() || undefined,
        condition: draft.condition.trim() || undefined,
        categoryIds: selectedCategoryIds,
      },
    });
  }

  function toggleFieldLock(field: string) {
    if (!ornament) return;
    const current = ornament.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((f) => f !== field)
      : [...current, field];
    updateOrnament.mutate({ id, data: { lockedFields: next } });
  }

  const handleLookupPrice = async () => {
    if (!ornament?.name) return;
    try {
      toast.loading("Scraping for book value...", { id: "price" });
      const result = await lookupBookValue.mutateAsync({ id });
      toast.dismiss("price");
      if (result.bookValue) {
        toast.success(`Found estimate: ${formatCurrency(result.bookValue)}`);
        queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
      } else {
        toast.error("No reliable price data found on Hallmark value sites.");
      }
    } catch {
      toast.dismiss("price");
      toast.error("Failed to lookup book value");
    }
  };

  const handleLookupEbayPrice = async () => {
    if (!ornament?.name) return;
    try {
      toast.loading("Searching eBay sold listings…", { id: "ebay" });
      const result = await lookupEbay.mutateAsync({ id });
      toast.dismiss("ebay");
      if (result.listingCount > 0) {
        setEbayResult(result);
        toast.success(
          `Found ${result.listingCount} sold listing${result.listingCount !== 1 ? "s" : ""} — median $${result.priceMedianUsd.toFixed(0)}`,
        );
        queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
      } else {
        toast.error("No eBay sold listings found for this ornament.");
      }
    } catch {
      toast.dismiss("ebay");
      toast.error("Failed to look up eBay price");
    }
  };

  const handleReanalyze = async () => {
    try {
      toast.loading("Analyzing image...", { id: "analyze" });
      const result = await reanalyze.mutateAsync({ id });
      toast.dismiss("analyze");
      toast.success("Analysis complete");
      queryClient.setQueryData(getGetOrnamentQueryKey(id), result);
      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
    } catch {
      toast.dismiss("analyze");
      toast.error("Analysis failed");
    }
  };

  const handleExportPdf = async () => {
    if (!ornament) return;
    setExportingPdf(true);
    try {
      await generateInsurancePdf([ornament], () => {});
      toast.success("PDF generated");
    } catch {
      toast.error("PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  const handleReplaceImage = async (
    imageId: number,
    isPrimary: boolean,
    file: File,
  ) => {
    const endpoint = isPrimary
      ? `/api/ornaments/items/${id}/image`
      : `/api/ornaments/items/${id}/images/${imageId}`;
    const form = new FormData();
    form.append("image", file, "photo.jpg");
    const resp = await fetch(endpoint, {
      method: "PUT",
      body: form,
      credentials: "include",
    });
    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? "Failed to save photo");
    }
    queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
    toast.success("Photo updated");
  };

  const lightboxImages = useMemo(() => {
    const supplemental = (ornament?.images ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((img) => img.url);
    return ornament?.imageUrl
      ? [ornament.imageUrl, ...supplemental]
      : supplemental;
  }, [ornament?.images, ornament?.imageUrl]);

  if (isLoading) return <CollectionDetailSkeleton />;

  if (isError || !ornament) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
        <h1 className="text-2xl font-bold mb-2">Ornament not found</h1>
        <Button variant="outline" onClick={() => setLocation("/ornaments/")}>
          Return to collection
        </Button>
      </div>
    );
  }

  const lockedFields = ornament.lockedFields ?? [];

  return (
    <>
      <CollectionDetailLayout
        backLabel="Collection"
        onBack={() => setLocation("/ornaments/")}
        gallery={
          <div className="space-y-4">
            <ItemImageGallery
              images={[
                {
                  id: -1,
                  url: ornament.imageUrl,
                  label: null,
                  isPrimary: true,
                },
                ...(ornament.images ?? [])
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((img) => ({
                    id: img.id,
                    url: img.url,
                    label: null,
                    isPrimary: false,
                  })),
              ]}
              onAddImage={async (file) => {
                const formData = new FormData();
                formData.append("image", file);
                await addImage.mutateAsync(formData).catch((err) => {
                  toast.error(
                    getUploadErrorMessage(err, "Failed to upload image"),
                  );
                  throw err;
                });
                queryClient.invalidateQueries({
                  queryKey: getGetOrnamentQueryKey(id),
                });
                toast.success("Photo added");
              }}
              onReplaceImage={handleReplaceImage}
              onDeleteImage={(imageId, isPrimary) => {
                if (isPrimary) {
                  toast.error(
                    "Set another photo as primary first, then you can delete this one.",
                  );
                  return;
                }
                void deleteImage
                  .mutateAsync({ id, imageId })
                  .then(() => {
                    queryClient.invalidateQueries({
                      queryKey: getGetOrnamentQueryKey(id),
                    });
                    toast.success("Image removed");
                  })
                  .catch(() => toast.error("Failed to remove image"));
              }}
              onSetPrimary={(imageId) =>
                void setPrimaryImage
                  .mutateAsync({ id, data: { imageId } })
                  .then(() => {
                    queryClient.invalidateQueries({
                      queryKey: getGetOrnamentQueryKey(id),
                    });
                    queryClient.invalidateQueries({
                      queryKey: getListOrnamentsQueryKey(),
                    });
                    toast.success("Primary image updated");
                  })
                  .catch(() => toast.error("Failed to set primary image"))
              }
              onZoom={(url) => {
                const idx = lightboxImages.indexOf(url);
                if (idx >= 0) setLightboxIndex(idx);
              }}
              isUploading={addImage.isPending}
              maxImages={10}
            />

            {/* Book value card */}
            {ornament.bookValue != null && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-center">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Estimated Value
                </p>
                <p className="text-3xl font-serif font-bold text-primary">
                  {formatCurrency(ornament.bookValue)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Source: {ornament.bookValueSource} <br />
                  Updated:{" "}
                  {new Date(ornament.bookValueUpdatedAt!).toLocaleDateString()}
                </p>
              </div>
            )}

            {/* eBay results */}
            {ebayResult && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-amber-900 uppercase tracking-wider">
                    eBay Sold Listings
                  </p>
                  <button
                    onClick={() => setEbayResult(null)}
                    className="text-amber-500 hover:text-amber-700 text-xs"
                  >
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-amber-800">
                      ${ebayResult.priceMinUsd.toFixed(0)}
                    </p>
                    <p className="text-[10px] text-amber-600">Low</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-amber-800">
                      ${ebayResult.priceMedianUsd.toFixed(0)}
                    </p>
                    <p className="text-[10px] text-amber-600">Median</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-amber-800">
                      ${ebayResult.priceMaxUsd.toFixed(0)}
                    </p>
                    <p className="text-[10px] text-amber-600">High</p>
                  </div>
                </div>
                <p className="text-[10px] text-amber-600 mt-2 text-center">
                  {ebayResult.listingCount} sold listing
                  {ebayResult.listingCount !== 1 ? "s" : ""} ·{" "}
                  {ebayResult.searchQuery && `"${ebayResult.searchQuery}"`}
                </p>
              </div>
            )}
          </div>
        }
        titleSlot={
          isEditing ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                className="text-lg font-bold"
                autoFocus
                data-testid="input-edit-name"
              />
            </div>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-0.5">
                {ornament.brand || "Hallmark"}
                {ornament.year ? ` · ${ornament.year}` : ""}
              </p>
              <h1
                className="text-2xl font-bold tracking-tight leading-tight"
                data-testid="text-detail-name"
              >
                {ornament.name}
              </h1>
            </div>
          )
        }
        actions={
          isEditing ? (
            <>
              <Button
                size="sm"
                onClick={save}
                disabled={updateOrnament.isPending}
                data-testid="button-save"
              >
                {updateOrnament.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={handleLookupPrice}
                disabled={lookupBookValue.isPending}
                title="Look up book value"
                data-testid="button-book-value"
              >
                {lookupBookValue.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleLookupEbayPrice}
                disabled={lookupEbay.isPending}
                title="Look up eBay price"
                data-testid="button-ebay-price"
              >
                {lookupEbay.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingBag className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleReanalyze}
                disabled={reanalyze.isPending}
                title="Re-run AI analysis"
                data-testid="button-reanalyze"
              >
                {reanalyze.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExportPdf}
                disabled={exportingPdf}
                title="Export PDF"
              >
                {exportingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={enterEdit}
                title="Edit"
                data-testid="button-edit"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    data-testid="button-delete"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove this ornament?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes "{ornament.name}" and all its
                      photos. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteOrnament.mutate({ id })}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="button-confirm-delete"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )
        }
        fields={
          <>
            <CollectionDetailField
              label="Brand"
              value={ornament.brand || "—"}
              locked={lockedFields.includes("brand")}
              onToggleLock={
                !isEditing ? () => toggleFieldLock("brand") : undefined
              }
              editing={isEditing}
              editSlot={
                <Input
                  value={draft.brand}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, brand: e.target.value }))
                  }
                  placeholder="e.g. Hallmark"
                  className="h-8 text-sm"
                />
              }
              empty={!ornament.brand}
            />
            <CollectionDetailField
              label="Year"
              value={ornament.year?.toString() ?? "—"}
              locked={lockedFields.includes("year")}
              onToggleLock={
                !isEditing ? () => toggleFieldLock("year") : undefined
              }
              editing={isEditing}
              editSlot={
                <Input
                  type="number"
                  value={draft.year}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, year: e.target.value }))
                  }
                  placeholder="e.g. 2023"
                  className="h-8 text-sm"
                />
              }
              empty={!ornament.year}
            />
            <CollectionDetailField
              label="Series / Collection"
              value={ornament.seriesOrCollection || "—"}
              locked={lockedFields.includes("seriesOrCollection")}
              onToggleLock={
                !isEditing
                  ? () => toggleFieldLock("seriesOrCollection")
                  : undefined
              }
              editing={isEditing}
              editSlot={
                <Input
                  value={draft.series}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, series: e.target.value }))
                  }
                  className="h-8 text-sm"
                />
              }
              empty={!ornament.seriesOrCollection}
            />
            <CollectionDetailField
              label="Condition"
              value={ornament.condition || "—"}
              locked={lockedFields.includes("condition")}
              onToggleLock={
                !isEditing ? () => toggleFieldLock("condition") : undefined
              }
              editing={isEditing}
              editSlot={
                <Input
                  value={draft.condition}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, condition: e.target.value }))
                  }
                  placeholder="e.g. Mint in Box"
                  className="h-8 text-sm"
                />
              }
              empty={!ornament.condition}
            />
            <CollectionDetailField
              label="Dimensions"
              value={ornament.dimensions || "—"}
              locked={lockedFields.includes("dimensions")}
              onToggleLock={
                !isEditing ? () => toggleFieldLock("dimensions") : undefined
              }
              editing={isEditing}
              editSlot={
                <Input
                  value={draft.dimensions}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, dimensions: e.target.value }))
                  }
                  placeholder="e.g. 4×3×2 in"
                  className="h-8 text-sm"
                />
              }
              empty={!ornament.dimensions}
            />
            {(isEditing || ornament.notes) && (
              <CollectionDetailField
                label="Notes"
                value={ornament.notes || "—"}
                editing={isEditing}
                editSlot={
                  <Textarea
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, notes: e.target.value }))
                    }
                    placeholder="Memories, condition notes, where it was bought..."
                    className="text-sm min-h-[80px]"
                  />
                }
                empty={!ornament.notes}
              />
            )}

            {/* Categories */}
            {isEditing ? (
              <div className="py-1.5 border-b border-border/60 last:border-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  Categories
                </p>
                <CategorySelector
                  value={selectedCategoryIds}
                  onChange={setSelectedCategoryIds}
                />
              </div>
            ) : ornament.categories?.length ? (
              <div className="py-1.5 border-b border-border/60 last:border-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  Categories
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ornament.categories.map((cat) => (
                    <Badge
                      key={cat.id}
                      variant="secondary"
                      className="bg-secondary/50 font-normal"
                    >
                      {cat.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        }
        panels={
          <>
            {/* AI Description */}
            {(isEditing || ornament.aiDescription) && (
              <CollectionDetailSection
                title="AI Description"
                action={
                  !isEditing && ornament.aiDescription ? (
                    <button
                      type="button"
                      onClick={() => toggleFieldLock("aiDescription")}
                      title={
                        lockedFields.includes("aiDescription")
                          ? "Locked — AI won't overwrite. Click to unlock."
                          : "Click to lock — AI won't overwrite."
                      }
                      className={
                        lockedFields.includes("aiDescription")
                          ? "text-primary"
                          : "text-muted-foreground/40 hover:text-muted-foreground"
                      }
                    >
                      {lockedFields.includes("aiDescription") ? (
                        <span className="text-xs">🔒</span>
                      ) : (
                        <span className="text-xs">🔓</span>
                      )}
                    </button>
                  ) : undefined
                }
              >
                {isEditing ? (
                  <Textarea
                    value={draft.aiDesc}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, aiDesc: e.target.value }))
                    }
                    className="text-sm min-h-[100px] leading-relaxed"
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {ornament.aiDescription}
                  </p>
                )}
              </CollectionDetailSection>
            )}

            {/* Colors + Motifs (view only) */}
            {!isEditing &&
              (ornament.dominantColors?.length || ornament.motifs?.length) && (
                <div className="flex flex-wrap gap-2">
                  {ornament.dominantColors?.map((c) => (
                    <Badge
                      key={c}
                      variant="outline"
                      className="font-normal flex items-center gap-1"
                    >
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: c }}
                      />
                      {c}
                    </Badge>
                  ))}
                  {ornament.motifs?.map((m) => (
                    <Badge
                      key={m}
                      variant="secondary"
                      className="bg-secondary/50 font-normal"
                    >
                      {m}
                    </Badge>
                  ))}
                </div>
              )}

            <IdentityResearchPanel itemId={ornament.id} />
            <SeriesLinkPanel itemId={ornament.id} />
          </>
        }
      />

      <ImageLightbox
        src={
          lightboxIndex !== null ? (lightboxImages[lightboxIndex] ?? "") : ""
        }
        open={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        images={lightboxImages}
        currentIndex={lightboxIndex ?? 0}
        onNavigate={setLightboxIndex}
      />
    </>
  );
}
