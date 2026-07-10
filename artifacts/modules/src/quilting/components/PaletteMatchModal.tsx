import { useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { colorToHex } from "@workspace/web-core";
import { Link } from "wouter";
import {
  usePaletteMatchFabrics,
  usePaletteMatchPatterns,
  usePaletteMatchQuilts,
} from "@workspace/api-client-react";

export type PaletteMatchEntity = "fabric" | "pattern" | "quilt";

interface MatchItem {
  id: number;
  name: string;
  imageUrl?: string | null;
  designer?: string | null;
  quantity?: number;
  quantityUnit?: string;
  dateCompleted?: string | null;
}

interface PaletteMatch {
  fabric?: MatchItem;
  pattern?: MatchItem;
  quilt?: MatchItem;
  score: number;
  matchedColors: string[];
}

interface PaletteMatchResponse {
  extractedColors: string[];
  matches: PaletteMatch[];
}

interface EntityConfig {
  dialogTitle: string;
  uploadHint: string;
  findLabel: string;
  emptyLabel: string;
  linkPrefix: string;
  resultKey: "fabric" | "pattern" | "quilt";
}

const ENTITY_CONFIG: Record<PaletteMatchEntity, EntityConfig> = {
  fabric: {
    dialogTitle: "Match fabrics from photo",
    uploadHint:
      "Painting, room photo, outfit — we'll extract its colour palette and find matching fabrics in your stash",
    findLabel: "Find matching fabrics",
    emptyLabel: "No matching fabrics found in your stash",
    linkPrefix: "/fabrics",
    resultKey: "fabric",
  },
  pattern: {
    dialogTitle: "Match patterns from photo",
    uploadHint:
      "Painting, room photo, outfit — we'll extract its colour palette and find matching patterns in your collection",
    findLabel: "Find matching patterns",
    emptyLabel: "No matching patterns found in your collection",
    linkPrefix: "/patterns",
    resultKey: "pattern",
  },
  quilt: {
    dialogTitle: "Match quilts from photo",
    uploadHint:
      "Painting, room photo, outfit — we'll extract its colour palette and find matching quilts in your collection",
    findLabel: "Find matching quilts",
    emptyLabel: "No matching quilts found in your collection",
    linkPrefix: "/quilts",
    resultKey: "quilt",
  },
};

interface Props {
  open: boolean;
  onClose: () => void;
  entity?: PaletteMatchEntity;
}

export function PaletteMatchModal({ open, onClose, entity = "fabric" }: Props) {
  const config = ENTITY_CONFIG[entity];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<PaletteMatchResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matchFabrics = usePaletteMatchFabrics();
  const matchPatterns = usePaletteMatchPatterns();
  const matchQuilts = usePaletteMatchQuilts();
  const loading =
    matchFabrics.isPending || matchPatterns.isPending || matchQuilts.isPending;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  async function handleMatch() {
    if (!file) return;
    try {
      let data: PaletteMatchResponse;
      if (entity === "pattern") {
        data = await matchPatterns.mutateAsync({ data: { image: file } });
      } else if (entity === "quilt") {
        data = await matchQuilts.mutateAsync({ data: { image: file } });
      } else {
        data = await matchFabrics.mutateAsync({ data: { image: file } });
      }
      setResult(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to analyse image.",
      );
    }
  }

  function handleClose() {
    setFile(null);
    setPreview(null);
    setResult(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {config.dialogTitle}
          </DialogTitle>
        </DialogHeader>

        {/* Upload area */}
        {!result && (
          <div className="space-y-4">
            <div
              className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors ${
                preview ? "border-primary/40 bg-primary/5" : "border-border"
              } overflow-hidden`}
              onClick={() => inputRef.current?.click()}
            >
              {preview ? (
                <img
                  src={preview}
                  alt="Inspiration"
                  className="h-48 w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
                  <ImagePlus className="h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium text-foreground">
                    Upload an inspiration image
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {config.uploadHint}
                  </p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {preview && (
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Remove
                </Button>
                <Button
                  size="sm"
                  onClick={handleMatch}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Analysing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-3.5 w-3.5" />
                      {config.findLabel}
                    </>
                  )}
                </Button>
              </div>
            )}

            {!preview && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => inputRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                Choose image
              </Button>
            )}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Colour strip */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Extracted palette
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {result.extractedColors.map((color) => (
                  <div key={color} className="flex items-center gap-1.5">
                    <span
                      className="h-5 w-5 rounded-full border border-border/40 shadow-sm"
                      style={{ backgroundColor: colorToHex(color) }}
                      title={color}
                    />
                    <span className="text-xs text-muted-foreground capitalize">
                      {color}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Matched items */}
            {result.matches.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {config.emptyLabel}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try an image with more colour variety
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {result.matches.length} matching {config.resultKey}
                  {result.matches.length !== 1 ? "s" : ""}
                </p>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {result.matches.map((m) => {
                    const item = m[config.resultKey];
                    if (!item) return null;
                    return (
                      <Link
                        key={item.id}
                        href={`${config.linkPrefix}/${item.id}`}
                        onClick={handleClose}
                      >
                        <div className="flex items-center gap-3 rounded-lg border border-card-border bg-card p-2 transition-colors hover:bg-muted/40">
                          {item.imageUrl && (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="h-12 w-12 shrink-0 rounded-md object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {item.name}
                            </p>
                            {item.designer && (
                              <p className="truncate text-xs text-muted-foreground">
                                {item.designer}
                              </p>
                            )}
                            {item.dateCompleted && (
                              <p className="truncate text-xs text-muted-foreground">
                                {item.dateCompleted}
                              </p>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {m.matchedColors.map((c) => (
                                <span
                                  key={c}
                                  className="h-3.5 w-3.5 rounded-full border border-border/30"
                                  style={{ backgroundColor: colorToHex(c) }}
                                  title={c}
                                />
                              ))}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3" />
                              {Math.round(m.score * 100)}%
                            </div>
                            {item.quantity != null && (
                              <p className="text-xs text-muted-foreground">
                                {item.quantity} {item.quantityUnit}
                              </p>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}

            {/* Start over */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setResult(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                Try another image
              </Button>
              <Button size="sm" variant="outline" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
