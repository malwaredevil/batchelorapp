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
      el<span className="text-primary font-bold">AI</span>ne
    </span>
  );
}
