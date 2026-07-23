import { useState, useEffect } from "react";
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
  ScanBarcode,
} from "lucide-react";
import {
  useCreateOrnament,
  getListOrnamentsQueryKey,
  getGetOrnamentStatsQueryKey,
  getUploadErrorMessage,
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
import { ImagePicker } from "@/ornaments/components/image-picker";
import { CategorySelector } from "@/ornaments/components/category-selector";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import { useAppConfigSummary } from "@workspace/elaine-ui";

const addSchema = z.object({
  name: z.string().min(1, "Name is required"),
  brand: z.string().min(1, "Brand is required"),
  seriesOrCollection: z.string().nullable(),
  year: z.string().nullable(), // input is string, parse to number
  quantity: z.coerce.number().min(1),
  barcodeValue: z.string().nullable(),
  notes: z.string().nullable(),
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
                <Label className="text-base font-serif font-bold">Photo</Label>
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
                          if (file && file.size > 10 * 1024 * 1024) {
                            toast.error(
                              `${(file as File).name ?? "File"} — skipped (max 10 MB per file)`,
                            );
                            return;
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
                    <FormLabel>Categories</FormLabel>
                    <FormControl>
                      <CategorySelector
                        value={field.value}
                        onChange={field.onChange}
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
  );
}
