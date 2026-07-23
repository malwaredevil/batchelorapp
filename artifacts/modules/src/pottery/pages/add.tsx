import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Camera,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Ruler,
  Sparkles,
  X,
} from "lucide-react";
import {
  useListPotteryCategories as useListCategories,
  uploadPotteryImage,
  getUploadErrorMessage,
} from "@workspace/api-client-react";
import type { PotteryCategory as Category } from "@workspace/api-client-react";
import { useUploadPottery } from "@/pottery/hooks/use-pottery";
import { TagSelector } from "@/pottery/components/tag-selector";
import { CameraModal, ImagePicker } from "@/pottery/components/image-picker";
import { ImageEditor } from "@/pottery/components/image-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePageAssistantContext } from "@/pottery/lib/assistant-context";
import { useAppConfigSummary } from "@workspace/elaine-ui";

// Must match MAX_UPLOAD_BYTES in lib/upload-validation/src/index.ts
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const LABEL_SUGGESTIONS = [
  "Front",
  "Back",
  "Left side",
  "Right side",
  "Top",
  "Bottom",
  "Detail",
  "Maker's mark",
];

interface SuppPhoto {
  file: File;
  label: string;
  preview: string;
}

const AddPieceSchema = z.object({
  name: z.string().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  notes: z.string().optional(),
  dimensions: z.string().optional(),
});
type AddPieceFields = z.infer<typeof AddPieceSchema>;

export default function AddPiece() {
  const [, navigate] = useLocation();

  // Primary photo
  const [file, setFile] = useState<File | null>(null);
  const [editingFile, setEditingFile] = useState<File | null>(null);

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  const {
    register,
    handleSubmit: rhfHandleSubmit,
    watch,
    formState: { errors },
  } = useForm<AddPieceFields>({
    resolver: zodResolver(AddPieceSchema),
    defaultValues: { quantity: 1 },
  });
  const watchedFields = watch();

  // Supplemental photos
  const [suppPhotos, setSuppPhotos] = useState<SuppPhoto[]>([]);
  const [showSuppCamera, setShowSuppCamera] = useState(false);
  const [editingSuppFile, setEditingSuppFile] = useState<File | null>(null);
  const [editingSuppIdx, setEditingSuppIdx] = useState<number | null>(null); // null = new photo
  const suppFileInputRef = useRef<HTMLInputElement>(null);

  const upload = useUploadPottery();
  const { data: categories = [] } = useListCategories();

  // ---------------------------------------------------------------------------
  // Primary photo handlers
  // ---------------------------------------------------------------------------
  function handleSelect(f: File | null) {
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast.error(`${f.name} — skipped (max 10 MB per file)`);
      return;
    }
    setEditingFile(f);
  }

  function handleEditorSave(edited: File) {
    setFile(edited);
    setEditingFile(null);
  }

  // ---------------------------------------------------------------------------
  // Supplemental photo handlers
  // ---------------------------------------------------------------------------
  function handleSuppCapture(captured: File) {
    setShowSuppCamera(false);
    if (captured.size > MAX_UPLOAD_BYTES) {
      toast.error(`${captured.name} — skipped (max 10 MB per file)`);
      return;
    }
    setEditingSuppFile(captured);
    setEditingSuppIdx(null);
  }

  function handleSuppFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      toast.error(`${f.name} — skipped (max 10 MB per file)`);
      return;
    }
    setEditingSuppFile(f);
    setEditingSuppIdx(null);
  }

  function handleSuppEditorSave(edited: File) {
    const preview = URL.createObjectURL(edited);
    if (editingSuppIdx !== null) {
      setSuppPhotos((prev) =>
        prev.map((p, i) => {
          if (i !== editingSuppIdx) return p;
          URL.revokeObjectURL(p.preview);
          return { ...p, file: edited, preview };
        }),
      );
    } else {
      setSuppPhotos((prev) => [...prev, { file: edited, label: "", preview }]);
    }
    setEditingSuppFile(null);
    setEditingSuppIdx(null);
  }

  function handleSuppEditorCancel() {
    setEditingSuppFile(null);
    setEditingSuppIdx(null);
  }

  function openSuppEditor(i: number) {
    setEditingSuppFile(suppPhotos[i].file);
    setEditingSuppIdx(i);
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

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  async function handleFormSubmit(data: AddPieceFields) {
    if (!file) {
      toast.error("Please choose a photo first.");
      return;
    }
    upload.mutate(
      {
        image: file,
        name: data.name?.trim() || undefined,
        quantity: (data.quantity ?? 1) > 1 ? (data.quantity ?? 1) : undefined,
        notes: data.notes?.trim() || undefined,
        dimensions: data.dimensions?.trim() || undefined,
        categoryIds: selectedCategoryIds,
      },
      {
        onSuccess: async (item) => {
          for (const supp of suppPhotos) {
            await uploadPotteryImage(item.id, {
              image: supp.file,
              label: supp.label.trim() || undefined,
            }).catch(() => {});
          }
          toast.success("Piece added to your collection.");
          navigate(`/pottery/piece/${item.id}`);
        },
        onError: (err) => {
          toast.error(getUploadErrorMessage(err, "Upload failed."));
        },
      },
    );
  }

  const busy = upload.isPending;

  const configSummary = useAppConfigSummary();

  usePageAssistantContext(
    "pottery-add",
    `Add a Piece page: form for cataloguing a new pottery piece. Primary photo ${file ? "selected" : "not yet selected (required before submit)"}, ${suppPhotos.length} additional photo(s) attached. Current field values — name: ${watchedFields.name?.trim() || "(blank, will be AI-generated)"}, quantity: ${watchedFields.quantity ?? 1}, dimensions: ${watchedFields.dimensions?.trim() || "(blank, AI estimates from photo)"}, notes: ${watchedFields.notes?.trim() || "(blank)"}, categories: ${
      selectedCategoryIds.length
        ? categories
            .filter((c) => selectedCategoryIds.includes(c.id))
            .map((c) => c.name)
            .join(", ")
        : "none selected"
    }. Pattern, colours, shape and motifs are auto-detected from the photo after submit. Available categories (name=id): ${categories.map((c) => `${c.name}=${c.id}`).join(", ") || "none"}.${configSummary ? ` ${configSummary}` : ""}`,
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Primary photo editor */}
      {editingFile && (
        <ImageEditor
          file={editingFile}
          onSave={handleEditorSave}
          onCancel={() => setEditingFile(null)}
        />
      )}

      {/* Supplemental camera */}
      {showSuppCamera && (
        <CameraModal
          onCapture={handleSuppCapture}
          onClose={() => setShowSuppCamera(false)}
        />
      )}

      {/* Supplemental photo editor */}
      {editingSuppFile && (
        <ImageEditor
          file={editingSuppFile}
          onSave={handleSuppEditorSave}
          onCancel={handleSuppEditorCancel}
        />
      )}

      <div className="mx-auto max-w-xl">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">Add a piece</h1>
          <p className="text-sm text-muted-foreground">
            Snap a photo and we'll catalogue the details for you
          </p>
        </div>

        <form
          onSubmit={rhfHandleSubmit(handleFormSubmit)}
          className="space-y-5"
        >
          {/* Primary image */}
          <div className="space-y-2">
            <Label>
              Primary photo{" "}
              <span className="text-destructive text-xs">required</span>
            </Label>
            <ImagePicker file={file} onSelect={handleSelect} disabled={busy} />
          </div>

          {/* Supplemental images */}
          <div className="space-y-2">
            <Label>
              Additional photos{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (optional — side, back, maker's mark, etc.)
              </span>
            </Label>

            {suppPhotos.length > 0 && (
              <ul className="space-y-2">
                {suppPhotos.map((supp, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-lg border border-card-border bg-card p-2"
                  >
                    {/* Thumbnail — tap to edit */}
                    <button
                      type="button"
                      onClick={() => openSuppEditor(i)}
                      disabled={busy}
                      className="relative shrink-0 rounded-md overflow-hidden border border-card-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label="Edit this photo"
                    >
                      <img
                        src={supp.preview}
                        alt={`Extra photo ${i + 1}`}
                        className="h-14 w-14 object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors">
                        <Pencil className="h-4 w-4 text-white opacity-0 hover:opacity-100 transition-opacity" />
                      </span>
                    </button>

                    {/* Label chips + free-text input */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap gap-1">
                        {LABEL_SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setSuppLabel(i, supp.label === s ? "" : s)
                            }
                            className={cn(
                              "rounded-full border px-2.5 py-0.5 text-xs transition",
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
                        disabled={busy}
                        maxLength={100}
                        className="h-8 text-sm"
                      />
                    </div>

                    {/* Edit + Remove buttons */}
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openSuppEditor(i)}
                        disabled={busy}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        aria-label="Edit photo"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSuppPhoto(i)}
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Remove photo"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Hidden file input for gallery upload */}
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
                disabled={busy}
                onClick={() => setShowSuppCamera(true)}
              >
                <Camera className="h-4 w-4" />
                Add another angle
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => suppFileInputRef.current?.click()}
                title="Pick from photo gallery"
                aria-label="Pick from photo gallery"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-muted-foreground">
              Pattern, colours, shape and motifs are detected automatically from
              your primary photo. A name and notes are optional.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">
              Name{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="name"
              placeholder="e.g. Blue floral teacup"
              disabled={busy}
              data-testid="input-name"
              {...register("name")}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quantity">
              Quantity{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (how many you own)
              </span>
            </Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              step={1}
              onFocus={(e) => e.target.select()}
              disabled={busy}
              className="w-24"
              {...register("quantity", { valueAsNumber: true })}
            />
            {errors.quantity && (
              <p className="mt-1 text-xs text-destructive">
                {errors.quantity.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dimensions">
              Dimensions{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (optional — AI estimates from photo if left blank)
              </span>
            </Label>
            <div className="relative">
              <Ruler className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="dimensions"
                placeholder="e.g. H 14 cm × D 22 cm"
                disabled={busy}
                className="pl-9"
                data-testid="input-dimensions"
                {...register("dimensions")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">
              Notes{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="notes"
              placeholder="Where you bought it, who made it, anything worth remembering…"
              rows={3}
              disabled={busy}
              data-testid="input-notes"
              {...register("notes")}
            />
          </div>

          <TagSelector
            allCategories={categories}
            selectedIds={selectedCategoryIds}
            onToggle={toggleCategory}
            onCreated={(cat: Category) =>
              setSelectedCategoryIds((prev) => [...prev, cat.id])
            }
            disabled={busy}
          />

          <div className="flex gap-3">
            <Button
              type="submit"
              className="flex-1"
              disabled={busy || !file}
              data-testid="button-submit-piece"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Analyzing photo…" : "Add to collection"}
            </Button>
            <Button
              type="button"
              variant="outline"
              asChild
              disabled={busy}
              data-testid="button-cancel-add"
            >
              <Link href="/pottery">Cancel</Link>
            </Button>
          </div>
        </form>
      </div>
    </>
  );

  function toggleCategory(id: number) {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
}
