/**
 * Single-magnet add form.
 * For multi-capture camera flow, see bulk-add.tsx.
 */
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  addMagnetImage,
  deleteMagnet,
  useCreateMagnet,
  useListMagnetCategories,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const AddSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
});
type AddFields = z.infer<typeof AddSchema>;

export default function AddMagnetPage() {
  const [, navigate] = useLocation();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const { data: categories = [] } = useListMagnetCategories();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddFields>({ resolver: zodResolver(AddSchema) });

  const createMutation = useCreateMagnet();

  async function onSubmit(data: AddFields) {
    if (!imageFile) {
      toast.error("A default photo is required for every magnet.");
      return;
    }
    try {
      const item = await createMutation.mutateAsync({
        data: {
          name: data.name,
          description: data.description ?? null,
          categoryIds: selectedCategoryIds,
        },
      });

      try {
        await addMagnetImage(item.id, { image: imageFile });
      } catch {
        // Do not leave an invalid photo-less item behind if its required
        // default image cannot be stored.
        await deleteMagnet(item.id).catch(() => undefined);
        throw new Error("Photo upload failed");
      }

      toast.success("Magnet added.");
      navigate(`/magnets/item/${item.id}`);
    } catch {
      toast.error("Failed to save. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="mb-6 text-2xl font-bold">Add magnet</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Photo */}
        <div>
          <p className="mb-1 text-sm font-medium">
            Default photo <span className="text-destructive">*</span>
          </p>
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-sm text-muted-foreground hover:border-primary"
            onClick={() => fileRef.current?.click()}
          >
            {imageFile ? (
              <img
                src={URL.createObjectURL(imageFile)}
                alt="Preview"
                className="max-h-48 rounded object-cover"
              />
            ) : (
              <span>Tap to select a photo</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Name */}
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            type="text"
            className="w-full rounded-md border px-3 py-2 text-sm"
            {...register("name")}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-destructive">
              {errors.name.message}
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="description"
            className="mb-1 block text-sm font-medium"
          >
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            className="w-full rounded-md border px-3 py-2 text-sm"
            {...register("description")}
          />
        </div>

        {/* Categories */}
        <div>
          <p className="mb-2 text-sm font-medium">Categories</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() =>
                  setSelectedCategoryIds((prev) =>
                    prev.includes(cat.id)
                      ? prev.filter((x) => x !== cat.id)
                      : [...prev, cat.id],
                  )
                }
                className={cn(
                  "rounded-full px-3 py-1 text-sm transition-colors",
                  selectedCategoryIds.includes(cat.id)
                    ? "bg-primary text-primary-foreground"
                    : "border bg-muted hover:bg-muted/80",
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? "Saving…" : "Add magnet"}
          </button>
          <Link
            href="/magnets"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
