import type { ReactNode } from "react";
import { GripVertical, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";

interface DragHandleProps {
  listeners?: DraggableSyntheticListeners;
  attributes?: React.HTMLAttributes<HTMLButtonElement>;
  className?: string;
}

/**
 * Grip/grabby-hand icon used to reorder a Trip Detail card. Renders in the
 * top-left of a card header. Cursor changes to "grabbing" while dragging.
 */
export function DragHandle({
  listeners,
  attributes,
  className,
}: DragHandleProps) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing",
        className,
      )}
      aria-label="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}

interface CollapseToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  label?: string;
}

/**
 * Chevron toggle used to collapse/expand a Trip Detail card. Renders in the
 * top-right of a card header. Rotates to point up when expanded, down when
 * collapsed.
 */
export function CollapseToggle({
  collapsed,
  onToggle,
  className,
  label,
}: CollapseToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-label={
        collapsed
          ? `Expand ${label ?? "section"}`
          : `Collapse ${label ?? "section"}`
      }
      aria-expanded={!collapsed}
    >
      <ChevronDown
        className={cn(
          "h-4 w-4 transition-transform",
          collapsed ? "-rotate-90" : "rotate-0",
        )}
      />
    </button>
  );
}

interface CardShellProps {
  title: string;
  icon?: ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  dragHandleListeners?: DraggableSyntheticListeners;
  dragHandleAttributes?: React.HTMLAttributes<HTMLButtonElement>;
  children: ReactNode;
  className?: string;
}

/**
 * Generic wrapper that adds a drag handle (top-left, only rendered when
 * `dragHandleListeners` is supplied) and a collapse chevron (top-right) to
 * an existing Trip Detail card without needing to modify that card's own
 * internal markup. When collapsed, only the title (and optional icon) is
 * shown; the card's full content — including its own internal header — is
 * hidden.
 */
export function CardShell({
  title,
  icon,
  collapsed,
  onToggleCollapse,
  dragHandleListeners,
  dragHandleAttributes,
  children,
  className,
}: CardShellProps) {
  return (
    <Card className={cn("border-border/50", className)}>
      <CardContent className="py-4">
        <div
          className={cn(
            "flex items-center justify-between",
            !collapsed && "mb-1",
          )}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {dragHandleListeners && (
              <DragHandle
                listeners={dragHandleListeners}
                attributes={dragHandleAttributes}
              />
            )}
            {collapsed && (
              <span className="flex items-center gap-2 text-sm font-medium text-foreground truncate">
                {icon}
                {title}
              </span>
            )}
          </div>
          <CollapseToggle
            collapsed={collapsed}
            onToggle={onToggleCollapse}
            label={title}
          />
        </div>
        {!collapsed && children}
      </CardContent>
    </Card>
  );
}
