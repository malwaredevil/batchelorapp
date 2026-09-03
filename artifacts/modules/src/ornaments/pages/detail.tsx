import { useState, useMemo, useEffect, useRef } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import {
  Loader2,
  AlertCircle,
  Camera,
  Trash2,
  RefreshCcw,
  Download,
  Pencil,
  Save,
  X,
  TrendingDown,
  TrendingUp,
  Minus,
  ScanBarcode,
} from "lucide-react";
import { ImageLightbox } from "@/quilting/components/image-lightbox";
import {
  ItemImageGallery,
  type ItemImageGalleryHandle,
} from "@workspace/image-capture";
import {
  useGetOrnament,
  useUpdateOrnament,
  useDeleteOrnament,
  useRefreshAllOrnamentData,
  useLookupOrnamentEbayPrice,
  useLookupOrnamentRetailValue,
  useListOrnamentCategories,
  getGetOrnamentQueryKey,
  getGetOrnamentStragglersQueryKey,
  getListOrnamentsQueryKey,
  getListOrnamentCategoriesQueryKey,
  getListOrnamentSeriesQueryKey,
  useSetOrnamentPrimaryImage,
  useDeleteOrnamentImage,
  useUploadOrnamentImage,
  useRefreshOrnamentIdentity,
  useUpdateOrnamentImage,
  getUploadErrorMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import {
  useAppConfigSummary,
  formatElaineContextEntity,
} from "@workspace/elaine-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TagSelector } from "@/ornaments/components/tag-selector";
import { SeriesAutocomplete } from "@/ornaments/components/series-autocomplete";
import { BarcodeScannerDialog } from "@/ornaments/components/barcode-scanner-dialog";
import { generateInsurancePdf } from "@/ornaments/lib/pdf-export";
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
  InfoTooltip,
  trackAsyncAction,
  isAsyncActionBusy,
  useAsyncActionStatus,
} from "@workspace/collection-ui";
import { OrnamentEbayPriceSection } from "@/ornaments/components/OrnamentEbayPriceSection";
import { ornamentReanalyzeKey } from "@/ornaments/lib/reanalyze-status";
import { resolveCategoryPalette } from "@workspace/web-core/colors";
import {
  parseAiAppraisalRange,
  computeConsensusValue,
} from "@workspace/ornaments-shared";
import {
  ornamentMaintenanceReasonLabels,
  parseOrnamentMaintenanceReasons,
} from "@/ornaments/lib/maintenance-repair";

function formatCurrency(amount: number | string | null | undefined): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString();
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
  const { data: allCategories = [] } = useListOrnamentCategories();

  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const editRequested = searchParams.get("edit") === "1";
  const repairPhoto = searchParams.get("repair") === "photo";
  const focusField = searchParams.get("focus");
  const repairFields = parseOrnamentMaintenanceReasons(search);
  const [isEditing, setIsEditing] = useState(false);
  const repairInitializationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editRequested && !focusField) {
      repairInitializationRef.current = null;
      return;
    }
    if (!ornament) {
      return;
    }
    const repairEntryKey = `${id}:${editRequested}:${focusField ?? ""}`;
    if (repairInitializationRef.current === repairEntryKey) {
      return;
    }
    repairInitializationRef.current = repairEntryKey;
    setDraft({
      name: ornament.name || "",
      brand: ornament.brand || "Hallmark",
      series: ornament.seriesOrCollection || "",
      year: ornament.year ? String(ornament.year) : "",
      notes: ornament.notes || "",
      aiDesc: ornament.aiDescription || "",
      boxDescription: ornament.description || "",
      dimensions: ornament.dimensions || "",
      barcode: ornament.barcodeValue || "",
    });
    setSelectedCategoryIds(
      ornament.categories?.map((category) => category.id) || [],
    );
    setIsEditing(true);
  }, [editRequested, focusField, id, ornament]);
  const [draft, setDraft] = useState({
    name: "",
    brand: "",
    series: "",
    year: "",
    notes: "",
    aiDesc: "",
    boxDescription: "",
    dimensions: "",
    barcode: "",
  });
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);
  const galleryRef = useRef<ItemImageGalleryHandle>(null);

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "ornaments-detail",
    ornament
      ? [
          `Ornament detail: ${formatElaineContextEntity({ entity: "ornament", id: ornament.id, label: ornament.name || "" })}`,
          ornament.brand ? `Brand: ${ornament.brand}` : null,
          ornament.seriesOrCollection
            ? `Series/Collection: "${ornament.seriesOrCollection}"`
            : null,
          ornament.year ? `Year: ${ornament.year}` : null,
          ornament.barcodeValue
            ? `Barcode/UPC: ${ornament.barcodeValue}`
            : null,
          ornament.bookValue != null
            ? `Book value on file: $${Number(ornament.bookValue).toFixed(2)}${ornament.bookValueSource ? ` (source: ${ornament.bookValueSource})` : ""}`
            : "No book value on file yet.",
          ornament.retailValueUsd != null
            ? `Retail value on file: $${Number(ornament.retailValueUsd).toFixed(2)}${ornament.retailValueSource ? ` (source: ${ornament.retailValueSource})` : ""}${ornament.retailValueProductUrl ? ` — product page: ${ornament.retailValueProductUrl}` : ""}`
            : "No retail value on file yet.",
          ornament.aiAppraisal
            ? `AI appraisal: "${ornament.aiAppraisal.slice(0, 200)}"`
            : null,
          ornament.aiDescription
            ? `AI description: "${ornament.aiDescription.slice(0, 200)}"`
            : null,
          ornament.description
            ? `Box description (${ornament.descriptionGenerated ? "AI-generated stand-in, no real box text was found" : "verbatim text printed on the box"}): "${ornament.description.slice(0, 300)}"`
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
        queryClient.invalidateQueries({
          queryKey: getListOrnamentSeriesQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentStragglersQueryKey(),
        });
        setIsEditing(false);
        if (editRequested || focusField) {
          setLocation(`/ornaments/ornament/${id}`, { replace: true });
        }
        toast.success("Saved.");
      },
      onError: () => toast.error("Could not save changes."),
    },
  });

  const deleteOrnament = useDeleteOrnament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getListOrnamentSeriesQueryKey(),
        });
        toast.success("Ornament deleted");
        setLocation("/ornaments/");
      },
      onError: () => toast.error("Failed to delete ornament"),
    },
  });

  const refreshAll = useRefreshAllOrnamentData();
  const lookupEbayPrice = useLookupOrnamentEbayPrice();
  const [forceEbayRefreshing, setForceEbayRefreshing] = useState(false);
  const lookupRetailValue = useLookupOrnamentRetailValue();
  const [retailValueLookupBusy, setRetailValueLookupBusy] = useState(false);
  const addImage = useUploadOrnamentImage(id);
  const refreshIdentity = useRefreshOrnamentIdentity();
  const setPrimaryImage = useSetOrnamentPrimaryImage();
  const deleteImage = useDeleteOrnamentImage();
  const relabelImage = useUpdateOrnamentImage();

  function enterEdit() {
    if (!ornament) return;
    setDraft({
      name: ornament.name || "",
      brand: ornament.brand || "Hallmark",
      series: ornament.seriesOrCollection || "",
      year: ornament.year ? String(ornament.year) : "",
      notes: ornament.notes || "",
      aiDesc: ornament.aiDescription || "",
      boxDescription: ornament.description || "",
      dimensions: ornament.dimensions || "",
      barcode: ornament.barcodeValue || "",
    });
    setSelectedCategoryIds(ornament.categories?.map((c) => c.id) || []);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  function toggleCategory(catId: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((x) => x !== catId) : [...prev, catId],
    );
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
        description: draft.boxDescription.trim() || undefined,
        dimensions: draft.dimensions.trim() || undefined,
        barcodeValue: draft.barcode.trim() || undefined,
        categoryIds: selectedCategoryIds,
      },
    });
  }

  function handleScannedBarcode(barcode: string) {
    if (isEditing) {
      setDraft((current) => ({ ...current, barcode }));
      toast.success("Barcode added to the draft. Save to keep it.");
      return;
    }
    updateOrnament.mutate({ id, data: { barcodeValue: barcode } });
  }

  function toggleFieldLock(field: string) {
    if (!ornament) return;
    const current = ornament.lockedFields ?? [];
    const next = current.includes(field)
      ? current.filter((f) => f !== field)
      : [...current, field];
    updateOrnament.mutate({ id, data: { lockedFields: next } });
  }

  // Shared with the gallery card's plain "Refresh AI" action (see
  // reanalyze-status.ts) — both trigger AI vision reanalysis for this same
  // item, so they share one busy flag to avoid a duplicate AI call when the
  // user triggers one from the gallery, opens the item, and can't tell the
  // first is still running.
  const reanalyzeKey = ornamentReanalyzeKey(id);
  const reanalyzeStatus = useAsyncActionStatus(reanalyzeKey);
  const refreshAllBusy =
    refreshAll.isPending || reanalyzeStatus === "processing";

  const handleRefreshAll = async () => {
    if (isAsyncActionBusy(reanalyzeKey)) {
      toast.info("AI refresh is already running for this item — hang tight.");
      return;
    }
    toast.loading(
      "Refreshing AI analysis, book value, eBay prices, and appraisal…",
      { id: "refresh-all" },
    );
    const promise = refreshAll.mutateAsync({ id });
    trackAsyncAction(reanalyzeKey, promise);
    try {
      const result = await promise;
      toast.dismiss("refresh-all");
      toast.success("All data refreshed");
      queryClient.setQueryData(getGetOrnamentQueryKey(id), result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getListOrnamentCategoriesQueryKey(),
        }),
      ]);
    } catch {
      toast.dismiss("refresh-all");
      toast.error("Refresh failed — check connection and try again");
    }
  };

  const handleEbayLookup = async (force = false) => {
    try {
      if (force) {
        setForceEbayRefreshing(true);
      } else {
        toast.loading("Searching eBay listings…", { id: "ebay" });
      }
      await lookupEbayPrice.mutateAsync({
        id,
        data: force ? { force: true } : undefined,
      });
      if (!force) toast.dismiss("ebay");
      queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
      if (force) {
        toast.success("eBay prices refreshed");
      } else {
        toast.success("eBay prices updated");
      }
    } catch {
      if (!force) toast.dismiss("ebay");
      toast.error("eBay lookup failed — try again");
    } finally {
      if (force) setForceEbayRefreshing(false);
    }
  };

  const handleRetailValueLookup = async () => {
    try {
      setRetailValueLookupBusy(true);
      await lookupRetailValue.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
      toast.success("Retail value updated");
    } catch {
      toast.error("Could not find a retail value for this ornament");
    } finally {
      setRetailValueLookupBusy(false);
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

  const handleAddImage = async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    await addImage.mutateAsync(formData).catch((err) => {
      toast.error(getUploadErrorMessage(err, "Failed to upload image"));
      throw err;
    });

    if (!repairPhoto) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentQueryKey(id),
        }),
        queryClient.invalidateQueries({
          queryKey: getListOrnamentsQueryKey(),
        }),
      ]);
      toast.success("Photo added. Complete-photo analysis is scheduled.");
      return;
    }

    toast.loading("Refreshing only the missing identity details…", {
      id: "identity-refresh",
    });
    try {
      const result = await refreshIdentity.mutateAsync({ id });
      queryClient.setQueryData(getGetOrnamentQueryKey(id), result.item);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getListOrnamentsQueryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: getListOrnamentCategoriesQueryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentStragglersQueryKey(),
        }),
      ]);
      toast.dismiss("identity-refresh");
      if (result.unresolvedFields.length > 0) {
        setLocation(
          `/ornaments/ornament/${id}?repair=photo&missing=${encodeURIComponent(
            result.unresolvedFields.join(","),
          )}`,
          { replace: true },
        );
        toast.message(
          `Photo added. Still unknown: ${result.unresolvedFields
            .map((field) => ornamentMaintenanceReasonLabels[field])
            .join(", ")}.`,
        );
      } else {
        setLocation(`/ornaments/ornament/${id}`, { replace: true });
        toast.success("Photo added and maintenance is up to date.");
      }
    } catch {
      toast.dismiss("identity-refresh");
      toast.error(
        "Photo added, but the identity refresh could not finish. Try again from Maintenance.",
      );
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

  // eBay data from stored fields
  const hasEbayData =
    ornament.ebayPriceCachedAt != null || ornament.ebayLastSoldPriceUsd != null;
  const hasEbayForSale =
    ornament.ebayPriceMinUsd != null && ornament.ebayPriceMaxUsd != null;
  const hasEbayLastSold = ornament.ebayLastSoldPriceUsd != null;

  // Computed valuation values (all read-only, derived from stored data)
  const ebayMid = hasEbayForSale
    ? (Number(ornament.ebayPriceMinUsd) + Number(ornament.ebayPriceMaxUsd)) / 2
    : null;

  // Parse dollar range from AI appraisal prose (e.g. "appraises for $10–$18")
  const { low: aiAppraisalLow, high: aiAppraisalHigh } = parseAiAppraisalRange(
    ornament.aiAppraisal,
  );
  const aiMid =
    aiAppraisalLow != null && aiAppraisalHigh != null
      ? (aiAppraisalLow + aiAppraisalHigh) / 2
      : null;

  const vsBook =
    ebayMid != null && ornament.bookValue != null
      ? ebayMid - Number(ornament.bookValue)
      : null;
  const vsBookPct =
    vsBook != null && ornament.bookValue != null
      ? (vsBook / Number(ornament.bookValue)) * 100
      : null;

  const consensus = computeConsensusValue({
    bookValue: ornament.bookValue != null ? Number(ornament.bookValue) : null,
    ebayPriceMinUsd:
      ornament.ebayPriceMinUsd != null
        ? Number(ornament.ebayPriceMinUsd)
        : null,
    ebayPriceMaxUsd:
      ornament.ebayPriceMaxUsd != null
        ? Number(ornament.ebayPriceMaxUsd)
        : null,
    aiAppraisal: ornament.aiAppraisal,
  });

  const hasValuationData =
    ornament.bookValue != null || hasEbayData || !!ornament.aiAppraisal;
  const hasCalcData = ebayMid != null || consensus != null;

  return (
    <>
      <CollectionDetailLayout
        backLabel="Collection"
        onBack={() => setLocation("/ornaments/")}
        gallery={
          <div className="space-y-4">
            {repairFields.length > 0 && (
              <div
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
                data-testid="identity-repair-summary"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div className="min-w-0 space-y-2">
                    <div>
                      <p className="font-medium">Identity evidence needed</p>
                      <p className="text-sm text-muted-foreground">
                        Still unknown:{" "}
                        {repairFields
                          .map(
                            (field) => ornamentMaintenanceReasonLabels[field],
                          )
                          .join(", ")}
                        . Locked fields stay unchanged during a refresh.
                      </p>
                    </div>
                    {repairPhoto && (
                      <Button
                        size="sm"
                        onClick={() => galleryRef.current?.openFilePicker()}
                        disabled={
                          addImage.isPending || refreshIdentity.isPending
                        }
                        className="gap-2"
                        data-testid="button-repair-upload"
                      >
                        {addImage.isPending || refreshIdentity.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Camera className="h-4 w-4" />
                        )}
                        Upload evidence photo
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <ItemImageGallery
              ref={galleryRef}
              mainImageClassName="aspect-[4/3] max-h-[55vh] w-full object-cover"
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
                    label: img.label ?? null,
                    isPrimary: false,
                  })),
              ]}
              onAddImage={handleAddImage}
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
              onRelabel={(imageId, label) =>
                relabelImage
                  .mutateAsync({ id, imageId, data: { label } })
                  .then(() => {
                    queryClient.invalidateQueries({
                      queryKey: getGetOrnamentQueryKey(id),
                    });
                    toast.success("Label saved.");
                  })
                  .catch(() => {
                    toast.error("Failed to save label");
                  })
              }
              onZoom={(url) => {
                const idx = lightboxImages.indexOf(url);
                if (idx >= 0) setLightboxIndex(idx);
              }}
              isUploading={addImage.isPending || refreshIdentity.isPending}
              maxImages={10}
            />
          </div>
        }
        reminder={
          isEditing
            ? undefined
            : {
                entityType: "ornament",
                entityId: ornament.id,
                defaultTitle: `Reminder: ${ornament.name}`,
              }
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
                onClick={() => setBarcodeScannerOpen(true)}
                title="Scan UPC / barcode"
                aria-label="Scan UPC / barcode"
                data-testid="button-scan-barcode"
              >
                <ScanBarcode className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleEbayLookup(false)}
                disabled={lookupEbayPrice.isPending}
                title="Look up eBay market value"
              >
                {lookupEbayPrice.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefreshAll}
                disabled={refreshAllBusy}
                title={
                  reanalyzeStatus === "processing" && !refreshAll.isPending
                    ? "AI refresh already running (started from the gallery)"
                    : "Refresh all — AI analysis, book value, eBay prices, and AI appraisal"
                }
                data-testid="button-reanalyze"
              >
                {refreshAllBusy ? (
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
        heroContent={
          !isEditing ? (
            <div className="space-y-4">
              {ornament.description && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Box Description
                    {ornament.descriptionGenerated && (
                      <span
                        className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground"
                        title="No legible text was found on the box, so the AI wrote a similar stand-in description instead of a verbatim transcription."
                      >
                        AI-generated
                      </span>
                    )}
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground italic">
                    “{ornament.description}”
                  </p>
                </div>
              )}

              {(ornament.aiDescription || ornament.notes) && (
                <div className="space-y-2">
                  {ornament.aiDescription && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                        AI Summary
                      </p>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {ornament.aiDescription}
                      </p>
                    </div>
                  )}
                  {ornament.notes && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {ornament.notes}
                    </p>
                  )}
                </div>
              )}

              {ornament.categories?.length ? (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Categories
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ornament.categories.map((cat) => {
                      const palette = resolveCategoryPalette(cat);
                      return (
                        <Badge
                          key={cat.id}
                          className="font-normal"
                          style={{
                            backgroundColor: palette.bgColor,
                            color: palette.textColor,
                            borderColor: "transparent",
                          }}
                        >
                          {cat.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {ornament.seriesOrCollection && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="font-normal">
                    {ornament.seriesOrCollection}
                  </Badge>
                </div>
              )}
            </div>
          ) : null
        }
        fields={
          <>
            {!isEditing && (
              <>
                <CollectionDetailField
                  label="Brand"
                  value={ornament.brand || "—"}
                  locked={lockedFields.includes("brand")}
                  onToggleLock={() => toggleFieldLock("brand")}
                  empty={!ornament.brand}
                />
                <CollectionDetailField
                  label="Year"
                  value={ornament.year?.toString() ?? "—"}
                  locked={lockedFields.includes("year")}
                  onToggleLock={() => toggleFieldLock("year")}
                  empty={!ornament.year}
                  highlighted={
                    repairFields.includes("year") || focusField === "year"
                  }
                />
              </>
            )}
            {isEditing && (
              <>
                <CollectionDetailField
                  label="Brand"
                  value={ornament.brand || "—"}
                  locked={lockedFields.includes("brand")}
                  editing
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
                  editing
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
                  highlighted={
                    repairFields.includes("year") || focusField === "year"
                  }
                />
              </>
            )}
            {isEditing && (
              <>
                <CollectionDetailField
                  label="Series / Collection"
                  value={ornament.seriesOrCollection || "—"}
                  locked={lockedFields.includes("seriesOrCollection")}
                  editing
                  editSlot={
                    <SeriesAutocomplete
                      value={draft.series}
                      onValueChange={(value) =>
                        setDraft((d) => ({ ...d, series: value }))
                      }
                      className="h-8 text-sm"
                    />
                  }
                  empty={!ornament.seriesOrCollection}
                  highlighted={
                    repairFields.includes("seriesOrCollection") ||
                    focusField === "seriesOrCollection"
                  }
                />
              </>
            )}
            {!isEditing ? (
              <CollectionDetailField
                label="Dimensions"
                value={ornament.dimensions || "—"}
                locked={lockedFields.includes("dimensions")}
                onToggleLock={() => toggleFieldLock("dimensions")}
                empty={!ornament.dimensions}
              />
            ) : (
              <CollectionDetailField
                label="Dimensions"
                value={ornament.dimensions || "—"}
                locked={lockedFields.includes("dimensions")}
                editing
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
            )}
            <CollectionDetailField
              label="Barcode / UPC"
              value={ornament.barcodeValue || "—"}
              editing={isEditing}
              editSlot={
                <div className="flex gap-2">
                  <Input
                    value={draft.barcode}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, barcode: e.target.value }))
                    }
                    placeholder="e.g. 661127022308"
                    className="h-8 text-sm font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setBarcodeScannerOpen(true)}
                    title="Scan UPC / barcode"
                    aria-label="Scan UPC / barcode"
                    data-testid="button-edit-scan-barcode"
                  >
                    <ScanBarcode className="h-4 w-4" />
                  </Button>
                </div>
              }
              empty={!ornament.barcodeValue}
            />
            {isEditing && (
              <CollectionDetailField
                label="Box Description"
                value={ornament.description || "—"}
                editing={isEditing}
                editSlot={
                  <Textarea
                    value={draft.boxDescription}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        boxDescription: e.target.value,
                      }))
                    }
                    placeholder="Verbatim text printed on the back of the box..."
                    className="text-sm min-h-[80px]"
                  />
                }
                empty={!ornament.description}
              />
            )}
            {isEditing && (
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
                    placeholder="Memories, where it was bought..."
                    className="text-sm min-h-[80px]"
                  />
                }
                empty={!ornament.notes}
              />
            )}

            {/* Categories */}
            {isEditing ? (
              <div className="py-1.5 border-b border-border/60 last:border-0">
                <TagSelector
                  allCategories={allCategories}
                  selectedIds={selectedCategoryIds}
                  onToggle={toggleCategory}
                  onCreated={(cat) =>
                    setSelectedCategoryIds((prev) => [...prev, cat.id])
                  }
                />
              </div>
            ) : null}

            {/* ─── Market Valuations ─────────────────────────────────────── */}
            {!isEditing && hasValuationData && (
              <div className="flex items-center gap-2 pt-3 pb-0.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/50 shrink-0">
                  Market Valuations
                </p>
                <div className="flex-1 h-px bg-border/40" />
              </div>
            )}

            {!isEditing && ornament.bookValue != null && (
              <CollectionDetailField
                label="Book Value"
                tooltip="Looked up from Hallmark collector price-guide sites. When more than one site has a price, the higher one is used."
                value={
                  <span>
                    {formatCurrency(ornament.bookValue)}
                    {ornament.bookValueSource && (
                      <span className="text-xs text-muted-foreground font-normal ml-1.5">
                        · {ornament.bookValueSource}
                        {ornament.bookValueUpdatedAt
                          ? ` · updated ${formatDate(ornament.bookValueUpdatedAt)}`
                          : ""}
                      </span>
                    )}
                  </span>
                }
              />
            )}

            {!isEditing && ornament.retailValueUsd != null && (
              <CollectionDetailField
                label="Retail Value"
                tooltip="The original retail price when the ornament was new, found via a web search for this ornament's official product listing."
                value={
                  <span>
                    {formatCurrency(ornament.retailValueUsd)}
                    {ornament.retailValueSource && (
                      <span className="text-xs text-muted-foreground font-normal ml-1.5">
                        · {ornament.retailValueSource}
                        {ornament.retailValueUpdatedAt
                          ? ` · updated ${formatDate(ornament.retailValueUpdatedAt)}`
                          : ""}
                      </span>
                    )}
                  </span>
                }
              />
            )}

            {!isEditing && ornament.retailValueUsd == null && (
              <div className="flex items-start gap-3 py-1.5 border-b border-border/60 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    Retail Value
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetailValueLookup}
                    disabled={retailValueLookupBusy}
                  >
                    {retailValueLookupBusy ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : null}
                    Look up retail value
                  </Button>
                </div>
              </div>
            )}

            {!isEditing && (
              <OrnamentEbayPriceSection
                ebayPriceMinUsd={ornament.ebayPriceMinUsd}
                ebayPriceMaxUsd={ornament.ebayPriceMaxUsd}
                ebayLastSoldPriceUsd={ornament.ebayLastSoldPriceUsd}
                ebayPriceCachedAt={ornament.ebayPriceCachedAt}
                ebayLastSoldDate={ornament.ebayLastSoldDate}
                onForceRefresh={() => handleEbayLookup(true)}
                forceRefreshing={forceEbayRefreshing}
              />
            )}

            {!isEditing && !!ornament.aiAppraisal && (
              <CollectionDetailField
                label="AI Collector Appraisal"
                tooltip="An AI-estimated value range based on the ornament's photos and description, not tied to a specific marketplace or listing."
                value={
                  aiAppraisalLow != null && aiAppraisalHigh != null ? (
                    <span>
                      ~{formatCurrency(aiAppraisalLow)} –{" "}
                      {formatCurrency(aiAppraisalHigh)} est.
                      {ornament.aiAppraisalUpdatedAt && (
                        <span className="text-xs text-muted-foreground font-normal ml-1.5">
                          · updated {formatDate(ornament.aiAppraisalUpdatedAt)}
                        </span>
                      )}
                    </span>
                  ) : (
                    ornament.aiAppraisal
                  )
                }
              />
            )}

            {/* ─── Calculated ────────────────────────────────────────────── */}
            {!isEditing && hasCalcData && (
              <div className="flex items-center gap-2 pt-3 pb-0.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/50 shrink-0">
                  Calculated
                </p>
                <div className="flex-1 h-px bg-border/40" />
              </div>
            )}

            {!isEditing && ebayMid != null && (
              <div className="flex items-start gap-3 py-1.5 border-b border-border/60 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      eBay Midpoint
                    </p>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40 border border-border/50 rounded px-1 leading-tight">
                      calc
                    </span>
                    <InfoTooltip text="The midpoint of the eBay for-sale range: (low + high) ÷ 2." />
                  </div>
                  <p className="text-sm">{formatCurrency(ebayMid)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    ({formatCurrency(ornament.ebayPriceMinUsd)} +{" "}
                    {formatCurrency(ornament.ebayPriceMaxUsd)}) ÷ 2
                  </p>
                </div>
              </div>
            )}

            {!isEditing && vsBook != null && vsBookPct != null && (
              <div className="flex items-start gap-3 py-1.5 border-b border-border/60 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      vs. Book Value
                    </p>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40 border border-border/50 rounded px-1 leading-tight">
                      calc
                    </span>
                    <InfoTooltip text="How the eBay midpoint compares to book value: eBay midpoint − book value." />
                  </div>
                  <p className="text-sm flex items-center gap-1.5">
                    {vsBook < -0.5 && (
                      <TrendingDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    )}
                    {vsBook > 0.5 && (
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    )}
                    {Math.abs(vsBook) <= 0.5 && (
                      <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={
                        vsBook < -0.5
                          ? "text-amber-600"
                          : vsBook > 0.5
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                      }
                    >
                      {vsBook >= 0 ? "+" : ""}
                      {formatCurrency(vsBook)} ({vsBookPct.toFixed(1)}%)
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {vsBook < -0.5
                        ? "below book"
                        : vsBook > 0.5
                          ? "above book"
                          : "at book"}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    eBay mid {formatCurrency(ebayMid)} − book{" "}
                    {formatCurrency(ornament.bookValue)}
                  </p>
                </div>
              </div>
            )}

            {!isEditing && consensus != null && (
              <div className="flex items-start gap-3 py-1.5 border-b border-border/60 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Consensus Est. Value
                    </p>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40 border border-border/50 rounded px-1 leading-tight">
                      calc
                    </span>
                    <InfoTooltip text="The average of every available value signal — eBay midpoint, AI appraisal midpoint, and book value — using whichever of those are available (at least two required)." />
                  </div>
                  <p className="text-sm font-medium">
                    {formatCurrency(consensus)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    avg of{" "}
                    {[
                      ebayMid != null
                        ? `eBay mid ${formatCurrency(ebayMid)}`
                        : null,
                      aiMid != null ? `AI mid ${formatCurrency(aiMid)}` : null,
                      ornament.bookValue != null
                        ? `book ${formatCurrency(ornament.bookValue)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
              </div>
            )}
          </>
        }
        panels={
          <>
            {/* AI Description */}
            {isEditing && (
              <CollectionDetailSection title="AI Description">
                <Textarea
                  value={draft.aiDesc}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, aiDesc: e.target.value }))
                  }
                  className="text-sm min-h-[100px] leading-relaxed"
                />
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
          </>
        }
      />

      <BarcodeScannerDialog
        open={barcodeScannerOpen}
        onOpenChange={setBarcodeScannerOpen}
        onScanned={handleScannedBarcode}
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
