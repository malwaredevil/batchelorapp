import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

interface SortableSectionRenderProps {
  dragHandleListeners: DraggableSyntheticListeners;
  dragHandleAttributes: React.HTMLAttributes<HTMLButtonElement>;
  isDragging: boolean;
}

interface SortableSectionProps {
  id: string;
  children: (props: SortableSectionRenderProps) => ReactNode;
  className?: string;
}

/**
 * Wraps a single Trip Detail card so it can be reordered via dnd-kit. Uses a
 * render-prop pattern to hand the drag handle's listeners/attributes down to
 * the card's own header, since the whole card body must stay non-draggable
 * (only the grip icon initiates a drag).
 */
export function SortableSection({ id, children, className }: SortableSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "z-10 opacity-70", className)}
    >
      {children({
        dragHandleListeners: listeners,
        dragHandleAttributes: attributes as React.HTMLAttributes<HTMLButtonElement>,
        isDragging,
      })}
    </div>
  );
}
