import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  ZoomIn,
  MoreVertical,
  ExternalLink,
  Pencil,
  Tag,
  RefreshCw,
  Trash2,
  Check,
  X,
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
import type { AsyncActionStatus } from "./async-action-status";

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
  /**
   * Live status of an in-flight "Refresh AI" (or similar async) action for
   * this item — pass the result of `useAsyncActionStatus(key)`. Renders a
   * spinner/check/X badge on the thumbnail and disables `onReanalyze` while
   * "processing", so callers don't need to build their own badge UI or
   * duplicate-trigger guard.
   */

  aiStatus?: AsyncActionStatus;
  /**
   * When true, the card renders a selection checkbox instead of its normal
   * zoom/actions affordances, and clicking the card toggles selection
   * instead of navigating. Used by "Select" bulk-action mode and "Compare"
   * mode (see multi-select-mode.ts / compare-modal.tsx).
   */

  selecting?: boolean;

  selected?: boolean;

  onToggleSelect?: (id: number) => void;
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
  aiStatus,
  selecting = false,
  selected = false,
  onToggleSelect,
  LinkComponent,
}: CollectionCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (imgRef.current?.complete) setImgLoaded(true);
  }, []);

  return (
    <div className="relative group">
      {/* Selection checkbox (selecting mode) — top-left */}
      {selecting && (
        <button
          type="button"
          onClick={() => onToggleSelect?.(id)}
          className={cn(
            "absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-full border-2 transition",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-white/80 bg-black/30 text-transparent hover:border-primary",
          )}
          aria-label={selected ? "Deselect" : "Select"}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* Zoom button — top-left, only when not in selection mode */}
      {imageUrl && !selecting && (
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

      {/* AI refresh status badge — bottom-right of the thumbnail, always
          visible (not hover-gated) so it's a reliable in-progress/done/failed
          indicator even after leaving and returning to this page. */}
      {aiStatus && (
        <div
          className={cn(
            "absolute bottom-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full shadow-sm",
            aiStatus === "processing" && "bg-primary text-primary-foreground",
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
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          )}
          {aiStatus === "success" && <Check className="h-3.5 w-3.5" />}
          {aiStatus === "error" && <X className="h-3.5 w-3.5" />}
        </div>
      )}

      {/* Actions menu — top-right */}
      {!selecting && (
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
                  <DropdownMenuItem
                    onClick={onReanalyze}
                    disabled={aiStatus === "processing"}
                  >
                    <RefreshCw
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        aiStatus === "processing" && "animate-spin",
                      )}
                    />
                    {aiStatus === "processing" ? "Refreshing…" : "Refresh AI"}
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
      )}

      {/* Card body — navigates to detail, or toggles selection while selecting */}
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
        className={cn(
          "block overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md",
          selecting && selected
            ? "border-primary ring-2 ring-primary"
            : "border-card-border",
        )}
      >
        <div className="aspect-square overflow-hidden bg-muted">
          {imageUrl ? (
            <img
              ref={imgRef}
              src={imageUrl}
              alt={name}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(true)}
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
