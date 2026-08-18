import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shared "Export for insurance" card used by both the Pottery and Ornaments
 * maintenance pages, parameterized by the domain-specific PDF generator,
 * copy, and layout variant so each page renders exactly as it did before
 * the copies were consolidated.
 */
export function InsuranceExportCard<T>({
  items,
  generatePdf,
  itemNounPlural,
  description,
  variant,
}: {
  items: T[] | undefined;
  /** Domain-specific PDF generator (e.g. pottery or ornaments pdf-export). */
  generatePdf: (
    items: T[],
    onProgress: (message: string) => void,
  ) => Promise<void>;
  /** Plural noun used in the success toast, e.g. "pieces" or "ornaments". */
  itemNounPlural: string;
  description: string;
  /** "section" = Pottery's plain section layout; "card" = Ornaments' Card layout. */
  variant: "section" | "card";
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const generating = progress !== null;

  const handleExport = async () => {
    if (!items || items.length === 0) {
      toast.error("No items to export");
      return;
    }
    setProgress("Starting…");
    try {
      await generatePdf(items, setProgress);
      toast.success(`PDF downloaded — ${items.length} ${itemNounPlural}`);
    } catch (err) {
      console.error("PDF export failed", err);
      toast.error("PDF generation failed. Try again.");
    } finally {
      setProgress(null);
    }
  };

  const icon = (
    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <FileDown className="h-5 w-5" />
    </span>
  );

  const exportButton = (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={generating || !items}
      className="shrink-0"
    >
      {generating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileDown className="h-4 w-4" />
      )}
      {generating ? progress : "Export PDF"}
    </Button>
  );

  if (variant === "card") {
    return (
      <Card className="border-card-border shadow-sm">
        <CardContent className="flex items-center justify-between gap-4 pt-6">
          <div className="flex items-start gap-3">
            {icon}
            <div className="min-w-0">
              <h2 className="font-semibold font-serif">Export for insurance</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
          {exportButton}
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="rounded-2xl border border-card-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Export for insurance</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        {exportButton}
      </div>
    </section>
  );
}
