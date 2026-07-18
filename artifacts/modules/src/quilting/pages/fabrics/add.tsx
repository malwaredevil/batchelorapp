import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, Loader2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  useCreateFabric,
  getListFabricsQueryKey,
  useListQuiltingCategories,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/quilting/components/tag-selector";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";
import { useAppConfigSummary } from "@workspace/elaine-ui";

export default function AddFabric() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedCatIds, setSelectedCatIds] = useState<number[]>([]);

  const { data: allCategories } = useListQuiltingCategories();

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "quilting-fabrics-add",
    `Add Fabric page: a form to add one new fabric to the stash with a required photo (for AI cataloguing) plus optional name/quantity/notes/categories. This is a photo-upload form — you cannot submit it on the user's behalf from chat.${configSummary ? ` ${configSummary}` : ""}`,
  );

  const create = useCreateFabric({
    mutation: {
      onSuccess: (fabric) => {
        queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
        toast.success("Fabric added!");
        navigate(`/quilting/fabrics/${fabric.id}`);
      },
      onError: () => toast.error("Failed to add fabric. Please try again."),
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      toast.error("Please add a photo of the fabric.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => (fd.get(k) as string | null) || undefined;
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCatIds.includes(c.id))
      .map((c) => c.name);
    create.mutate({
      data: {
        image: file,
        name: get("name"),
        quantity: get("quantity"),
        quantityUnit: get("quantityUnit"),
        notes: get("notes"),
        categories:
          categoryNames.length > 0 ? JSON.stringify(categoryNames) : undefined,
      },
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/quilting/fabrics")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Add fabric</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Photo picker */}
        <div>
          <Label className="mb-2 block">
            Photo <span className="text-destructive">*</span>
          </Label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 py-10 transition-colors hover:border-primary hover:bg-muted/50"
          >
            {preview ? (
              <img
                src={preview}
                alt="Preview"
                className="max-h-60 rounded-lg object-contain"
              />
            ) : (
              <>
                <Camera className="h-10 w-10 text-muted-foreground/50" />
                <span className="text-sm text-muted-foreground">
                  Tap to add a fabric photo
                </span>
                <span className="text-xs text-muted-foreground/60">
                  Include the selvage to help AI identify designer/manufacturer
                </span>
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />
          {preview && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-3 w-3" />
              Change photo
            </Button>
          )}
        </div>

        <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          AI will auto-fill the details below from the photo. You can leave
          fields blank — review and edit after saving.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">Name (optional — AI fills this)</Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. Moda Floral Blue"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              name="quantity"
              type="number"
              step="0.25"
              min="0"
              defaultValue="1"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="quantityUnit">Unit</Label>
            <Input
              id="quantityUnit"
              name="quantityUnit"
              defaultValue="yards"
              placeholder="yards"
              className="mt-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Any personal notes..."
              className="mt-1.5"
              rows={3}
            />
          </div>
        </div>

        <TagSelector
          allCategories={allCategories ?? []}
          selectedIds={selectedCatIds}
          onToggle={(id) =>
            setSelectedCatIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
          onCreated={(cat) => setSelectedCatIds((prev) => [...prev, cat.id])}
        />

        <Button
          type="submit"
          className="w-full"
          disabled={create.isPending || !file}
        >
          {create.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Analysing fabric…
            </>
          ) : (
            "Add to collection"
          )}
        </Button>
      </form>
    </div>
  );
}
