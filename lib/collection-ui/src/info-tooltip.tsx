import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/tooltip";
import { cn } from "@workspace/web-core/utils";

export interface InfoTooltipProps {
  /** Plain-language explanation of how this value was collected or calculated. */
  text: string;
  className?: string;
}

/**
 * A small "ⓘ" affordance for a label, revealing a plain-language explanation
 * of where a value came from (e.g. "scraped from X" or "average of A and B")
 * on hover/focus. Relies on a `TooltipProvider` ancestor — the app already
 * wraps its root in one (see App.tsx), so callers don't need their own.
 */
export function InfoTooltip({ text, className }: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-colors",
            className,
          )}
          aria-label="How this value was collected or calculated"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-left font-normal normal-case tracking-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
