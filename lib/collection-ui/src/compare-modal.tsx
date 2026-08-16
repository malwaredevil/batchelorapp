import type { ReactNode } from "react";
import { X, GitCompare } from "lucide-react";
import { Button } from "@workspace/ui/button";
import { cn } from "@workspace/web-core/utils";

// ---------------------------------------------------------------------------
// Shared "side-by-side comparison" feature for collection gallery pages.
//
// Pottery's gallery page pioneered a Compare toolbar action: toggle compare
// mode, tap up to 5 cards to select them, then open a modal that lays the
// selected items out side by side. This module generalizes that so
// Quilting and Ornaments (and any future collection) can reuse it verbatim
// instead of re-implementing the modal and floating action bar by hand.
// Pottery itself stays on its own hand-written implementation by design.
// ---------------------------------------------------------------------------

export interface CompareField {
  label: string;
  value: ReactNode;
}

export interface CompareItem {
  id: number;
  name: string;
  imageUrl?: string | null;
  href: string;
  /** Ordered list of label/value rows shown under the name. Falsy values are skipped. */
  fields?: CompareField[];
  /** Dominant-color swatches shown as small dots. */
  colors?: string[];
  colorToHex?: (color: string) => string;
  /** Arbitrary extra content (e.g. category badges) rendered below fields. */
  extra?: ReactNode;
}

export interface CompareModalProps {
  items: CompareItem[];
  onClose: () => void;
  title?: string;
  /** Link component from the router (kept out of this lib so it stays router-agnostic). */
  LinkComponent: React.ComponentType<{
    href: string;
    className?: string;
    children?: ReactNode;
    onClick?: React.MouseEventHandler;
  }>;
}

export function CompareModal({
  items,
  onClose,
  title = "Side-by-side comparison",
  LinkComponent,
}: CompareModalProps) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl md:inset-x-4 md:top-20 md:rounded-2xl">
        <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
          <h2 className="font-bold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-card-border"
            aria-label="Close comparison"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <div
            className="grid h-full min-w-max gap-4 p-4"
            style={{
              gridTemplateColumns: `repeat(${items.length}, minmax(200px, 1fr))`,
            }}
          >
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-3">
                <LinkComponent href={item.href} onClick={onClose}>
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="aspect-square w-full rounded-xl border border-card-border object-cover transition hover:opacity-90"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded-xl border border-card-border bg-muted" />
                  )}
                </LinkComponent>
                <div className="space-y-1.5 text-sm">
                  <p className="font-semibold leading-tight">{item.name}</p>
                  {(item.fields ?? []).map((field, i) =>
                    field.value != null && field.value !== "" ? (
                      <p key={i} className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {field.label}:
                        </span>{" "}
                        {field.value}
                      </p>
                    ) : null,
                  )}
                  {item.colors && item.colors.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.colors.map((c, i) => (
                        <span
                          key={i}
                          className="flex items-center gap-1 text-xs"
                        >
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-black/10"
                            style={{
                              backgroundColor: item.colorToHex
                                ? item.colorToHex(c)
                                : c,
                            }}
                          />
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.extra}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export interface CompareFloatingBarProps {
  /** Number of items currently selected. Bar renders nothing below `min`. */
  count: number;
  /** Minimum selection required before the bar (and its action) appears. */
  min?: number;
  onCompare: () => void;
  label?: string;
  className?: string;
}

export function CompareFloatingBar({
  count,
  min = 2,
  onCompare,
  label = "selected",
  className,
}: CompareFloatingBarProps) {
  if (count < min) return null;
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6",
        className,
      )}
    >
      <div className="flex items-center gap-3 rounded-full border border-primary/30 bg-background/95 px-5 py-3 shadow-xl backdrop-blur">
        <span className="text-sm font-medium text-muted-foreground">
          {count} {label}
        </span>
        <Button size="sm" onClick={onCompare}>
          <GitCompare className="h-4 w-4" />
          Compare
        </Button>
      </div>
    </div>
  );
}
