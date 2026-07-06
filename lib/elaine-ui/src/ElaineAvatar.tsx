import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@workspace/web-core/utils";
import avatarSrc from "./assets/elaine-avatar.png";

// A little life for Elaine's thumbnail: every so often, at an unpredictable
// interval, she does something small and playful — a wiggle, a wave, a
// spin — instead of sitting there as a dead photo. Nothing here is a
// pre-rendered gif; it's all randomized CSS transforms/emoji picked and
// timed at runtime, so the exact moment/kind/flavor of "alive" she is next
// is different every time. Kept purely decorative (aria-hidden, disabled
// under prefers-reduced-motion) so it never affects a11y or interaction.

type Quirk =
  | "wiggle"
  | "bounce"
  | "tiltPeek"
  | "spin"
  | "pulse"
  | "shake"
  | "wave"
  | "sparkle";

const QUIRKS: Quirk[] = [
  "wiggle",
  "bounce",
  "tiltPeek",
  "spin",
  "pulse",
  "shake",
  "wave",
  "sparkle",
];

const QUIRK_DURATION_MS: Record<Quirk, number> = {
  wiggle: 800,
  bounce: 900,
  tiltPeek: 1000,
  spin: 700,
  pulse: 1200,
  shake: 600,
  wave: 1400,
  sparkle: 1500,
};

const IMG_ANIMATION_CLASS: Partial<Record<Quirk, string>> = {
  wiggle: "elaine-quirk-wiggle",
  bounce: "elaine-quirk-bounce",
  tiltPeek: "elaine-quirk-tilt-peek",
  spin: "elaine-quirk-spin",
  pulse: "elaine-quirk-pulse",
  shake: "elaine-quirk-shake",
};

const WAVE_EMOJIS = ["👋", "🤚", "✋"];
const SPARKLE_EMOJIS = ["✨", "⭐", "💫", "🎉", "🌟"];

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const STYLE_TAG_ID = "elaine-alive-avatar-styles";

function ensureStylesInjected() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = `
@keyframes elaine-wiggle { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-9deg); } 75% { transform: rotate(9deg); } }
@keyframes elaine-bounce { 0%,100% { transform: translateY(0); } 35% { transform: translateY(-18%); } 65% { transform: translateY(3%); } }
@keyframes elaine-tilt-peek { 0%,100% { transform: rotate(0deg) scale(1); } 40% { transform: rotate(-7deg) scale(1.07); } 70% { transform: rotate(5deg) scale(1.03); } }
@keyframes elaine-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@keyframes elaine-pulse { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(220,38,38,0)); } 50% { transform: scale(1.09); filter: drop-shadow(0 0 8px rgba(220,38,38,0.45)); } }
@keyframes elaine-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
@keyframes elaine-wave-hand { 0% { opacity: 0; transform: rotate(0deg) translateY(15%) scale(0.5); } 15% { opacity: 1; transform: rotate(-12deg) translateY(0) scale(1); } 35% { transform: rotate(22deg); } 55% { transform: rotate(-16deg); } 75% { transform: rotate(12deg); } 92% { opacity: 1; transform: rotate(0deg) scale(1); } 100% { opacity: 0; transform: scale(0.6); } }
@keyframes elaine-sparkle-pop { 0% { opacity: 0; transform: scale(0.3) translateY(0); } 30% { opacity: 1; transform: scale(1.15) translateY(-5px); } 70% { opacity: 1; } 100% { opacity: 0; transform: scale(0.5) translateY(-16px); } }
.elaine-quirk-wiggle { animation: elaine-wiggle 0.8s ease-in-out; }
.elaine-quirk-bounce { animation: elaine-bounce 0.9s cubic-bezier(0.34, 1.56, 0.64, 1); }
.elaine-quirk-tilt-peek { animation: elaine-tilt-peek 1s ease-in-out; }
.elaine-quirk-spin { animation: elaine-spin 0.7s ease-in-out; }
.elaine-quirk-pulse { animation: elaine-pulse 1.2s ease-in-out; }
.elaine-quirk-shake { animation: elaine-shake 0.6s ease-in-out; }
.elaine-quirk-wave-hand { animation: elaine-wave-hand 1.4s ease-in-out; transform-origin: 70% 70%; }
.elaine-quirk-sparkle { animation: elaine-sparkle-pop 1.1s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .elaine-quirk-wiggle, .elaine-quirk-bounce, .elaine-quirk-tilt-peek, .elaine-quirk-spin, .elaine-quirk-pulse, .elaine-quirk-shake, .elaine-quirk-wave-hand, .elaine-quirk-sparkle {
    animation: none !important;
  }
}
`;
  document.head.appendChild(style);
}

type ActiveQuirk = {
  quirk: Quirk;
  seed: number;
  emoji?: string;
  sparklePositions?: { top: string; left: string; delay: number }[];
};

// Schedules the next "alive" moment at a random point in the future, plays
// a randomly-picked quirk for its duration, then schedules the next one —
// forever, for as long as the avatar is mounted. The randomized delay
// between moments (and the randomized quirk/emoji/position each time) is
// what keeps it from ever feeling like a looping gif.
function useAliveQuirk(enabled: boolean): ActiveQuirk | null {
  const [active, setActive] = useState<ActiveQuirk | null>(null);
  const lastQuirk = useRef<Quirk | null>(null);

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    ensureStylesInjected();

    let scheduleTimeout: ReturnType<typeof setTimeout>;
    let clearTimeout_: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function scheduleNext() {
      const idleDelay = randomBetween(7000, 18000);
      scheduleTimeout = setTimeout(() => {
        if (cancelled) return;

        let quirk = pickRandom(QUIRKS);
        let attempts = 0;
        while (quirk === lastQuirk.current && attempts < 5) {
          quirk = pickRandom(QUIRKS);
          attempts++;
        }
        lastQuirk.current = quirk;

        const next: ActiveQuirk = { quirk, seed: Math.random() };
        if (quirk === "wave") next.emoji = pickRandom(WAVE_EMOJIS);
        if (quirk === "sparkle") {
          next.sparklePositions = Array.from(
            { length: 2 + Math.floor(Math.random() * 2) },
            () => ({
              top: `${randomBetween(-15, 70)}%`,
              left: `${randomBetween(-15, 85)}%`,
              delay: randomBetween(0, 250),
            }),
          );
          next.emoji = pickRandom(SPARKLE_EMOJIS);
        }

        setActive(next);
        clearTimeout_ = setTimeout(() => {
          if (!cancelled) setActive(null);
        }, QUIRK_DURATION_MS[quirk]);

        scheduleNext();
      }, idleDelay);
    }

    scheduleNext();
    return () => {
      cancelled = true;
      clearTimeout(scheduleTimeout);
      clearTimeout(clearTimeout_);
    };
  }, [enabled]);

  return active;
}

export function ElaineAvatar({
  className,
  size = 40,
  /**
   * Whether Elaine's thumbnail occasionally does something playful and
   * unpredictable (wiggle, wave, sparkle, etc). Defaults to on for
   * standalone/singular avatars (header, chat bubble trigger, settings
   * card). Pass `false` for avatars that repeat many times on one screen
   * (e.g. one per chat message) where independent random animation would
   * just be visual noise.
   */
  animated = true,
}: {
  className?: string;
  size?: number;
  animated?: boolean;
}) {
  const active = useAliveQuirk(animated);
  const imgAnimClass = active ? IMG_ANIMATION_CLASS[active.quirk] : undefined;

  const sparkles = useMemo(
    () => active?.sparklePositions ?? [],
    [active?.sparklePositions],
  );

  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      <img
        src={avatarSrc}
        alt="Elaine"
        width={size}
        height={size}
        className={cn(
          "rounded-full object-cover",
          imgAnimClass,
          className,
        )}
        style={{ width: size, height: size }}
      />
      {active?.quirk === "wave" && (
        <span
          key={active.seed}
          aria-hidden
          className="elaine-quirk-wave-hand absolute -bottom-1 -right-1 select-none leading-none"
          style={{ fontSize: Math.max(size * 0.45, 14) }}
        >
          {active.emoji}
        </span>
      )}
      {active?.quirk === "sparkle" &&
        sparkles.map((pos, i) => (
          <span
            key={`${active.seed}-${i}`}
            aria-hidden
            className="elaine-quirk-sparkle absolute select-none leading-none"
            style={{
              top: pos.top,
              left: pos.left,
              fontSize: Math.max(size * 0.3, 10),
              animationDelay: `${pos.delay}ms`,
            }}
          >
            {active.emoji}
          </span>
        ))}
    </span>
  );
}

// Shared styling for the "ai" portion of the Elaine name/wordmark: the name
// displays as plain Name Case "Elaine" — the only visual difference is that
// the "ai" letters are red, so the name reads clearly instead of the
// harder-to-parse "ElAIne".
const AI_HIGHLIGHT_CLASS = "text-red-600 dark:text-red-500";

export function ElaineWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-serif font-semibold tracking-tight", className)}>
      El<span className={AI_HIGHLIGHT_CLASS}>ai</span>ne
    </span>
  );
}

// Inline variant for embedding "Elaine" inside existing headings, paragraphs,
// buttons, or toast messages without imposing the wordmark's own font family —
// it inherits the surrounding text's size/weight/font and only styles the
// "ai" portion so it stands out everywhere the name appears.
//
// Rendered as a single <span> (not a bare Fragment) so the whole name is one
// DOM node. Fragments here would leave "El", the "ai" span, and "ne" as
// separate sibling nodes — inside a flex container (e.g. a dropdown menu
// item with `gap-*`) that turns each fragment into its own anonymous flex
// item, spacing the name apart into "El  ai  ne".
export function ElaineName() {
  return (
    <span>
      El<span className={AI_HIGHLIGHT_CLASS}>ai</span>ne
    </span>
  );
}
