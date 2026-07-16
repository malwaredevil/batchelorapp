import { cn } from "@/lib/utils";

interface QuantityBadgeProps {
  quantity: number | null | undefined;
  className?: string;
}

export function QuantityBadge({ quantity, className }: QuantityBadgeProps) {
  if ((quantity ?? 1) <= 1) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      ×{quantity}
    </span>
  );
}
