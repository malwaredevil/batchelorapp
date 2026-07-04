import avatarSrc from "@/assets/elaine-avatar.png";
import { cn } from "@/lib/utils";

export function ElaineAvatar({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src={avatarSrc}
      alt="Elaine"
      width={size}
      height={size}
      className={cn("rounded-full object-cover shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}

// Shared styling for the "AI" portion of the Elaine name/wordmark: bold
// red, standing out against the surrounding "El"/"ne" text so the
// name reads clearly instead of the harder-to-parse lowercase "elAIne".
const AI_HIGHLIGHT_CLASS = "font-extrabold text-red-600 dark:text-red-500";

export function ElaineWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-serif font-semibold tracking-tight", className)}>
      El<span className={AI_HIGHLIGHT_CLASS}>AI</span>ne
    </span>
  );
}

// Inline variant for embedding "Elaine" inside existing headings, paragraphs,
// buttons, or toast messages without imposing the wordmark's own font family —
// it inherits the surrounding text's size/weight/font and only styles the
// "AI" portion so it stands out everywhere the name appears.
//
// Rendered as a single <span> (not a bare Fragment) so the whole name is one
// DOM node. Fragments here would leave "El", the "AI" span, and "ne" as
// separate sibling nodes — inside a flex container (e.g. a dropdown menu
// item with `gap-*`) that turns each fragment into its own anonymous flex
// item, spacing the name apart into "El  AI  ne".
export function ElaineName() {
  return (
    <span>
      El<span className={AI_HIGHLIGHT_CLASS}>AI</span>ne
    </span>
  );
}
