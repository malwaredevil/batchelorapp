import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MessageSquare,
  X,
  ExternalLink,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@workspace/web-core/auth";
import { useMessengerUnreadCount } from "./useMessengerUnreadCount";
import { useMessengerNewMessageDetector } from "./useMessengerNewMessageDetector";
import {
  MessengerToastContainer,
  type MessengerToastItem,
} from "./MessengerToast";
import { MessengerChatPanel } from "./MessengerChatPanel";
import { MessengerConversationSidebar } from "./MessengerConversationSidebar";
import {
  useListConversations,
  getListConversationsQueryKey,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";
import type { MessengerConversationSummary } from "@workspace/api-client-react";

interface MessengerNavIconProps {
  messengerPageHref?: string;
  iconSize?: number;
  buttonClassName?: string;
}

const DEFAULT_W = 500;
const DEFAULT_H = 520;
const MIN_W = 320;
const MIN_H = 280;
/** Viewport width below which the panel collapses to single-column mobile layout. */
const MOBILE_BREAK = 560;
const CORNER_HIT = 20; // px — corner resize hit-target size

/** An active drag operation on the panel. */
type DragOp =
  | {
      kind: "move";
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
    }
  | {
      kind: "resize";
      corner: "tl" | "tr" | "bl" | "br";
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
      startW: number;
      startH: number;
    };

let toastIdCounter = 0;

export function MessengerNavIcon({
  messengerPageHref = "/modules/office/messenger",
  iconSize = 18,
  buttonClassName = "",
}: MessengerNavIconProps) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"list" | "chat">("list");
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<MessengerToastItem[]>([]);
  /** Desktop only — whether the left conversation list panel is visible. */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const unreadCount = useMessengerUnreadCount();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Panel position + size (left-anchored) ──────────────────────────────────
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const [panelSize, setPanelSize] = useState({
    width: DEFAULT_W,
    height: DEFAULT_H,
  });

  // The current op — shared by mouse and touch handlers via this ref.
  const dragOp = useRef<DragOp | null>(null);
  // True while any drag/resize is in progress — suppresses outside-click close.
  const isInteracting = useRef(false);

  const { data: conversations } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: isOpen ? 5_000 : 60_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });
  const firstActiveId = conversations?.find((c) => !c.archivedAt)?.id ?? null;
  const effectiveConvId = selectedConvId ?? firstActiveId;

  const currentConv = conversations?.find((c) => c.id === effectiveConvId);
  const convName = currentConv
    ? currentConv.isDirect
      ? (currentConv.participants?.find((p) => p.id !== currentUserId)
          ?.displayName ?? "Direct Message")
      : (currentConv.name ?? "Group Chat")
    : null;

  const isMobile = () => window.innerWidth < MOBILE_BREAK;

  // Position the panel when first opened.
  // Mobile: full-width, 50 % height, centered on screen.
  // Desktop: right-aligned below the trigger button.
  const calcInitialPosition = useCallback((w: number, h: number) => {
    if (isMobile()) {
      // Centered horizontally with auto margins matching the 92% width
      setPanelPos({
        left: Math.round((window.innerWidth - w) / 2),
        top: Math.round((window.innerHeight - h) / 2),
      });
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.right - w, window.innerWidth - w - 8),
    );
    setPanelPos({ top: rect.bottom + 6, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isOpen) {
      const mobile = isMobile();
      const w = mobile ? Math.round(window.innerWidth * 0.92) : DEFAULT_W;
      const h = mobile ? Math.round(window.innerHeight * 0.5) : DEFAULT_H;
      setPanelSize({ width: w, height: h });
      calcInitialPosition(w, h);
      setView("list");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Global move / up handlers (shared by mouse & touch) ───────────────────
  const handleMove = useCallback((cx: number, cy: number) => {
    const op = dragOp.current;
    if (!op) return;

    if (op.kind === "move") {
      const dx = cx - op.startX;
      const dy = cy - op.startY;
      setPanelPos((prev) => {
        const w = panelRef.current?.offsetWidth ?? DEFAULT_W;
        const h = panelRef.current?.offsetHeight ?? DEFAULT_H;
        return {
          left: Math.max(0, Math.min(window.innerWidth - w, op.startLeft + dx)),
          top: Math.max(0, Math.min(window.innerHeight - 48, op.startTop + dy)),
        };
      });
    } else {
      // resize
      const { corner, startX, startY, startLeft, startTop, startW, startH } =
        op;
      const dx = cx - startX;
      const dy = cy - startY;
      let newW = startW,
        newH = startH,
        newLeft = startLeft,
        newTop = startTop;

      // Horizontal
      if (corner === "tr" || corner === "br") {
        newW = Math.max(MIN_W, startW + dx);
      } else {
        // tl, bl
        newW = Math.max(MIN_W, startW - dx);
        newLeft = startLeft + startW - newW;
      }
      // Vertical
      if (corner === "bl" || corner === "br") {
        newH = Math.max(MIN_H, startH + dy);
      } else {
        // tl, tr
        newH = Math.max(MIN_H, startH - dy);
        newTop = startTop + startH - newH;
      }

      // Clamp to viewport
      newLeft = Math.max(0, Math.min(window.innerWidth - MIN_W, newLeft));
      newTop = Math.max(0, Math.min(window.innerHeight - 48, newTop));
      newW = Math.min(newW, window.innerWidth - newLeft);
      newH = Math.min(newH, window.innerHeight - newTop);

      setPanelPos({ left: newLeft, top: newTop });
      setPanelSize({ width: newW, height: newH });
    }
  }, []);

  const handleUp = useCallback(() => {
    dragOp.current = null;
    // Short delay before clearing isInteracting so the outside-click listener
    // that fires on the same mouseup doesn't immediately close the panel.
    setTimeout(() => {
      isInteracting.current = false;
    }, 50);
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (!dragOp.current) return;
      e.preventDefault();
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [handleMove, handleUp]);

  // ── Header drag ────────────────────────────────────────────────────────────
  const startMove = useCallback(
    (cx: number, cy: number) => {
      isInteracting.current = true;
      dragOp.current = {
        kind: "move",
        startX: cx,
        startY: cy,
        startLeft: panelPos.left,
        startTop: panelPos.top,
      };
    },
    [panelPos],
  );

  const onHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only drag from the header background — let child buttons handle their own events
      if ((e.target as HTMLElement).closest("button,a")) return;
      e.preventDefault();
      startMove(e.clientX, e.clientY);
    },
    [startMove],
  );

  const onHeaderTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((e.target as HTMLElement).closest("button,a")) return;
      startMove(e.touches[0].clientX, e.touches[0].clientY);
    },
    [startMove],
  );

  // ── Corner resize ──────────────────────────────────────────────────────────
  const startResize = useCallback(
    (corner: "tl" | "tr" | "bl" | "br", cx: number, cy: number) => {
      isInteracting.current = true;
      dragOp.current = {
        kind: "resize",
        corner,
        startX: cx,
        startY: cy,
        startLeft: panelPos.left,
        startTop: panelPos.top,
        startW: panelSize.width,
        startH: panelSize.height,
      };
    },
    [panelPos, panelSize],
  );

  const onCornerMouseDown = useCallback(
    (corner: "tl" | "tr" | "bl" | "br") => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startResize(corner, e.clientX, e.clientY);
    },
    [startResize],
  );

  const onCornerTouchStart = useCallback(
    (corner: "tl" | "tr" | "bl" | "br") => (e: React.TouchEvent) => {
      e.stopPropagation();
      startResize(corner, e.touches[0].clientX, e.touches[0].clientY);
    },
    [startResize],
  );

  // ── Outside-click close ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (isInteracting.current) return;
      const target = e.target as Node;
      if (!document.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen]);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  useMessengerNewMessageDetector({
    currentUserId,
    enabled: !isOpen && currentUserId > 0,
    onNewMessage: useCallback((event) => {
      if (!event.body) return;
      const id = `toast-${++toastIdCounter}`;
      setToasts((prev) =>
        [
          ...prev,
          {
            id,
            convId: event.convId,
            convName: event.convName,
            senderName: event.senderName,
            body: event.body,
          },
        ].slice(-3),
      );
    }, []),
  });

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleSelectConv = useCallback((id: number) => {
    setSelectedConvId(id);
    setView("chat");
  }, []);

  // ── Corner handle style helper ─────────────────────────────────────────────
  const cornerStyle = (
    corner: "tl" | "tr" | "bl" | "br",
  ): React.CSSProperties => {
    const cursorMap = {
      tl: "nw-resize",
      tr: "ne-resize",
      bl: "sw-resize",
      br: "se-resize",
    } as const;
    return {
      position: "absolute",
      width: CORNER_HIT,
      height: CORNER_HIT,
      cursor: cursorMap[corner],
      zIndex: 10,
      // Position in each corner
      ...(corner.startsWith("t") ? { top: 0 } : { bottom: 0 }),
      ...(corner.endsWith("l") ? { left: 0 } : { right: 0 }),
      // Subtle visual triangle indicator
      background: "transparent",
      // Override for visibility: a thin L-shaped indicator along the corner edges
    };
  };

  // ── Panel ──────────────────────────────────────────────────────────────────
  const currentIsMobile = window.innerWidth < MOBILE_BREAK;

  const panel = isOpen
    ? createPortal(
        <>
          {/* Dim backdrop on mobile — tap anywhere outside to close */}
          {currentIsMobile && (
            <div
              onClick={() => setIsOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.45)",
                zIndex: 9997,
              }}
            />
          )}
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: panelPos.top,
              left: panelPos.left,
              width: panelSize.width,
              height: panelSize.height,
              zIndex: 9998,
              boxShadow:
                "0 20px 60px -12px rgba(0,0,0,0.25), 0 8px 24px -6px rgba(0,0,0,0.1)",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid rgba(59,130,246,0.2)",
              display: "flex",
              flexDirection: "column",
              background: "hsl(var(--card))",
              // Prevent text selection while dragging/resizing
              userSelect: dragOp.current ? "none" : "auto",
            }}
          >
            {/* ── Corner resize handles ── */}
            {(["tl", "tr", "bl", "br"] as const).map((c) => (
              <div
                key={c}
                style={cornerStyle(c)}
                onMouseDown={onCornerMouseDown(c)}
                onTouchStart={onCornerTouchStart(c)}
              >
                {/* Visual L-shaped tick at each corner */}
                <svg
                  width={CORNER_HIT}
                  height={CORNER_HIT}
                  style={{ display: "block", opacity: 0.35 }}
                >
                  {c === "br" && (
                    <>
                      <line
                        x1={CORNER_HIT - 3}
                        y1={4}
                        x2={CORNER_HIT - 3}
                        y2={CORNER_HIT - 3}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1={4}
                        y1={CORNER_HIT - 3}
                        x2={CORNER_HIT - 3}
                        y2={CORNER_HIT - 3}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                  {c === "bl" && (
                    <>
                      <line
                        x1={3}
                        y1={4}
                        x2={3}
                        y2={CORNER_HIT - 3}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1={3}
                        y1={CORNER_HIT - 3}
                        x2={CORNER_HIT - 4}
                        y2={CORNER_HIT - 3}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                  {c === "tr" && (
                    <>
                      <line
                        x1={CORNER_HIT - 3}
                        y1={3}
                        x2={CORNER_HIT - 3}
                        y2={CORNER_HIT - 4}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1={4}
                        y1={3}
                        x2={CORNER_HIT - 3}
                        y2={3}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                  {c === "tl" && (
                    <>
                      <line
                        x1={3}
                        y1={3}
                        x2={3}
                        y2={CORNER_HIT - 4}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <line
                        x1={3}
                        y1={3}
                        x2={CORNER_HIT - 4}
                        y2={3}
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </svg>
              </div>
            ))}

            {/* ── Draggable title bar ── */}
            <div
              onMouseDown={onHeaderMouseDown}
              onTouchStart={onHeaderTouchStart}
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid hsl(var(--border))",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                color: "#fff",
                flexShrink: 0,
                gap: 8,
                cursor: "grab",
                // Remove text cursor on double-click of the title bar
                userSelect: "none",
              }}
            >
              {/* Left: title / back button */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  pointerEvents: "none", // let drag fall through to the header div
                }}
              >
                {currentIsMobile && view === "chat" ? (
                  <>
                    <div
                      style={{ pointerEvents: "auto" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setView("list");
                      }}
                    >
                      <button
                        aria-label="Back to conversations"
                        style={{
                          background: "rgba(255,255,255,0.15)",
                          border: "none",
                          borderRadius: 6,
                          cursor: "pointer",
                          color: "#fff",
                          padding: "3px 6px 3px 4px",
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        <ChevronLeft size={16} />
                        <span>Chats</span>
                      </button>
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {convName ?? "Messenger"}
                    </span>
                  </>
                ) : (
                  <>
                    <MessageSquare size={16} style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 15 }}>
                      {currentIsMobile ? "Chats" : "Messenger"}
                    </span>
                    {!currentIsMobile && convName && (
                      <span
                        style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.7)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        · {convName}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Right: actions */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                  pointerEvents: "auto",
                }}
              >
                {/* Sidebar toggle — desktop only */}
                {!currentIsMobile && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSidebarOpen((v) => !v);
                    }}
                    aria-label={
                      sidebarOpen
                        ? "Hide conversation list"
                        : "Show conversation list"
                    }
                    title={sidebarOpen ? "Hide chats" : "Show chats"}
                    style={{
                      background: sidebarOpen
                        ? "rgba(255,255,255,0.18)"
                        : "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: 6,
                      cursor: "pointer",
                      color: "#fff",
                      padding: "3px 6px",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      transition: "background 0.15s",
                    }}
                  >
                    {sidebarOpen ? (
                      <PanelLeftClose size={14} />
                    ) : (
                      <PanelLeftOpen size={14} />
                    )}
                    <span>{sidebarOpen ? "Hide chats" : "Chats"}</span>
                  </button>
                )}
                {messengerPageHref && (
                  <a
                    href={messengerPageHref}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsOpen(false);
                    }}
                    aria-label="Open full messenger"
                    title="Open full messenger"
                    style={{
                      color: "rgba(255,255,255,0.8)",
                      display: "flex",
                      padding: 4,
                      borderRadius: 6,
                      textDecoration: "none",
                    }}
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(false);
                  }}
                  aria-label="Close messenger"
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    border: "none",
                    cursor: "pointer",
                    color: "#fff",
                    // Larger tap target on mobile
                    padding: currentIsMobile ? "8px 10px" : 4,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: currentIsMobile ? 44 : undefined,
                    minHeight: currentIsMobile ? 36 : undefined,
                  }}
                >
                  <X size={currentIsMobile ? 20 : 18} />
                </button>
              </div>
            </div>

            {/* ── Body ── */}
            {currentIsMobile ? (
              view === "list" ? (
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <MessengerConversationSidebar
                    selectedConvId={effectiveConvId}
                    onSelect={handleSelectConv}
                  />
                </div>
              ) : (
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <MessengerChatPanel
                    currentUserId={currentUserId}
                    isOpen={isOpen && view === "chat"}
                    conversationId={effectiveConvId ?? undefined}
                    showParticipants={false}
                  />
                </div>
              )
            ) : (
              <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
                {sidebarOpen && (
                  <MessengerConversationSidebar
                    selectedConvId={effectiveConvId}
                    onSelect={setSelectedConvId}
                  />
                )}
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <MessengerChatPanel
                    currentUserId={currentUserId}
                    isOpen={isOpen}
                    conversationId={effectiveConvId ?? undefined}
                    showParticipants={false}
                  />
                </div>
              </div>
            )}
          </div>
        </>,
        document.body,
      )
    : null;

  // ── Nav icon button ────────────────────────────────────────────────────────
  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `Messenger — ${unreadCount} unread`
            : "Open Messenger"
        }
        className={buttonClassName}
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 6,
          padding: 0,
        }}
      >
        <MessageSquare size={iconSize} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: "#ef4444",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
              border: "2px solid hsl(var(--background))",
              lineHeight: 1,
              pointerEvents: "none",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {panel}
      {createPortal(
        <MessengerToastContainer
          toasts={toasts}
          onDismiss={dismissToast}
          messengerHref={messengerPageHref}
        />,
        document.body,
      )}
    </>
  );
}
