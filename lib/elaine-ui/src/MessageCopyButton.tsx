import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

type CopyState = "idle" | "copied" | "error";

export function MessageCopyButton({
  text,
  complete = true,
  kind = "message",
}: {
  text: string;
  complete?: boolean;
  kind?: "message" | "code";
}) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  if (!complete || text.trim().length === 0) return null;

  const contentName = kind === "code" ? "Code" : "Message";
  const feedback =
    state === "copied"
      ? `${contentName} copied`
      : state === "error"
        ? `Couldn't copy ${contentName.toLowerCase()}`
        : "";
  const label =
    state === "copied"
      ? `${contentName} copied`
      : state === "error"
        ? "Copy failed — try again"
        : `Copy ${contentName.toLowerCase()}`;

  async function copyMessage() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    }

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div
      className={
        kind === "code" ? "flex items-center" : "flex min-h-10 items-center"
      }
    >
      <button
        type="button"
        onClick={() => void copyMessage()}
        className={`inline-flex shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
          kind === "code" ? "h-8 w-8 rounded-md" : "h-10 w-10 rounded-full"
        } ${
          state === "error"
            ? "text-destructive hover:bg-destructive/10"
            : "text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        }`}
        aria-label={label}
        title={label}
        data-testid={
          kind === "code" ? "button-copy-code" : "button-copy-message"
        }
      >
        {state === "copied" ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {feedback}
      </span>
    </div>
  );
}
