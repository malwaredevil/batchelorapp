import { Check, HelpCircle, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type Verdict = "yes" | "maybe" | "no";

const STYLES: Record<
  Verdict,
  { label: string; className: string; icon: typeof Check }
> = {
  yes: {
    label: "Yes",
    className: "bg-primary text-primary-foreground border-transparent",
    icon: Check,
  },
  maybe: {
    label: "Maybe",
    className: "bg-amber-100 text-amber-900 border-amber-200",
    icon: HelpCircle,
  },
  no: {
    label: "No",
    className: "bg-muted text-foreground border-card-border",
    icon: Minus,
  },
};

export function VerdictPill({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  const s = STYLES[verdict];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        s.className,
        className,
      )}
      data-testid={`verdict-${verdict}`}
    >
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}
