import { type ReactNode } from "react";
import { Lock, Unlock } from "lucide-react";
import { cn } from "@workspace/web-core/utils";

// NOTE: Pottery is the visual gold standard these components were extracted
// from, but its detail page (artifacts/modules/src/pottery/pages/detail.tsx)
// deliberately keeps its own local field/section markup and is NOT wired to
// these components. No automated check compares the two, so any deliberate
// visual change here (spacing, typography, lock styling, section chrome)
// should be eyeballed against the Pottery detail page to keep the collections
// looking consistent. See docs/collection-item-page-convergence.md.

export interface CollectionDetailFieldProps {
  label: string;
  value: ReactNode;
  /** Show a lock/unlock toggle for AI field locking */
  locked?: boolean;
  onToggleLock?: () => void;
  lockTitle?: string;
  /** If true, renders as an edit input instead of static text */
  editing?: boolean;
  editSlot?: ReactNode;
  /** Extra class on the value text */
  valueClassName?: string;
  /** Dimmed when no value */
  empty?: boolean;
}

export function CollectionDetailField({
  label,
  value,
  locked,
  onToggleLock,
  lockTitle,
  editing = false,
  editSlot,
  valueClassName,
  empty,
}: CollectionDetailFieldProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/60 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
          {label}
        </p>
        {editing && editSlot ? (
          editSlot
        ) : (
          <p
            className={cn(
              "text-sm break-words",
              empty && "text-muted-foreground/60 italic",
              valueClassName,
            )}
          >
            {value}
          </p>
        )}
      </div>
      {onToggleLock && (
        <button
          type="button"
          onClick={onToggleLock}
          title={
            lockTitle ??
            (locked
              ? "Field is locked — AI won't overwrite it. Click to unlock."
              : "Field is unlocked — AI may update it. Click to lock.")
          }
          className={cn(
            "mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted",
            locked
              ? "text-primary"
              : "text-muted-foreground/40 hover:text-muted-foreground",
          )}
        >
          {locked ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <Unlock className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

export interface CollectionDetailSectionProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export function CollectionDetailSection({
  title,
  children,
  action,
}: CollectionDetailSectionProps) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
