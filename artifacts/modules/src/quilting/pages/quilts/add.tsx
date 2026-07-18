import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { ArrowLeft, Camera, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  useCreateQuilt,
  getListQuiltsQueryKey,
  useListQuiltingCategories,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/quilting/components/tag-selector";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";

const AddQuiltSchema = z.object({
  name: z.string().min(1, "Name is required"),
  dateCompleted: z.string().optional(),
  recipient: z.string().optional(),
  sizeWidth: z.coerce.number().min(0).optional(),
  sizeHeight: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});
type AddQuiltFields = z.infer<typeof AddQuiltSchema>;

export default function AddQuilt() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedCatIds, setSelectedCatIds] = useState<number[]>([]);

  const { data: allCategories } = useListQuiltingCategories();

  const {
    register,
    handleSubmit: rhfHandleSubmit,
    formState: { errors },
  } = useForm<AddQuiltFields>({
    resolver: zodResolver(AddQuiltSchema),
    defaultValues: { name: "" },
  });

  usePageAssistantContext(
    "quilting-quilts-add",
    "Add Quilt page: a form to add a new finished/in-progress quilt to the collection with a required photo (for AI cataloguing) plus optional name/size/recipient/notes/categories. This is a photo-upload form — you cannot submit it on the user's behalf from chat.",
  );

  const create = useCreateQuilt({
    mutation: {
      onSuccess: (quilt) => {
        queryClient.invalidateQueries({ queryKey: getListQuiltsQueryKey() });
        toast.success("Quilt added!");
        navigate(`/quilting/quilts/${quilt.id}`);
      },
      onError: () => toast.error("Failed to add quilt. Please try again."),
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function handleFormSubmit(data: AddQuiltFields) {
    if (!file) {
      toast.error("Please add a photo of the quilt.");
      return;
    }
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCatIds.includes(c.id))
      .map((c) => c.name);
    create.mutate({
      data: {
        image: file,
        name: data.name,
        dateCompleted: data.dateCompleted || undefined,
        recipient: data.recipient || undefined,
        sizeWidth: data.sizeWidth != null ? String(data.sizeWidth) : undefined,
        sizeHeight:
          data.sizeHeight != null ? String(data.sizeHeight) : undefined,
        notes: data.notes || undefined,
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
          onClick={() => navigate("/quilting/quilts")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Add finished quilt</h1>
      </div>

      <form onSubmit={rhfHandleSubmit(handleFormSubmit)} className="space-y-6">
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
                className="max-h-64 rounded-lg object-contain"
              />
            ) : (
              <>
                <Camera className="h-10 w-10 text-muted-foreground/50" />
                <span className="text-sm text-muted-foreground">
                  Tap to add a photo of your quilt
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="e.g. Grandma's Star Quilt"
              className="mt-1.5"
              {...register("name")}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="dateCompleted">Date completed</Label>
            <Input
              id="dateCompleted"
              type="date"
              className="mt-1.5"
              {...register("dateCompleted")}
            />
          </div>
          <div>
            <Label htmlFor="recipient">Recipient</Label>
            <Input
              id="recipient"
              placeholder="e.g. Given to Sarah"
              className="mt-1.5"
              {...register("recipient")}
            />
          </div>
          <div>
            <Label htmlFor="sizeWidth">Width (inches)</Label>
            <Input
              id="sizeWidth"
              type="number"
              step="0.5"
              placeholder="e.g. 60"
              className="mt-1.5"
              {...register("sizeWidth", { valueAsNumber: true })}
            />
            {errors.sizeWidth && (
              <p className="mt-1 text-xs text-destructive">
                {errors.sizeWidth.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="sizeHeight">Height (inches)</Label>
            <Input
              id="sizeHeight"
              type="number"
              step="0.5"
              placeholder="e.g. 72"
              className="mt-1.5"
              {...register("sizeHeight", { valueAsNumber: true })}
            />
            {errors.sizeHeight && (
              <p className="mt-1 text-xs text-destructive">
                {errors.sizeHeight.message}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Materials used, story behind the quilt..."
              className="mt-1.5"
              rows={3}
              {...register("notes")}
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
              Saving…
            </>
          ) : (
            "Add quilt"
          )}
        </Button>
      </form>
    </div>
  );
}
