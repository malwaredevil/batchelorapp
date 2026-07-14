import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X, ExternalLink } from "lucide-react";
import { useAuth } from "@workspace/web-core/auth";
import { useMessengerUnreadCount } from "./useMessengerUnreadCount";
import { MessengerChatPanel } from "./MessengerChatPanel";

interface MessengerWidgetProps {
  messengerPageHref?: string;
}

const PANEL_W = 380;
const PANEL_H = 500;
const BUBBLE_SIZE = 52;
const EDGE_PAD = 20;

export function MessengerWidget({ messengerPageHref }: MessengerWidgetProps) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = useMessengerUnreadCount();

  // Position state (bubble anchor point, bottom-left by default)
  const [pos, setPos] = useState({ x: EDGE_PAD, y: EDGE_PAD });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const bubbleRef = useRef<HTMLButtonElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (isOpen) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [isOpen, pos]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newX = Math.max(0, Math.min(window.innerWidth - BUBBLE_SIZE, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - BUBBLE_SIZE, e.clientY - dragOffset.current.y));
      setPos({ x: newX, y: newY });
    };
    const onMouseUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Compute panel position from bubble position
  const bubbleBottom = window.innerHeight - pos.y - BUBBLE_SIZE;
  const bubbleRight = window.innerWidth - pos.x - BUBBLE_SIZE;

  let panelLeft = pos.x;
  let panelBottom = pos.y + BUBBLE_SIZE + 8;

  // Clamp panel within viewport
  if (panelLeft + PANEL_W > window.innerWidth - EDGE_PAD) {
    panelLeft = window.innerWidth - PANEL_W - EDGE_PAD;
  }
  if (panelBottom + PANEL_H > window.innerHeight - EDGE_PAD) {
    panelBottom = window.innerHeight - panelBottom - PANEL_H;
    // flip above bubble
    panelBottom = pos.y - PANEL_H - 8;
    if (panelBottom < EDGE_PAD) panelBottom = EDGE_PAD;
  }

  const panel = isOpen ? (
    <div
      style={{
        position: "fixed",
        left: Math.max(EDGE_PAD, panelLeft),
        bottom: bubbleBottom + BUBBLE_SIZE + 8,
        width: PANEL_W,
        height: PANEL_H,
        zIndex: 9998,
        boxShadow: "0 20px 60px -12px rgba(0,0,0,0.25), 0 8px 24px -6px rgba(0,0,0,0.1)",
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid rgba(59,130,246,0.15)",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare size={18} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Messenger</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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

      {/* Chat body */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <MessengerChatPanel currentUserId={currentUserId} isOpen={isOpen} />
      </div>
    </div>
  ) : null;

  const bubble = (
    <button
      ref={bubbleRef}
      onMouseDown={onMouseDown}
      onClick={() => !dragging.current && setIsOpen((v) => !v)}
      aria-label={isOpen ? "Close messenger" : "Open messenger"}
      style={{
        position: "fixed",
        left: pos.x,
        bottom: bubbleBottom,
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
        boxShadow: "0 8px 24px rgba(59,130,246,0.45), 0 2px 8px rgba(0,0,0,0.15)",
        transition: "box-shadow 0.2s, transform 0.15s",
        userSelect: "none",
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
            border: "2px solid #fff",
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
