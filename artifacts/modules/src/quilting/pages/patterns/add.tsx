import { useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Camera,
  Upload,
  Loader2,
  Link2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  useCreatePattern,
  useImportPatternFromUrl,
  getListPatternsQueryKey,
  useListQuiltingCategories,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagSelector } from "@/quilting/components/tag-selector";
import { usePageAssistantContext } from "@/quilting/lib/assistant-context";

export default function AddPattern() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedCatIds, setSelectedCatIds] = useState<number[]>([]);

  // URL import state
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  // Pre-filled field values (used after import)
  const [fields, setFields] = useState<Record<string, string>>({});

  const { data: allCategories } = useListQuiltingCategories();

  usePageAssistantContext(
    "quilting-patterns-add",
    "Add Pattern page: a form to add a new quilt pattern (name, designer, block size, difficulty, source, notes) either by uploading a photo/URL import or filling fields manually — a pattern's photo is optional. You have a create_pattern action tool for this that can create a pattern record from chat without a photo, but cannot run the URL-import or photo-analysis flows.",
  );

  const create = useCreatePattern({
    mutation: {
      onSuccess: (pattern) => {
        queryClient.invalidateQueries({ queryKey: getListPatternsQueryKey() });
        toast.success("Pattern added!");
        navigate(`/quilting/patterns/${pattern.id}`);
      },
      onError: () => toast.error("Failed to add pattern. Please try again."),
    },
  });

  const importFromUrl = useImportPatternFromUrl();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function handleImport() {
    const url = importUrl.trim();
    if (!url) {
      toast.error("Enter a URL first.");
      return;
    }
    if (!url.startsWith("http")) {
      toast.error("URL must start with http or https.");
      return;
    }
    setImporting(true);
    try {
      const info = await importFromUrl.mutateAsync({ data: { url } });
      const next: Record<string, string> = {};
      if (info.name) next.name = info.name;
      if (info.designer) next.designer = info.designer;
      if (info.difficulty) next.difficulty = info.difficulty;
      if (info.blockSizeInches != null)
        next.blockSize = `${info.blockSizeInches}"`;
      if (info.style) next.sourceType = info.style;
      if (info.notes) next.notes = info.notes;
      setFields(next);
      toast.success("Pattern info imported! Review the fields below.");
    } catch {
      toast.error(
        "Couldn't extract info from that URL. Fill in the form manually.",
      );
    } finally {
      setImporting(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => (fd.get(k) as string | null) || undefined;
    const categoryNames = (allCategories ?? [])
      .filter((c) => selectedCatIds.includes(c.id))
      .map((c) => c.name);
    create.mutate({
      data: {
        image: file ?? undefined,
        name: fd.get("name") as string,
        designer: get("designer"),
        blockSize: get("blockSize"),
        difficulty: get("difficulty"),
        sourceType: get("sourceType"),
        sourceReference: get("sourceReference"),
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
          onClick={() => navigate("/quilting/patterns")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Add pattern</h1>
      </div>

      {/* URL import bar */}
      <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Import from URL
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Paste a link to an Etsy listing, Quiltville pattern page, or any
          pattern website and AI will fill in the details for you.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://www.etsy.com/listing/…"
              className="pl-8 text-sm"
              onKeyDown={(e) =>
                e.key === "Enter" && (e.preventDefault(), handleImport())
              }
            />
          </div>
          <Button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="shrink-0"
            size="sm"
          >
            {importing ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Importing…
              </>
            ) : (
              "Import"
            )}
          </Button>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
        {/* Optional photo */}
        <div>
          <Label className="mb-2 block">Photo (optional)</Label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 py-8 transition-colors hover:border-primary hover:bg-muted/50"
          >
            {preview ? (
              <img
                src={preview}
                alt="Preview"
                className="max-h-48 rounded-lg object-contain"
              />
            ) : (
              <>
                <Camera className="h-8 w-8 text-muted-foreground/50" />
                <span className="text-sm text-muted-foreground">
                  Add a photo of the pattern cover (optional)
                </span>
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
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
              name="name"
              required
              placeholder="e.g. Flying Geese, Log Cabin"
              className="mt-1.5"
              defaultValue={fields.name ?? ""}
              key={`name-${fields.name}`}
            />
          </div>
          <div>
            <Label htmlFor="designer">Designer</Label>
            <Input
              id="designer"
              name="designer"
              placeholder="e.g. Bonnie Hunter"
              className="mt-1.5"
              defaultValue={fields.designer ?? ""}
              key={`designer-${fields.designer}`}
            />
          </div>
          <div>
            <Label htmlFor="blockSize">Block size</Label>
            <Input
              id="blockSize"
              name="blockSize"
              placeholder='e.g. 6", 12.5"'
              className="mt-1.5"
              defaultValue={fields.blockSize ?? ""}
              key={`blockSize-${fields.blockSize}`}
            />
          </div>
          <div>
            <Label htmlFor="difficulty">Difficulty</Label>
            <Input
              id="difficulty"
              name="difficulty"
              placeholder="e.g. beginner, intermediate"
              className="mt-1.5"
              defaultValue={fields.difficulty ?? ""}
              key={`difficulty-${fields.difficulty}`}
            />
          </div>
          <div>
            <Label htmlFor="sourceType">Source type / style</Label>
            <Input
              id="sourceType"
              name="sourceType"
              placeholder="e.g. book, magazine, PDF, HST"
              className="mt-1.5"
              defaultValue={fields.sourceType ?? ""}
              key={`sourceType-${fields.sourceType}`}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sourceReference">Source reference</Label>
            <Input
              id="sourceReference"
              name="sourceReference"
              placeholder="e.g. 'Easy Does It' p.42"
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
              defaultValue={fields.notes ?? ""}
              key={`notes-${fields.notes}`}
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

        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Add pattern"
          )}
        </Button>
      </form>
    </div>
  );
}
