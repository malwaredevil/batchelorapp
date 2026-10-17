import { type ReactNode } from "react";
import { Lock, Unlock } from "lucide-react";
import { cn } from "@workspace/web-core/utils";
import { InfoTooltip } from "./info-tooltip";

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
  /** Plain-language explanation of how this value was collected/calculated,
   * shown via an info icon next to the label on hover/focus. */
  tooltip?: string;
  /** Visually call out a field that a guided repair flow asked the user to review. */
  highlighted?: boolean;
}

export function CollectionFieldLock({
  label,
  locked = false,
  onToggleLock,
  lockTitle,
  disabled = false,
  touchTarget = false,
}: {
  label: string;
  locked?: boolean;
  onToggleLock: () => void;
  lockTitle?: string;
  disabled?: boolean;
  touchTarget?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggleLock}
      disabled={disabled}
      aria-label={`${locked ? "Unlock" : "Lock"} ${label.toLowerCase()}`}
      aria-pressed={locked}
      title={
        lockTitle ??
        (locked
          ? "Field is locked — AI won't overwrite it. Click to unlock."
          : "Field is unlocked — AI may update it. Click to lock.")
      }
      className={cn(
        "mt-1 flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        touchTarget ? "h-11 w-11" : "h-6 w-6",
        locked
          ? "text-primary"
          : touchTarget
            ? "text-muted-foreground"
            : "text-muted-foreground/40 hover:text-muted-foreground",
      )}
    >
      {locked ? (
        <Lock className={touchTarget ? "h-4 w-4" : "h-3.5 w-3.5"} />
      ) : (
        <Unlock className={touchTarget ? "h-4 w-4" : "h-3.5 w-3.5"} />
      )}
    </button>
  );
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
  tooltip,
  highlighted = false,
}: CollectionDetailFieldProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 py-1.5 border-b border-border/60 last:border-0",
        highlighted &&
          "rounded-md bg-amber-500/10 px-2 ring-1 ring-amber-500/30",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {tooltip && <InfoTooltip text={tooltip} />}
        </div>
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
        <CollectionFieldLock
          label={label}
          locked={locked}
          onToggleLock={onToggleLock}
          lockTitle={lockTitle}
        />
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
