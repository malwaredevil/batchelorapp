import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import {
  Loader2,
  ArrowLeft,
  Trash2,
  Camera,
  Lock,
  Unlock,
  Search,
  ShoppingBag,
  Wand2,
  Download,
  Image as ImageIcon,
  X,
  Star,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { IdentityResearchPanel } from "@/ornaments/components/IdentityResearchPanel";
import { SeriesLinkPanel } from "@/ornaments/components/SeriesLinkPanel";

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default function OrnamentDetail() {
  const [match, params] = useRoute("/ornaments/ornament/:id");
  const id = Number(params?.id);
  const [_, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const {
    data: ornament,
    isLoading,
    isError,
  } = useGetOrnament(id, {
    query: { enabled: !!id, queryKey: getGetOrnamentQueryKey(id) },
  });
  const updateOrnament = useUpdateOrnament();
  const deleteOrnament = useDeleteOrnament();
  const lookupBookValue = useLookupOrnamentBookValue();
  const lookupEbay = useLookupOrnamentEbayPrice();
  const reanalyze = useReanalyzeOrnament();

  const addImage = useUploadOrnamentImage(id);
  const setPrimaryImage = useSetOrnamentPrimaryImage();
  const deleteImage = useDeleteOrnamentImage();

  const [isDeleting, setIsDeleting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [ebayResult, setEbayResult] = useState<{
    priceMinUsd: number;
    priceMaxUsd: number;
    priceMedianUsd: number;
    listingCount: number;
    searchQuery?: string;
  } | null>(null);

  // Auto-save state
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [series, setSeries] = useState("");
  const [year, setYear] = useState("");
  const [notes, setNotes] = useState("");
  const [categories, setCategories] = useState<number[]>([]);
  const [lockedFields, setLockedFields] = useState<string[]>([]);
  const [aiDesc, setAiDesc] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [condition, setCondition] = useState("");

  const initializedForId = useRef<number | null>(null);
  const lastSaved = useRef({
    title: "",
    brand: "",
    series: "",
    year: "",
    notes: "",
    categories: "",
    lockedFields: "",
    aiDesc: "",
    dimensions: "",
    condition: "",
  });
  const mutateFnRef = useRef(updateOrnament.mutate);
  mutateFnRef.current = updateOrnament.mutate;

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

  useEffect(() => {
    if (ornament && initializedForId.current !== id) {
      initializedForId.current = id;
      setTitle(ornament.name || "");
      setBrand(ornament.brand || "Hallmark");
      setSeries(ornament.seriesOrCollection || "");
      setYear(ornament.year ? String(ornament.year) : "");
      setNotes(ornament.notes || "");
      setAiDesc(ornament.aiDescription || "");
      setDimensions(ornament.dimensions || "");
      setCondition(ornament.condition || "");
      const catIds = ornament.categories?.map((c) => c.id) || [];
      setCategories(catIds);
      const locked = ornament.lockedFields || [];
      setLockedFields(locked);

      lastSaved.current = {
        title: ornament.name || "",
        brand: ornament.brand || "Hallmark",
        series: ornament.seriesOrCollection || "",
        year: ornament.year ? String(ornament.year) : "",
        notes: ornament.notes || "",
        categories: catIds.join(","),
        lockedFields: locked.join(","),
        aiDesc: ornament.aiDescription || "",
        dimensions: ornament.dimensions || "",
        condition: ornament.condition || "",
      };
    }
  }, [ornament, id]);

  // Debounced auto-save
  useEffect(() => {
    if (initializedForId.current !== id) return;

    const catsStr = categories.join(",");
    const lockedStr = lockedFields.join(",");

    const changed =
      title !== lastSaved.current.title ||
      brand !== lastSaved.current.brand ||
      series !== lastSaved.current.series ||
      year !== lastSaved.current.year ||
      notes !== lastSaved.current.notes ||
      catsStr !== lastSaved.current.categories ||
      lockedStr !== lastSaved.current.lockedFields ||
      aiDesc !== lastSaved.current.aiDesc ||
      dimensions !== lastSaved.current.dimensions ||
      condition !== lastSaved.current.condition;

    if (!changed) return;

    const timer = setTimeout(() => {
      mutateFnRef.current(
        {
          id,
          data: {
            name: title,
            brand,
            seriesOrCollection: series || null,
            year: year ? parseInt(year, 10) : null,
            notes: notes || null,
            categoryIds: categories,
            lockedFields: lockedFields,
            aiDescription: aiDesc || null,
            dimensions: dimensions || null,
            condition: condition || null,
          },
        },
        {
          onSuccess: (data) => {
            lastSaved.current = {
              title: data.name,
              brand: data.brand || "",
              series: data.seriesOrCollection || "",
              year: data.year ? String(data.year) : "",
              notes: data.notes || "",
              categories: data.categories?.map((c) => c.id).join(",") || "",
              lockedFields: data.lockedFields?.join(",") || "",
              aiDesc: data.aiDescription || "",
              dimensions: data.dimensions || "",
              condition: data.condition || "",
            };
            queryClient.setQueryData(getGetOrnamentQueryKey(id), data);
          },
          onError: () => toast.error("Auto-save failed"),
        },
      );
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    title,
    brand,
    series,
    year,
    notes,
    categories,
    lockedFields,
    aiDesc,
    dimensions,
    condition,
    id,
    queryClient,
  ]);

  const toggleLock = (field: string) => {
    setLockedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  };

  const LockIcon = ({ field }: { field: string }) => {
    const isLocked = lockedFields.includes(field);
    return (
      <button
        onClick={() => toggleLock(field)}
        className={`ml-2 p-1 rounded transition-colors ${isLocked ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-muted opacity-50 hover:opacity-100"}`}
        title={
          isLocked
            ? "Field locked from AI updates"
            : "Lock field to prevent AI overwrites"
        }
      >
        {isLocked ? (
          <Lock className="h-3 w-3" />
        ) : (
          <Unlock className="h-3 w-3" />
        )}
      </button>
    );
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this ornament? This cannot be undone.",
      )
    )
      return;
    setIsDeleting(true);
    try {
      await deleteOrnament.mutateAsync({ id });
      toast.success("Ornament deleted");
      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
      setLocation("/ornaments/");
    } catch (err) {
      toast.error("Failed to delete ornament");
      setIsDeleting(false);
    }
  };

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
    } catch (err) {
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
      if (result.aiDescription) setAiDesc(result.aiDescription);
    } catch (err) {
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
    } catch (err) {
      toast.error("PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    try {
      const formData = new FormData();
      formData.append("image", file);

      toast.loading("Uploading image...", { id: "upload" });
      await addImage.mutateAsync(formData);
      toast.dismiss("upload");
      toast.success("Image added");
      queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
    } catch (err) {
      toast.dismiss("upload");
      toast.error("Failed to upload image");
    }
  };

  const handleSetPrimary = async (imageId: number) => {
    try {
      await setPrimaryImage.mutateAsync({ id, data: { imageId } });
      toast.success("Primary image updated");
      queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
    } catch (err) {
      toast.error("Failed to set primary image");
    }
  };

  const handleDeleteImage = async (imageId: number) => {
    if (!confirm("Remove this image?")) return;
    try {
      await deleteImage.mutateAsync({ id, imageId });
      toast.success("Image removed");
      queryClient.invalidateQueries({ queryKey: getGetOrnamentQueryKey(id) });
    } catch (err) {
      toast.error("Failed to remove image");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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

  const primaryImage = ornament.images?.find((img) => img.position === 0);
  const otherImages = ornament.images?.filter((img) => img.position > 0) || [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-20">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/ornaments/")}
            className="-ml-2 shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="hidden sm:block">
            <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider">
              {brand} • {year}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={exportingPdf}
          >
            {exportingPdf ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            PDF
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive/10 text-destructive hover:bg-destructive hover:text-white border-transparent"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start">
        {/* Left Column - Image & Actions */}
        <div className="space-y-4">
          <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-card border border-card-border shadow-md group">
            {ornament.imageUrl ? (
              <img
                src={ornament.imageUrl}
                alt={title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary/30">
                <ImageIcon className="h-12 w-12 opacity-20" />
              </div>
            )}

            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
              <Button
                variant="secondary"
                className="rounded-full shadow-xl"
                asChild
                disabled={addImage.isPending}
              >
                <label className="cursor-pointer">
                  {addImage.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="mr-2 h-4 w-4" />
                  )}
                  Add Photo
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleImageUpload}
                  />
                </label>
              </Button>
            </div>
          </div>

          {ornament.images && ornament.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
              {ornament.images.map((img) => (
                <div
                  key={img.id}
                  className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden border border-border group snap-start"
                >
                  <img
                    src={img.url}
                    className={cn(
                      "w-full h-full object-cover",
                      img.position === 0 && "opacity-50",
                    )}
                  />
                  {img.position === 0 ? (
                    <div className="absolute top-1 left-1 bg-primary text-white rounded-full p-0.5">
                      <Star className="h-3 w-3 fill-current" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 backdrop-blur-sm">
                      <button
                        onClick={() => handleSetPrimary(img.id)}
                        className="p-1 text-white hover:text-primary transition-colors"
                        title="Make primary"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteImage(img.id)}
                        className="p-1 text-white hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col gap-1 items-center justify-center bg-card shadow-sm"
              onClick={handleLookupPrice}
              disabled={lookupBookValue.isPending}
            >
              {lookupBookValue.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Search className="h-5 w-5 text-primary" />
              )}
              <span className="text-xs">Book Value</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col gap-1 items-center justify-center bg-card shadow-sm"
              onClick={handleLookupEbayPrice}
              disabled={lookupEbay.isPending}
            >
              {lookupEbay.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ShoppingBag className="h-5 w-5 text-primary" />
              )}
              <span className="text-xs">eBay Price</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col gap-1 items-center justify-center bg-card shadow-sm"
              onClick={handleReanalyze}
              disabled={reanalyze.isPending}
            >
              {reanalyze.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Wand2 className="h-5 w-5 text-primary" />
              )}
              <span className="text-xs">AI Analysis</span>
            </Button>
          </div>

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
                {ebayResult.listingCount !== 1 ? "s" : ""} · "
                {ebayResult.searchQuery}"
              </p>
            </div>
          )}

          <IdentityResearchPanel itemId={ornament.id} />
          <SeriesLinkPanel itemId={ornament.id} />

          <div className="flex flex-wrap gap-2">
            {ornament.motifs?.map((m) => (
              <Badge
                key={m}
                variant="secondary"
                className="bg-secondary/50 font-normal"
              >
                {m}
              </Badge>
            ))}
            {ornament.dominantColors?.map((c) => (
              <Badge
                key={c}
                variant="outline"
                className="font-normal flex items-center gap-1"
              >
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: c }}
                ></span>{" "}
                {c}
              </Badge>
            ))}
          </div>
        </div>

        {/* Right Column - Form */}
        <div className="space-y-6">
          <div className="bg-card border border-card-border p-6 rounded-2xl shadow-sm space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center">
                  Name <LockIcon field="name" />
                </Label>
              </div>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-2xl font-serif font-bold h-auto py-2 px-3 border-transparent hover:border-input focus:border-input bg-transparent hover:bg-background focus:bg-background transition-colors -ml-3 w-[calc(100%+24px)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-1">
                  Brand <LockIcon field="brand" />
                </Label>
                <Input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="bg-background"
                />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-1">
                  Year <LockIcon field="year" />
                </Label>
                <Input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  type="number"
                  className="bg-background"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-1">
                Series / Collection <LockIcon field="seriesOrCollection" />
              </Label>
              <Input
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                className="bg-background"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-1">
                  Condition <LockIcon field="condition" />
                </Label>
                <Input
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="bg-background"
                  placeholder="e.g. Mint in Box"
                />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-1">
                  Dimensions <LockIcon field="dimensions" />
                </Label>
                <Input
                  value={dimensions}
                  onChange={(e) => setDimensions(e.target.value)}
                  className="bg-background"
                  placeholder="e.g. 4x3x2 in"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-2">
                Categories
              </Label>
              <CategorySelector value={categories} onChange={setCategories} />
            </div>
          </div>

          <div className="bg-card border border-card-border p-6 rounded-2xl shadow-sm space-y-5">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-1">
                AI Description <LockIcon field="aiDescription" />
              </Label>
              <Textarea
                value={aiDesc}
                onChange={(e) => setAiDesc(e.target.value)}
                className="bg-background min-h-[100px] leading-relaxed text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center mb-1">
                Personal Notes <LockIcon field="notes" />
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-background min-h-[80px]"
                placeholder="Memories, condition issues, where it was bought..."
              />
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block mr-1 animate-pulse"></span>
              Changes saved automatically
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
