import { useState, type ReactNode } from "react";
import {
  ZoomIn,
  MoreVertical,
  ExternalLink,
  Pencil,
  Tag,
  RefreshCw,
  Trash2,
  Check,
} from "lucide-react";
import { cn } from "@workspace/web-core/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/dropdown-menu";
import { PreviewZoomModal } from "./preview-zoom-modal";

export interface CollectionCategory {
  id: number;
  name: string;
  bgColor?: string | null;
  textColor?: string | null;
}

export interface CollectionCardProps {
  id: number;
  name: string;
  imageUrl?: string | null;
  href: string;
  subtitle?: string | null;
  categories?: CollectionCategory[];
  colorDots?: ReactNode;
  quantityBadge?: ReactNode;
  /** Extra menu items rendered inside the dropdown, before Delete */
  extraMenuItems?: ReactNode;
  onQuickEdit?: () => void;
  onSetCategories?: () => void;
  onReanalyze?: () => void;
  onDelete?: () => void;
  /** Link component from the router (passed in so this lib stays router-agnostic) */
  LinkComponent: React.ComponentType<{
    href: string;
    className?: string;
    children?: ReactNode;
    onClick?: React.MouseEventHandler;
  }>;
}

export function CollectionCard({
  id,
  name,
  imageUrl,
  href,
  subtitle,
  categories = [],
  colorDots,
  quantityBadge,
  extraMenuItems,
  onQuickEdit,
  onSetCategories,
  onReanalyze,
  onDelete,
  LinkComponent,
}: CollectionCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  return (
    <div className="relative group">
      {/* Zoom button — top-left */}
      {imageUrl && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setZoomOpen(true);
          }}
          className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
          title="Zoom preview"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Actions menu — top-right */}
      <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur"
              aria-label="Options"
            >
              <MoreVertical className="h-3.5 w-3.5" />
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

      {/* Card body — navigates to detail */}
      <LinkComponent
        href={href}
        className="block overflow-hidden rounded-xl border border-card-border bg-card shadow-sm transition hover:shadow-md"
      >
        <div className="aspect-square overflow-hidden bg-muted">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={name}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              style={{
                filter: imgLoaded ? "none" : "blur(8px)",
                transition: "filter 0.4s ease",
              }}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-muted-foreground/30 text-4xl select-none">
              ?
            </div>
          )}
        </div>
        <div className="space-y-1.5 p-3">
          <p className="truncate font-medium text-sm">{name}</p>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
          {categories.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {[...categories]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((cat) => (
                  <span
                    key={cat.id}
                    className={cn(
                      "inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold",
                      !cat.bgColor && "border-border text-muted-foreground",
                    )}
                    style={
                      cat.bgColor
                        ? {
                            backgroundColor: cat.bgColor,
                            color: cat.textColor ?? "#fff",
                            borderColor: "transparent",
                          }
                        : undefined
                    }
                  >
                    {cat.name}
                  </span>
                ))}
            </div>
          ) : (
            <span className="inline-flex items-center rounded-full border border-dashed border-border px-1.5 py-0 text-[10px] text-muted-foreground/70">
              Uncategorized
            </span>
          )}
          {colorDots}
          {quantityBadge && (
            <div className="flex items-center justify-end">{quantityBadge}</div>
          )}
        </div>
      </LinkComponent>

      {imageUrl && (
        <PreviewZoomModal
          open={zoomOpen}
          onClose={() => setZoomOpen(false)}
          title={name}
        >
          <img
            src={imageUrl}
            alt={name}
            className="max-h-full max-w-full object-contain"
          />
        </PreviewZoomModal>
      )}
    </div>
  );
}

export function CollectionCardSkeleton() {
  return <div className="aspect-[3/4] animate-pulse rounded-xl bg-muted" />;
}

export function CollectionGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}
