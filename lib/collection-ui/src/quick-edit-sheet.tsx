import type { ReactNode } from "react";
import { X } from "lucide-react";

export interface QuickEditSheetFrameProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  thumbnail?: {
    src: string;
    alt?: string;
  } | null;
  footer?: ReactNode;
  labelledBy?: string;
}

/**
 * Shared responsive shell for collection quick-edit forms. Domains supply
 * fields and mutations; this component owns modal layering, focusable close
 * controls, scrolling, header treatment, and action placement.
 */
export function QuickEditSheetFrame({
  title,
  onClose,
  children,
  thumbnail,
  footer,
  labelledBy = "collection-quick-edit-title",
}: QuickEditSheetFrameProps) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close quick edit"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-card-border bg-background shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-card-border bg-background px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {thumbnail && (
              <img
                src={thumbnail.src}
                alt={thumbnail.alt ?? ""}
                className="h-9 w-9 shrink-0 rounded-lg object-cover"
              />
            )}
            <p
              id={labelledBy}
              className="max-w-[240px] truncate text-sm font-semibold"
            >
              {title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-card-border"
            aria-label="Close quick edit"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-5">
          {children}
          {footer && <footer className="flex gap-2 pt-1">{footer}</footer>}
        </div>
      </section>
    </>
  );
}
