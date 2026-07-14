import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X, ExternalLink, Users } from "lucide-react";
import { useAuth } from "@workspace/web-core/auth";
import { useMessengerUnreadCount } from "./useMessengerUnreadCount";
import { useMessengerNewMessageDetector } from "./useMessengerNewMessageDetector";
import {
  MessengerToastContainer,
  type MessengerToastItem,
} from "./MessengerToast";
import { MessengerChatPanel } from "./MessengerChatPanel";
import { MessengerContactsPanel } from "./MessengerContactsPanel";

interface MessengerNavIconProps {
  messengerPageHref?: string;
  iconSize?: number;
  buttonClassName?: string;
}

const PANEL_W = 380;
const PANEL_H = 500;
let toastIdCounter = 0;

export function MessengerNavIcon({
  messengerPageHref = "/modules/office/messenger",
  iconSize = 18,
  buttonClassName = "",
}: MessengerNavIconProps) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<"chat" | "contacts">("chat");
  const [pendingPrefill, setPendingPrefill] = useState("");
  const [toasts, setToasts] = useState<MessengerToastItem[]>([]);
  const unreadCount = useMessengerUnreadCount();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  const calcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    const top = rect.bottom + 6;
    setPanelPos({ top, right });
  }, []);

  useEffect(() => {
    if (isOpen) {
      calcPosition();
      setView("chat");
    }
  }, [isOpen, calcPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!document.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen]);

  // New message notifications — only fire when the panel is NOT open
  useMessengerNewMessageDetector({
    currentUserId,
    enabled: !isOpen && currentUserId > 0,
    onNewMessage: useCallback(
      (event) => {
        if (!event.body) return;
        const id = `toast-${++toastIdCounter}`;
        setToasts((prev) =>
          [...prev, { id, convId: event.convId, convName: event.convName, senderName: event.senderName, body: event.body }].slice(-3),
        );
      },
      [],
    ),
  });

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleContactSelect = useCallback((prefill: string) => {
    setPendingPrefill(prefill);
    setView("chat");
  }, []);

  const panel = isOpen
    ? createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: panelPos.top,
            right: panelPos.right,
            width: PANEL_W,
            height: PANEL_H,
            zIndex: 9998,
            boxShadow:
              "0 20px 60px -12px rgba(0,0,0,0.25), 0 8px 24px -6px rgba(0,0,0,0.1)",
            borderRadius: 16,
            overflow: "hidden",
            border: "1px solid rgba(59,130,246,0.15)",
            display: "flex",
            flexDirection: "column",
            background: "var(--background, #fff)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 14px 10px",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
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
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {view === "contacts" ? "Contacts" : "Messenger"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                onClick={() => setView((v) => (v === "contacts" ? "chat" : "contacts"))}
                aria-label={view === "contacts" ? "Back to chat" : "View contacts"}
                title={view === "contacts" ? "Back to chat" : "Contacts"}
                style={{
                  background: view === "contacts" ? "rgba(255,255,255,0.25)" : "none",
                  border: "none",
                  cursor: "pointer",
                  color: "rgba(255,255,255,0.9)",
                  padding: 4,
                  borderRadius: 6,
                  display: "flex",
                }}
              >
                <Users size={15} />
              </button>

              {messengerPageHref && (
                <a
                  href={messengerPageHref}
                  onClick={() => setIsOpen(false)}
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

          {/* Body */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {view === "contacts" ? (
              <MessengerContactsPanel onSelect={handleContactSelect} />
            ) : (
              <MessengerChatPanel
                currentUserId={currentUserId}
                isOpen={isOpen && view === "chat"}
                prefillInput={pendingPrefill}
                onPrefillApplied={() => setPendingPrefill("")}
              />
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

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
              border: "2px solid var(--background, #fff)",
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
