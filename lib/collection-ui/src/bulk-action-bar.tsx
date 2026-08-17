import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "@workspace/web-core/utils";

export interface BulkActionBarProps {
  /** How many items are currently selected. */
  selectedCount: number;
  /** Select every item currently shown in the gallery. */
  onSelectAll: () => void;
  /** Clear the selection (keep Select mode active). */
  onClearSelection: () => void;
  /** Exit Select mode entirely (and clear any per-card status icons). */
  onDone: () => void;
  /** Run the bulk action on the current selection. */
  onRun: () => void;
  /** Label for the primary action button, e.g. `Refresh AI (3)`. */
  runLabel: string;
  /** True while the bulk action is in flight — disables the run button. */
  isPending?: boolean;
  /** Message shown while nothing is selected, e.g. "Tap cards to select". */
  emptyHint?: string;
  /** Optional extra content rendered before the primary action button. */
  extraActions?: ReactNode;
  className?: string;
  /** Optional icon for the run button (defaults to a refresh icon). */
  runIcon?: ReactNode;
}

/**
 * Shared bulk-select action bar, used by every collection gallery that has a
 * "Select" mode (Ornaments, Pottery, Quilting quilts/patterns). One pattern —
 * established by Quilting — everywhere: selection count, "All" / "None"
 * selection controls, the primary bulk action, and a "Done" button that
 * leaves Select mode.
 */
export function BulkActionBar({
  selectedCount,
  onSelectAll,
  onClearSelection,
  onDone,
  onRun,
  runLabel,
  isPending = false,
  emptyHint = "Tap cards to select",
  extraActions,
  className,
  runIcon,
}: BulkActionBarProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5",
        className,
      )}
      data-testid="bulk-action-bar"
    >
      <span className="flex-1 text-sm font-medium">
        {selectedCount === 0 ? emptyHint : `${selectedCount} selected`}
      </span>
      <button
        type="button"
        onClick={onSelectAll}
        disabled={isPending}
        className="text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
        data-testid="button-bulk-select-all"
      >
        All
      </button>
      <button
        type="button"
        onClick={onClearSelection}
        disabled={isPending}
        className="text-xs text-muted-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
        data-testid="button-bulk-select-none"
      >
        None
      </button>
      {extraActions}
      {selectedCount > 0 && (
        <button
          type="button"
          onClick={onRun}
          disabled={isPending}
          className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          data-testid="button-bulk-reanalyze-run"
        >
          {runIcon ?? (
            <RefreshCw
              className={cn("h-3.5 w-3.5", isPending && "animate-spin")}
            />
          )}
          {runLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onDone}
        disabled={isPending}
        className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
        data-testid="button-bulk-done"
      >
        Done
      </button>
    </div>
  );
}
