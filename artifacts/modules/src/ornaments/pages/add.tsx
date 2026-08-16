import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Loader2,
  ArrowLeft,
  Camera,
  Box,
  Info,
  ImagePlus,
  ScanBarcode,
  X,
} from "lucide-react";
import {
  useCreateOrnament,
  useListOrnamentCategories,
  getListOrnamentsQueryKey,
  getGetOrnamentStatsQueryKey,
  getUploadErrorMessage,
  uploadOrnamentImage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ImagePicker, CameraModal } from "@/ornaments/components/image-picker";
import { DEFAULT_LABEL_SUGGESTIONS as LABEL_SUGGESTIONS } from "@workspace/image-capture";
import { TagSelector } from "@/ornaments/components/tag-selector";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { useAppConfigSummary } from "@workspace/elaine-ui";
import { cn } from "@/lib/utils";
import {
  STANDARD_IMAGE_UPLOAD,
  validateClientUpload,
} from "@workspace/upload-policy";

interface SuppPhoto {
  file: File;
  label: string;
  preview: string;
}

const addSchema = z.object({
  name: z.string().min(1, "Name is required"),
  brand: z.string().min(1, "Brand is required"),
  seriesOrCollection: z.string().nullable(),
  year: z.string().nullable(), // input is string, parse to number
  quantity: z.coerce.number().min(1),
  barcodeValue: z.string().nullable(),
  notes: z.string().nullable(),
  description: z.string().nullable(),
  dimensions: z.string().nullable(),
  condition: z.string().nullable(),
  origin: z.string().nullable(),
  acquiredAt: z.string().nullable(), // YYYY-MM-DD
  categories: z.array(z.number()),
  image: z.any().nullable(), // Blob
});

export default function AddOrnament() {
  const [_, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createOrnament = useCreateOrnament();
  const { data: allCategories = [] } = useListOrnamentCategories();

  // Additional (supplemental) photos, uploaded after the ornament is created.
  const [suppPhotos, setSuppPhotos] = useState<SuppPhoto[]>([]);
  const [showSuppCamera, setShowSuppCamera] = useState(false);
  const suppFileInputRef = useRef<HTMLInputElement>(null);

  function addSuppPhoto(f: File) {
    const validation = validateClientUpload(f, STANDARD_IMAGE_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }
    const preview = URL.createObjectURL(f);
    setSuppPhotos((prev) => [...prev, { file: f, label: "", preview }]);
  }

  function handleSuppCapture(captured: File) {
    setShowSuppCamera(false);
    addSuppPhoto(captured);
  }

  function handleSuppFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) addSuppPhoto(f);
  }

  function removeSuppPhoto(i: number) {
    setSuppPhotos((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, j) => j !== i);
    });
  }

  function setSuppLabel(i: number, label: string) {
    setSuppPhotos((prev) =>
      prev.map((p, j) => (j === i ? { ...p, label } : p)),
    );
  }

  // Try to load prefilled data from scanner
  const prefillJson = sessionStorage.getItem("ornaments-add-prefill");
  const prefill = prefillJson ? JSON.parse(prefillJson) : null;

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "ornaments-add",
    prefill
      ? [
          `Add ornament page — prefilled from barcode scan.`,
          prefill.name ? `Name: "${prefill.name}"` : null,
          prefill.brand ? `Brand: ${prefill.brand}` : null,
          prefill.seriesOrCollection
            ? `Series/Collection: "${prefill.seriesOrCollection}"`
            : null,
          prefill.year ? `Year: ${prefill.year}` : null,
          prefill.barcodeValue ? `Barcode/UPC: ${prefill.barcodeValue}` : null,
          prefill.description
            ? `Box description (verbatim): "${String(prefill.description).slice(0, 300)}"`
            : null,
          `The form is pre-filled — if the user asks "what's this worth?" or "look it up on Hallmark", use the name/barcode above for ebay_search or search_hallmark immediately.`,
          configSummary ? `\n${configSummary}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : `Add ornament page. Enter details manually or scan a barcode first.${configSummary ? ` ${configSummary}` : ""}`,
  );

  const form = useForm<z.infer<typeof addSchema>>({
    resolver: zodResolver(addSchema),
    defaultValues: {
      name: prefill?.name || "",
      brand: prefill?.brand || "Hallmark",
      seriesOrCollection: prefill?.seriesOrCollection || "",
      year: prefill?.year ? String(prefill.year) : "",
      quantity: 1,
      barcodeValue: prefill?.barcodeValue || "",
      notes: "",
      description: prefill?.description || "",
      dimensions: "",
      condition: "Excellent",
      origin: "",
      acquiredAt: new Date().toISOString().split("T")[0],
      categories: [],
      image: null,
    },
  });

  // Clear prefill on mount
  useEffect(() => {
    sessionStorage.removeItem("ornaments-add-prefill");
  }, []);

  const onSubmit = async (values: z.infer<typeof addSchema>) => {
    try {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("brand", values.brand);
      formData.append("quantity", String(values.quantity));

      if (values.seriesOrCollection)
        formData.append("seriesOrCollection", values.seriesOrCollection);
      if (values.year) formData.append("year", values.year);
      if (values.barcodeValue)
        formData.append("barcodeValue", values.barcodeValue);
      if (values.notes) formData.append("notes", values.notes);
      if (values.description)
        formData.append("description", values.description);
      if (values.dimensions) formData.append("dimensions", values.dimensions);
      if (values.condition) formData.append("condition", values.condition);
      if (values.origin) formData.append("origin", values.origin);
      if (values.acquiredAt) formData.append("acquiredAt", values.acquiredAt);

      if (values.categories.length > 0) {
        formData.append("categories", values.categories.join(","));
      }

      if (values.image instanceof File || values.image instanceof Blob) {
        formData.append("image", values.image);
      } else {
        toast.error("An image is highly recommended!", { duration: 2000 });
      }

      // @ts-ignore - FormData bypasses type checks in orval but works
      const result = await createOrnament.mutateAsync({ data: formData });

      for (const supp of suppPhotos) {
        const suppFormData = new FormData();
        suppFormData.append("image", supp.file);
        if (supp.label.trim()) suppFormData.append("label", supp.label.trim());
        await uploadOrnamentImage(result.id, suppFormData).catch(() => {});
      }

      queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
      queryClient.invalidateQueries({
        queryKey: getGetOrnamentStatsQueryKey(),
      });

      toast.success("Ornament added!");
      setLocation(`/ornaments/ornament/${result.id}`);
    } catch (err) {
      toast.error(getUploadErrorMessage(err, "Failed to add ornament"));
    }
  };

  return (
    <>
      {showSuppCamera && (
        <CameraModal
          onCapture={handleSuppCapture}
          onClose={() => setShowSuppCamera(false)}
        />
      )}

      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/ornaments/")}
            className="-ml-2 shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground tracking-tight">
              Add Ornament
            </h1>
            <p className="text-muted-foreground mt-1">
              Catalog a new piece for your collection
            </p>
          </div>
        </div>

        {prefill && prefill.name && (
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex gap-3 text-primary">
            <Info className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm">
              Found a match for barcode <b>{prefill.barcodeValue}</b>. Details
              have been pre-filled.
            </p>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-serif font-bold">
                    Photo
                  </Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Clear, well-lit photos work best for AI analysis.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="image"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <ImagePicker
                          value={field.value}
                          onChange={(file) => {
                            if (file) {
                              const validation = validateClientUpload(
                                {
                                  name: (file as File).name ?? "Photo",
                                  size: file.size,
                                  type: file.type,
                                },
                                STANDARD_IMAGE_UPLOAD,
                              );
                              if (!validation.ok) {
                                toast.error(validation.message);
                                return;
                              }
                            }
                            field.onChange(file);
                          }}
                          className="w-full max-w-[240px] mx-auto md:mx-0"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2 max-w-[240px] mx-auto md:mx-0">
                  <Label>
                    Additional photos{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>

                  {suppPhotos.length > 0 && (
                    <ul className="space-y-2">
                      {suppPhotos.map((supp, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 rounded-lg border border-card-border bg-card p-2"
                        >
                          <img
                            src={supp.preview}
                            alt={`Extra photo ${i + 1}`}
                            className="h-12 w-12 shrink-0 rounded-md object-cover border border-card-border"
                          />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex flex-wrap gap-1">
                              {LABEL_SUGGESTIONS.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() =>
                                    setSuppLabel(i, supp.label === s ? "" : s)
                                  }
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-xs transition",
                                    supp.label === s
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-card-border hover:border-primary/30",
                                  )}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                            <Input
                              placeholder="Custom label…"
                              value={supp.label}
                              onChange={(e) => setSuppLabel(i, e.target.value)}
                              maxLength={100}
                              className="h-8 text-sm"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeSuppPhoto(i)}
                            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                            aria-label="Remove photo"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <input
                    ref={suppFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSuppFileChange}
                  />

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSuppCamera(true)}
                    >
                      <Camera className="h-4 w-4" />
                      Add another angle
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => suppFileInputRef.current?.click()}
                      title="Pick from photo gallery"
                      aria-label="Pick from photo gallery"
                    >
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-6 bg-card border border-card-border p-6 rounded-xl shadow-sm">
                <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                  <Box className="h-4 w-4 text-primary" />
                  <h3 className="font-serif font-bold text-lg">
                    Essential Details
                  </h3>
                </div>

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Star Trek Millennium Falcon"
                          className="text-lg bg-background"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="brand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Brand</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Hallmark"
                            className="bg-background"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="year"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Release Year</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="YYYY"
                            className="bg-background"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="seriesOrCollection"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Series / Collection</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Star Wars, Nostalgic Houses"
                            className="bg-background"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantity</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            className="bg-background"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="categories"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <TagSelector
                          label="Categories"
                          allCategories={allCategories}
                          selectedIds={field.value}
                          onToggle={(catId) =>
                            field.onChange(
                              field.value.includes(catId)
                                ? field.value.filter((x: number) => x !== catId)
                                : [...field.value, catId],
                            )
                          }
                          onCreated={(cat) =>
                            field.onChange([...field.value, cat.id])
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-6 bg-card border border-card-border p-6 rounded-xl shadow-sm">
              <h3 className="font-serif font-bold text-lg mb-2 pb-2 border-b border-border">
                Additional Info
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Condition</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Excellent, Missing Box"
                          className="bg-background"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="barcodeValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>UPC / Barcode</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            className="bg-background font-mono text-sm"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Scan barcode"
                          className="shrink-0"
                          onClick={() => setLocation("/ornaments/scan")}
                        >
                          <ScanBarcode className="h-4 w-4" />
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="acquiredAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date Acquired</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          className="bg-background"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="origin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source / Origin</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Gift from Mom, Antique Store"
                          className="bg-background"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Box Description</FormLabel>
                    <p className="text-xs text-muted-foreground -mt-1 mb-1">
                      Transcribe the printed description from the back of the
                      box, word for word. AI photo analysis will fill this in
                      automatically if a box-back photo is included.
                    </p>
                    <FormControl>
                      <Textarea
                        placeholder="Copy the story printed on the back of the box, verbatim..."
                        className="bg-background min-h-[100px] resize-y"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Special memories, signing events, etc."
                        className="bg-background min-h-[100px] resize-y"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3 sticky bottom-4 p-4 bg-background/80 backdrop-blur-md border border-border rounded-xl shadow-lg z-10">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/ornaments/")}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createOrnament.isPending}
                className="px-8 font-medium"
              >
                {createOrnament.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  "Save Ornament"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </>
  );
}
