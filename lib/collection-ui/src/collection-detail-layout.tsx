import { type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@workspace/ui/skeleton";

export interface CollectionDetailLayoutProps {
  /** Back button label */
  backLabel?: string;
  onBack: () => void;
  /** Left column: image gallery */
  gallery: ReactNode;
  /** Right column: title + action buttons row */
  titleSlot: ReactNode;
  /** Right column: action icon buttons (small, outlined) */
  actions?: ReactNode;
  /** Right column: metadata fields */
  fields: ReactNode;
  /** Right column: additional panels (categories, description, etc.) */
  panels?: ReactNode;
  /** Full-width sections below the two-column hero */
  sections?: ReactNode;
}

export function CollectionDetailLayout({
  backLabel = "Collection",
  onBack,
  gallery,
  titleSlot,
  actions,
  fields,
  panels,
  sections,
}: CollectionDetailLayoutProps) {
  return (
    <div className="mx-auto max-w-3xl">
      {/* Back nav */}
      <button
        type="button"
        onClick={onBack}
        className="mb-4 -ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </button>

      {/* Hero: two-column grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: image gallery */}
        <div className="space-y-4">{gallery}</div>

        {/* Right: info + actions */}
        <div className="flex flex-col gap-4">
          {/* Title row + icon action buttons */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">{titleSlot}</div>
            {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
          </div>

          {/* Fields */}
          <div className="space-y-1">{fields}</div>

          {/* Extra panels */}
          {panels}
        </div>
      </div>

      {/* Full-width sections */}
      {sections && <div className="mt-8 space-y-6">{sections}</div>}
    </div>
  );
}

export function CollectionDetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Skeleton className="h-9 w-24" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </div>
  );
}
