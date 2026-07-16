import { Lock, LockOpen } from "lucide-react";

export function LockButton({
  field,
  lockedFields,
  onToggle,
}: {
  field: string;
  lockedFields: string[];
  onToggle: (f: string) => void;
}) {
  const locked = lockedFields.includes(field);
  return (
    <button
      onClick={() => onToggle(field)}
      title={
        locked
          ? "AI will not change this — click to unlock"
          : "AI may update this — click to lock"
      }
      className={`ml-1 rounded p-0.5 transition-colors ${locked ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/25 hover:text-muted-foreground/60"}`}
    >
      {locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
    </button>
  );
}
