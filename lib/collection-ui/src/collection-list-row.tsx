import { type ReactNode } from "react";
import {
  MoreVertical,
  ExternalLink,
  Pencil,
  Tag,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/dropdown-menu";

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
  LinkComponent: React.ComponentType<{
    href: string;
    className?: string;
    children?: ReactNode;
    onClick?: React.MouseEventHandler;
  }>;
}

export function CollectionListRow({
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
  LinkComponent,
}: CollectionListRowProps) {
  return (
    <div className="group flex gap-4 p-3 bg-card border border-card-border rounded-xl hover:border-primary/50 transition-colors shadow-sm items-center">
      {/* Entire left+center area is a navigating link */}
      <LinkComponent
        href={href}
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
