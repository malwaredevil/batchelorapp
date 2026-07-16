import { cn } from "@/lib/utils";

interface DominantColorDotsProps {
  colors: string[];
  max?: number;
  activeColor?: string | null;
  onColorClick?: (color: string) => void;
  toHex?: (color: string) => string;
  className?: string;
}

export function DominantColorDots({
  colors,
  max = 5,
  activeColor,
  onColorClick,
  toHex,
  className,
}: DominantColorDotsProps) {
  if (colors.length === 0) return null;
  const shown = colors.slice(0, max);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {shown.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={
            onColorClick
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onColorClick(c);
                }
              : undefined
          }
          className={cn(
            "h-3.5 w-3.5 rounded-full border transition",
            onColorClick && "hover:scale-125 focus:outline-none",
            activeColor === c
              ? "border-primary ring-2 ring-primary/50 scale-125"
              : "border-black/15 hover:border-black/30",
          )}
          style={{ backgroundColor: toHex ? toHex(c) : c }}
          title={`Filter by ${c}`}
          aria-label={`Filter by ${c}`}
        />
      ))}
    </div>
  );
}
