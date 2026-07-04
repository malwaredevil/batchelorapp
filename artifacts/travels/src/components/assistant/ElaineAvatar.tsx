import avatarSrc from "@/assets/elaine-avatar.png";
import { cn } from "@/lib/utils";

export function ElaineAvatar({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <img
      src={avatarSrc}
      alt="elAIne"
      width={size}
      height={size}
      className={cn("rounded-full object-cover shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function ElaineWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-serif font-semibold tracking-tight", className)}>
      el<span className="italic font-extrabold text-primary">AI</span>ne
    </span>
  );
}

// Inline variant for embedding "elAIne" inside existing headings, paragraphs,
// buttons, or toast messages without imposing the wordmark's own font family —
// it inherits the surrounding text's size/weight/font and only styles the
// "AI" portion so it stands out everywhere the name appears.
export function ElaineName() {
  return (
    <>
      el<span className="italic font-extrabold text-primary">AI</span>ne
    </>
  );
}
