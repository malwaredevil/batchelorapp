import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MessageCircle,
  X,
  MessageSquarePlus,
  Maximize2,
  History,
  GripVertical,
} from "lucide-react";
import {
  useGetElaineNudgesUnseenCount,
  getGetElaineNudgesUnseenCountQueryKey,
  type ConversationMessage,
  type ElaineAppId,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { ElaineAvatar, ElaineWordmark } from "./ElaineAvatar";
import { useElaineChat } from "./useElaineChat";
import { ElaineChatPanel } from "./ElaineChatPanel";
import { ElaineHistoryPanel } from "./ElaineHistoryPanel";

// Default pixel dimensions per size preference.
const CHAT_WINDOW_DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  compact: { w: 320, h: 448 },
  comfortable: { w: 384, h: 512 },
  large: { w: 448, h: 608 },
};

const MIN_W = 280;
const MIN_H = 340;

export function ElaineWidget({
  appId,
  fullScreenPath,
  currentPath,
}: {
  appId: ElaineAppId;
  fullScreenPath?: string;
  currentPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 640px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const chat = useElaineChat({ appId, active: open });
  const { settings, messages, isStreaming, streamingContent } = chat;

  // Resize state — null means use defaults from settings.chatWindowSize
  const [customSize, setCustomSize] = useState<{ w: number; h: number } | null>(
    null,
  );

  // Drag state ref — avoids stale closures without triggering re-renders
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // Widget position — null means anchored bottom-right via CSS (default).
  // Once the user drags the widget (bubble or panel header), it switches to
  // an explicit top/left position that persists across open/close.
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const moveRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);

  const clampPosition = useCallback((x: number, y: number) => {
    const el = containerRef.current;
    const w = el?.offsetWidth ?? 60;
    const h = el?.offsetHeight ?? 60;
    const maxX = Math.max(4, window.innerWidth - w - 4);
    const maxY = Math.max(4, window.innerHeight - h - 4);
    return {
      x: Math.min(Math.max(4, x), maxX),
      y: Math.min(Math.max(4, y), maxY),
    };
  }, []);

  const onMovePointerDown = useCallback((e: React.PointerEvent) => {
    // Never start a drag (or capture the pointer) from a click that
    // originated on a button/interactive control inside the header —
    // setPointerCapture reroutes the resulting click event to the
    // capturing element in most browsers, which silently swallows clicks
    // on the History/Fullscreen/New-chat/Close buttons.
    if ((e.target as HTMLElement).closest("button")) return;

    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    moveRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onMovePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ms = moveRef.current;
      if (!ms) return;
      const dx = e.clientX - ms.startX;
      const dy = e.clientY - ms.startY;
      if (!ms.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        ms.moved = true;
      }
      if (!ms.moved) return;
      setPosition(clampPosition(ms.origX + dx, ms.origY + dy));
    },
    [clampPosition],
  );

  const onMovePointerUp = useCallback((e: React.PointerEvent) => {
    const ms = moveRef.current;
    moveRef.current = null;
    if (ms?.moved) {
      justDraggedRef.current = true;
    }
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already have been released — safe to ignore.
    }
  }, []);

  // Re-clamp the saved position on viewport resize/orientation change so the
  // widget never ends up off-screen (e.g. rotating a mobile device).
  useEffect(() => {
    if (!position) return;
    const onResize = () => {
      setPosition((prev) => (prev ? clampPosition(prev.x, prev.y) : prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position, clampPosition]);

  const getDefaultSize = useCallback(() => {
    const key = settings?.chatWindowSize ?? "compact";
    return CHAT_WINDOW_DEFAULT_SIZES[key] ?? CHAT_WINDOW_DEFAULT_SIZES.compact;
  }, [settings?.chatWindowSize]);

  const currentSize = customSize ?? getDefaultSize();

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const size = customSize ?? getDefaultSize();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: size.w,
        startH: size.h,
      };

      function onMove(ev: MouseEvent) {
        if (!dragRef.current) return;
        // Widget is anchored at bottom-right, so dragging toward top-left
        // increases the dimensions.
        const dx = dragRef.current.startX - ev.clientX;
        const dy = dragRef.current.startY - ev.clientY;
        const maxW = Math.floor(window.innerWidth * 0.9);
        const maxH = Math.floor(window.innerHeight * 0.88);
        setCustomSize({
          w: Math.max(MIN_W, Math.min(maxW, dragRef.current.startW + dx)),
          h: Math.max(MIN_H, Math.min(maxH, dragRef.current.startH + dy)),
        });
      }

      function onUp() {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [customSize, getDefaultSize],
  );

  const { data: unseenNudges } = useGetElaineNudgesUnseenCount({
    query: {
      enabled: !open,
      refetchInterval: 2 * 60 * 1000,
      queryKey: getGetElaineNudgesUnseenCountQueryKey(),
    },
  });

  useEffect(() => {
    if (open)
      chat.endRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
  }, [messages, open, isStreaming, streamingContent, chat.endRef]);

  // Close the history panel whenever the widget itself closes, so reopening
  // always lands back on the active chat rather than the history list.
  useEffect(() => {
    if (!open) setShowHistory(false);
  }, [open]);

  const handleSelectConversation = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`/api/elaine/conversations/${id}/messages`);
        if (!res.ok) throw new Error("Failed to load conversation");
        const msgs = (await res.json()) as ConversationMessage[];
        chat.handleLoadConversation(id, msgs);
      } finally {
        setShowHistory(false);
      }
    },
    [chat],
  );

  const onFullScreenChat =
    fullScreenPath !== undefined && currentPath === fullScreenPath;

  if (!settings?.enabled || onFullScreenChat) {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        isolation: "isolate",
        pointerEvents: "none",
      }}
    >
      <div
        ref={containerRef}
        className="flex flex-col items-end gap-3"
        style={
          position
            ? {
                position: "absolute",
                top: `${position.y}px`,
                left: `${position.x}px`,
                pointerEvents: "auto",
              }
            : {
                position: "absolute",
                bottom: isDesktop ? "1.5rem" : "1rem",
                right: isDesktop ? "1.5rem" : "1rem",
                pointerEvents: "auto",
              }
        }
      >
        {open && (
          <div
            className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-2xl"
            style={{
              width: isDesktop ? `${currentSize.w}px` : "calc(100vw - 2rem)",
              height: isDesktop ? `${currentSize.h}px` : "calc(100svh - 5rem)",
              maxWidth: "calc(100vw - 2rem)",
              maxHeight: "calc(100svh - 5rem)",
              position: "relative",
            }}
          >
            {/* Resize handle — top-left corner (opposite of the bottom-right anchor).
                Dragging toward the top-left makes the widget larger; toward
                the bottom-right makes it smaller. Only shown on desktop. */}
            {isDesktop && (
              <div
                onMouseDown={onResizeStart}
                title="Drag to resize"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "20px",
                  height: "20px",
                  cursor: "nw-resize",
                  zIndex: 10,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "flex-start",
                  padding: "4px",
                }}
              >
                {/* Three-dot corner grip indicator */}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  style={{ opacity: 0.3 }}
                >
                  <circle cx="2" cy="2" r="1.2" fill="currentColor" />
                  <circle cx="2" cy="6" r="1.2" fill="currentColor" />
                  <circle cx="6" cy="2" r="1.2" fill="currentColor" />
                </svg>
              </div>
            )}

            <div
              className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-4 py-3"
              style={{ touchAction: "none", cursor: "grab" }}
              onPointerDown={onMovePointerDown}
              onPointerMove={onMovePointerMove}
              onPointerUp={onMovePointerUp}
              onPointerCancel={onMovePointerUp}
              title="Drag to move"
            >
              <div className="flex items-center gap-2.5">
                <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                <ElaineAvatar size={34} />
                <ElaineWordmark className="text-lg" />
              </div>
              <div className="flex items-center gap-1">
                {fullScreenPath && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Open full-screen chat"
                    onClick={() => {
                      window.location.href = fullScreenPath;
                    }}
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${showHistory ? "bg-muted" : ""}`}
                  title={showHistory ? "Back to chat" : "Conversation history"}
                  onClick={() => setShowHistory((v) => !v)}
                >
                  <History className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="New conversation"
                  onClick={() => {
                    chat.handleNewConversation();
                    setShowHistory(false);
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {showHistory ? (
              <ElaineHistoryPanel
                activeConversationId={chat.conversationId}
                onNewConversation={chat.handleNewConversation}
                onSelectConversation={handleSelectConversation}
                onClose={() => setShowHistory(false)}
              />
            ) : (
              <ElaineChatPanel chat={chat} onNavigated={() => setOpen(false)} />
            )}
          </div>
        )}

        {!open && (
          <button
            onClick={() => {
              if (justDraggedRef.current) {
                justDraggedRef.current = false;
                return;
              }
              setOpen(true);
            }}
            onPointerDown={onMovePointerDown}
            onPointerMove={onMovePointerMove}
            onPointerUp={onMovePointerUp}
            onPointerCancel={onMovePointerUp}
            style={{ touchAction: "none" }}
            className="relative flex items-center gap-2 rounded-full border border-card-border bg-card py-2 pl-2 pr-4 shadow-lg transition-transform hover:scale-105"
            aria-label={
              unseenNudges && unseenNudges.count > 0
                ? `Open Elaine assistant (${unseenNudges.count} new)`
                : "Open Elaine assistant"
            }
          >
            {unseenNudges && unseenNudges.count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold leading-none text-destructive-foreground">
                {unseenNudges.count > 9 ? "9+" : unseenNudges.count}
              </span>
            )}
            <ElaineAvatar size={36} />
            <span className="flex items-center gap-1 text-sm font-medium">
              <ElaineWordmark />
            </span>
            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
