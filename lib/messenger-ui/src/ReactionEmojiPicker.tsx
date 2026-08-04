import { useEffect, useRef, useState, type RefObject } from "react";
import EmojiPicker, { Theme, EmojiStyle } from "emoji-picker-react";

interface ReactionEmojiPickerProps {
  /** Ref to the trigger ("+") button this picker is anchored next to. */
  anchorRef: RefObject<HTMLElement | null>;
  isDark: boolean;
  /** Which edge to hug — right for own messages, left for others. */
  align: "left" | "right";
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const DESIRED_HEIGHT = 340;
const VIEWPORT_MARGIN = 12;

/**
 * Full categorized/searchable emoji grid opened from a message's "+" more-
 * reactions button (Teams-style — the compact toolbar only shows a few quick
 * emoji directly; this is the rest of the library).
 *
 * Measures the anchor button's position in the viewport once on open and
 * flips above/below (whichever side has more room) with a height capped to
 * fit, so it can never render partly off the top or bottom of the screen —
 * unlike the old fixed small popup, which always opened upward and ran off
 * the top of the page for messages near the top of the scrollable list.
 */
export function ReactionEmojiPicker({
  anchorRef,
  isDark,
  align,
  onSelect,
  onClose,
}: ReactionEmojiPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    side: "above" | "below";
    height: number;
  } | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (
      spaceAbove >= DESIRED_HEIGHT + VIEWPORT_MARGIN ||
      spaceAbove >= spaceBelow
    ) {
      setPlacement({
        side: "above",
        height: Math.max(
          220,
          Math.min(DESIRED_HEIGHT, spaceAbove - VIEWPORT_MARGIN),
        ),
      });
    } else {
      setPlacement({
        side: "below",
        height: Math.max(
          220,
          Math.min(DESIRED_HEIGHT, spaceBelow - VIEWPORT_MARGIN),
        ),
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        ...(placement?.side === "below"
          ? { top: "calc(100% + 6px)" }
          : { bottom: "calc(100% + 6px)" }),
        ...(align === "right" ? { right: 0 } : { left: 0 }),
        width: 300,
        maxWidth: "calc(100vw - 24px)",
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 12,
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
        zIndex: 60,
        overflow: "hidden",
        // Hide until we've measured the anchor so it never flashes in the
        // wrong spot before flipping.
        visibility: placement ? "visible" : "hidden",
      }}
    >
      <EmojiPicker
        onEmojiClick={(data) => onSelect(data.emoji)}
        theme={isDark ? Theme.DARK : Theme.LIGHT}
        emojiStyle={EmojiStyle.NATIVE}
        width="100%"
        height={placement?.height ?? DESIRED_HEIGHT}
        previewConfig={{ showPreview: false }}
        searchPlaceHolder="Search emoji"
        lazyLoadEmojis
      />
    </div>
  );
}
