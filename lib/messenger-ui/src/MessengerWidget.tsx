import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X, ExternalLink, ChevronLeft } from "lucide-react";
import { useAuth } from "@workspace/web-core/auth";
import { useMessengerUnreadCount } from "./useMessengerUnreadCount";
import { MessengerChatPanel } from "./MessengerChatPanel";
import { MessengerConversationSidebar } from "./MessengerConversationSidebar";
import {
  useListConversations,
  getListConversationsQueryKey,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";
import type { MessengerConversationSummary } from "@workspace/api-client-react";

interface MessengerWidgetProps {
  messengerPageHref?: string;
}

const PANEL_W = 560;
const PANEL_H = 500;
const BUBBLE_SIZE = 52;
const EDGE_PAD = 12;
/** Viewport width below which the widget goes into single-column mobile mode */
const MOBILE_BREAK = 600;

export function MessengerWidget({ messengerPageHref }: MessengerWidgetProps) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;
  const [isOpen, setIsOpen] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  /**
   * On mobile, we show either the conversation list ("list") or the active
   * chat ("chat"). On desktop both are visible side-by-side.
   */
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const unreadCount = useMessengerUnreadCount();

  const { data: conversations } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: isOpen ? 5_000 : 60_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });
  const firstActiveId = conversations?.find((c) => !c.archivedAt)?.id ?? null;
  const effectiveConvId = selectedConvId ?? firstActiveId;

  /** Display name of the currently selected conversation */
  const currentConv = conversations?.find((c) => c.id === effectiveConvId);
  const convName = currentConv
    ? currentConv.isDirect
      ? (currentConv.participants?.find((p) => p.id !== currentUserId)
          ?.displayName ?? "Direct Message")
      : (currentConv.name ?? "Group Chat")
    : null;

  // ── Draggable bubble position ──────────────────────────────────────────────
  // pos tracks the bubble's top-left corner in viewport-space (clientX, clientY).
  // Default: bottom-right corner of the screen.
  const [pos, setPos] = useState(() => ({
    x: window.innerWidth - BUBBLE_SIZE - EDGE_PAD,
    y: window.innerHeight - BUBBLE_SIZE - EDGE_PAD,
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  /** True if the pointer moved while held down — suppresses the click handler */
  const didDrag = useRef(false);
  const bubbleRef = useRef<HTMLButtonElement>(null);

  const clampPos = (x: number, y: number) => ({
    x: Math.max(0, Math.min(window.innerWidth - BUBBLE_SIZE, x)),
    y: Math.max(0, Math.min(window.innerHeight - BUBBLE_SIZE, y)),
  });

  // Mouse drag
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isOpen) return;
      dragging.current = true;
      didDrag.current = false;
      dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      e.preventDefault();
    },
    [isOpen, pos],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      didDrag.current = true;
      setPos(
        clampPos(
          e.clientX - dragOffset.current.x,
          e.clientY - dragOffset.current.y,
        ),
      );
    };
    const onMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Touch drag
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isOpen) return;
      const t = e.touches[0];
      dragging.current = true;
      didDrag.current = false;
      dragOffset.current = { x: t.clientX - pos.x, y: t.clientY - pos.y };
      // Don't call preventDefault here — that would block the click fallback
    },
    [isOpen, pos],
  );

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      didDrag.current = true;
      const t = e.touches[0];
      setPos(
        clampPos(
          t.clientX - dragOffset.current.x,
          t.clientY - dragOffset.current.y,
        ),
      );
      e.preventDefault(); // block page scroll while dragging the bubble
    };
    const onTouchEnd = () => {
      dragging.current = false;
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // ── Panel layout ───────────────────────────────────────────────────────────
  const isMobile = window.innerWidth < MOBILE_BREAK;
  const panelW = isMobile ? window.innerWidth - 16 : PANEL_W;
  const panelH = isMobile
    ? Math.min(PANEL_H, window.innerHeight - 80)
    : PANEL_H;

  // Horizontal: clamp so panel stays inside viewport
  const panelLeft = isMobile
    ? 8
    : Math.max(
        EDGE_PAD,
        Math.min(pos.x, window.innerWidth - panelW - EDGE_PAD),
      );

  // Vertical: open above bubble if not enough space below, otherwise below
  const spaceBelow = window.innerHeight - pos.y - BUBBLE_SIZE - 8;
  const panelTop =
    spaceBelow >= panelH + EDGE_PAD
      ? pos.y + BUBBLE_SIZE + 8
      : Math.max(EDGE_PAD, pos.y - panelH - 8);

  // ── Conversation selection ─────────────────────────────────────────────────
  const handleSelectConv = useCallback((id: number) => {
    setSelectedConvId(id);
    setMobileView("chat");
  }, []);

  // When the widget is opened for the first time and a conversation exists,
  // go straight to chat view on mobile (skip the list).
  useEffect(() => {
    if (
      isOpen &&
      isMobile &&
      effectiveConvId !== null &&
      mobileView === "list"
    ) {
      setMobileView("chat");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Panel ──────────────────────────────────────────────────────────────────
  const panel = isOpen ? (
    <div
      style={{
        position: "fixed",
        left: panelLeft,
        top: panelTop,
        width: panelW,
        height: panelH,
        zIndex: 9998,
        boxShadow:
          "0 20px 60px -12px rgba(0,0,0,0.25), 0 8px 24px -6px rgba(0,0,0,0.1)",
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid rgba(59,130,246,0.15)",
        display: "flex",
        flexDirection: "column",
        background: "hsl(var(--card))",
      }}
    >
      {/* ── Header ── */}
      <div
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
        }}
      >
        {/* Left side */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
          }}
        >
          {isMobile && mobileView === "chat" ? (
            // Mobile chat view → show back-to-list button + conversation name
            <>
              <button
                onClick={() => setMobileView("list")}
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
                  flexShrink: 0,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <ChevronLeft size={16} />
                <span>Chats</span>
              </button>
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
            // Desktop OR mobile list view → icon + title
            <>
              <MessageSquare size={16} style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {isMobile ? "Chats" : "Messenger"}
              </span>
              {/* Desktop: show current chat name as a subtle subtitle */}
              {!isMobile && convName && (
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

        {/* Right side */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {messengerPageHref && (
            <a
              href={messengerPageHref}
              aria-label="Open full messenger"
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
            onClick={() => setIsOpen(false)}
            aria-label="Close messenger"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.8)",
              padding: 4,
              borderRadius: 6,
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      {isMobile ? (
        // Mobile: one panel at a time
        mobileView === "list" ? (
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
              isOpen={isOpen}
              conversationId={effectiveConvId ?? undefined}
              showParticipants={true}
            />
          </div>
        )
      ) : (
        // Desktop: sidebar + chat side-by-side
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          <MessengerConversationSidebar
            selectedConvId={effectiveConvId}
            onSelect={setSelectedConvId}
          />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <MessengerChatPanel
              currentUserId={currentUserId}
              isOpen={isOpen}
              conversationId={effectiveConvId ?? undefined}
              showParticipants={true}
            />
          </div>
        </div>
      )}
    </div>
  ) : null;

  // ── Bubble ─────────────────────────────────────────────────────────────────
  const bubble = (
    <button
      ref={bubbleRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onClick={() => {
        if (didDrag.current) {
          didDrag.current = false;
          return;
        }
        setIsOpen((v) => !v);
      }}
      aria-label={isOpen ? "Close messenger" : "Open messenger"}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: BUBBLE_SIZE,
        height: BUBBLE_SIZE,
        zIndex: 9999,
        borderRadius: "50%",
        border: "none",
        cursor: "grab",
        background: isOpen
          ? "linear-gradient(135deg, #1d4ed8, #1e40af)"
          : "linear-gradient(135deg, #3b82f6, #2563eb)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow:
          "0 8px 24px rgba(59,130,246,0.45), 0 2px 8px rgba(0,0,0,0.15)",
        transition: "box-shadow 0.2s, transform 0.15s",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {isOpen ? <X size={22} /> : <MessageSquare size={22} />}
      {!isOpen && unreadCount > 0 && (
        <span
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: "#ef4444",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 4px",
            border: "2px solid hsl(var(--background))",
            lineHeight: 1,
          }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );

  return createPortal(
    <>
      {bubble}
      {panel}
    </>,
    document.body,
  );
}
