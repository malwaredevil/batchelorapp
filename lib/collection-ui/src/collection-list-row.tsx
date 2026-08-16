import { type ReactNode } from "react";
import {
  MoreVertical,
  ExternalLink,
  Pencil,
  Tag,
  RefreshCw,
  Trash2,
  Check,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/dropdown-menu";
import { cn } from "@workspace/web-core/utils";
import type { AsyncActionStatus } from "./async-action-status";
export interface CollectionListRowProps {
  id: number;

  name: string;

  imageUrl?: string | null;

  href: string;
  /** Main subtitle line (e.g. brand, maker, year) */

  subtitle?: ReactNode;
  /** Secondary line (e.g. series, style) */

  detail?: ReactNode;
  /** Category badges */

  categoryBadges?: ReactNode;
  /** Color dots */

  colorDots?: ReactNode;
  /** Right-side value (e.g. book value, price) */

  valueDisplay?: ReactNode;
  /** Extra menu items */

  extraMenuItems?: ReactNode;

  onQuickEdit?: () => void;

  onSetCategories?: () => void;

  onReanalyze?: () => void;

  onDelete?: () => void;
  /** See CollectionCardProps.aiStatus — same badge/duplicate-trigger-guard behavior for list rows. */

  aiStatus?: AsyncActionStatus;
  /** See CollectionCardProps.selecting — same selection-overlay behavior for list rows. */

  selecting?: boolean;

  selected?: boolean;

  onToggleSelect?: (id: number) => void;

  LinkComponent: React.ComponentType<{
    href: string;
    className?: string;
    children?: ReactNode;
    onClick?: React.MouseEventHandler;
  }>;
}

export function CollectionListRow({
  id,
  name,
  imageUrl,
  href,
  subtitle,
  detail,
  categoryBadges,
  colorDots,
  valueDisplay,
  extraMenuItems,
  onQuickEdit,
  onSetCategories,
  onReanalyze,
  onDelete,
  aiStatus,
  selecting = false,
  selected = false,
  onToggleSelect,
  LinkComponent,
}: CollectionListRowProps) {
  return (
    <div
      className={cn(
        "group flex gap-4 p-3 bg-card border rounded-xl hover:border-primary/50 transition-colors shadow-sm items-center",
        selecting && selected
          ? "border-primary ring-2 ring-primary"
          : "border-card-border",
      )}
    >
      {/* Selection checkbox (selecting mode) */}
      {selecting && (
        <button
          type="button"
          onClick={() => onToggleSelect?.(id)}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted text-transparent hover:border-primary",
          )}
          aria-label={selected ? "Deselect" : "Select"}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* Entire left+center area is a navigating link (or selection toggle) */}
      <LinkComponent
        href={selecting ? "#" : href}
        onClick={
          selecting
            ? (e) => {
                e.preventDefault();
                onToggleSelect?.(id);
              }
            : undefined
        }
        className="flex flex-1 gap-4 items-center min-w-0 py-1"
      >
        {/* Thumbnail */}
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 overflow-hidden rounded-lg bg-muted border border-border">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 text-2xl select-none">
              ?
            </div>
          )}

          {/* AI refresh status badge — always visible, mirrors CollectionCard */}
          {aiStatus && (
            <div
              className={cn(
                "absolute -bottom-1 -right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full shadow-sm ring-2 ring-card",
                aiStatus === "processing" &&
                  "bg-primary text-primary-foreground",
                aiStatus === "success" && "bg-green-600 text-white",
                aiStatus === "error" &&
                  "bg-destructive text-destructive-foreground",
              )}
              title={
                aiStatus === "processing"
                  ? "Refreshing AI analysis…"
                  : aiStatus === "success"
                    ? "AI analysis refreshed"
                    : "AI refresh failed"
              }
            >
              {aiStatus === "processing" && (
                <RefreshCw className="h-3 w-3 animate-spin" />
              )}
              {aiStatus === "success" && <Check className="h-3 w-3" />}
              {aiStatus === "error" && <X className="h-3 w-3" />}
            </div>
          )}
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground text-base leading-tight truncate group-hover:text-primary transition-colors">
            {name}
          </h3>
          {subtitle && (
            <div className="text-sm text-muted-foreground mt-0.5">
              {subtitle}
            </div>
          )}
          {detail && (
            <div className="text-xs text-muted-foreground/80 mt-0.5">
              {detail}
            </div>
          )}
          {categoryBadges && (
            <div className="flex flex-wrap gap-1 mt-1.5">{categoryBadges}</div>
          )}
          {colorDots}
        </div>

        {/* Value (right side, hidden on tiny screens) */}
        {valueDisplay && (
          <div className="hidden sm:flex flex-col items-end shrink-0 pl-4">
            {valueDisplay}
          </div>
        )}
      </LinkComponent>

      {/* Actions menu — stays outside the Link */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="shrink-0 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 focus-within:opacity-100"
            aria-label="Options"
            onClick={(e) => e.preventDefault()}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <LinkComponent href={href}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open
            </LinkComponent>
          </DropdownMenuItem>
          {onQuickEdit && (
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                onQuickEdit();
              }}
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Quick edit
            </DropdownMenuItem>
          )}
          {onSetCategories && (
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                onSetCategories();
              }}
            >
              <Tag className="mr-2 h-3.5 w-3.5" />
              Set categories
            </DropdownMenuItem>
          )}
          {extraMenuItems}
          {onReanalyze && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onReanalyze}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Refresh AI
              </DropdownMenuItem>
            </>
          )}
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  onDelete();
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function CollectionList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}
