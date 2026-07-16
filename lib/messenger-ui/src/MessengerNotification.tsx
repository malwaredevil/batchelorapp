import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, MessageSquare, Send, ChevronUp, Bell } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";
import {
  useGetUnreadCount,
  getGetUnreadCountQueryKey,
  useListConversations,
  getListConversationsQueryKey,
  useGetConversationMessages,
  getGetConversationMessagesQueryKey,
  useSendMessage,
  type MessengerConversationSummary,
  type MessengerMessengerMessage,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/web-core/auth";

// ─── Notification sound via Web Audio API ────────────────────────────────────
function playNotificationSound(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const playTone = (
      freq: number,
      start: number,
      duration: number,
      vol = 0.22,
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.start(start);
      osc.stop(start + duration);
    };
    const t = ctx.currentTime;
    playTone(880, t, 0.18);
    playTone(1108, t + 0.14, 0.24);
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    // AudioContext not available
  }
}

// ─── Document title badge helpers ────────────────────────────────────────────
// Strips any existing "(N) " prefix so we always work with the clean base title.
function stripBadge(title: string): string {
  return title.replace(/^\(\d+\)\s/, "");
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = `
    @keyframes mnf-slide-in {
      from { transform: translateY(16px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .mnf-enter { animation: mnf-slide-in 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards; }
  `;
  document.head.appendChild(el);
  styleInjected = true;
}

interface ActiveNotification {
  convId: number;
  message: MessengerMessengerMessage;
}

const AUTO_DISMISS_MS = 8_000;

// ─── Push permission banner ───────────────────────────────────────────────
function PushPermissionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("PushManager" in window) ||
      !("serviceWorker" in navigator)
    )
      return;
    if ((Notification as typeof Notification).permission !== "default") return;
    // Show after a short delay so it doesn't appear on every page load
    const t = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  async function handleEnable() {
    setVisible(false);
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      window.dispatchEvent(new CustomEvent("batchelor:push-permitted"));
    }
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9996,
        background: "var(--background, #fff)",
        border: "1px solid rgba(0,0,0,0.09)",
        borderRadius: 12,
        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "inherit",
        maxWidth: 300,
      }}
    >
      <Bell size={15} style={{ color: "#3b82f6", flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: "var(--foreground, #111)", flex: 1 }}>
        Get notified when messages arrive
      </span>
      <button
        onClick={handleEnable}
        style={{
          background: "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 7,
          padding: "5px 10px",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Enable
      </button>
      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 2,
          color: "rgba(0,0,0,0.35)",
          display: "flex",
          lineHeight: 0,
        }}
      >
        <X size={13} />
      </button>
    </div>,
    document.body,
  );
}

export function MessengerNotification() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [notification, setNotification] = useState<ActiveNotification | null>(
    null,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const prevCountRef = useRef(-1);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExpandedRef = useRef(false);

  useEffect(() => {
    injectStyle();
  }, []);

  const { data: unreadData } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 10_000 },
  });
  const unreadCount = unreadData?.count ?? 0;

  // ── PWA home-screen badge ────────────────────────────────────────────────
  useEffect(() => {
    try {
      if (unreadCount > 0) {
        if ("setAppBadge" in navigator) {
          (
            navigator as Navigator & { setAppBadge: (n: number) => void }
          ).setAppBadge(unreadCount);
        }
      } else {
        if ("clearAppBadge" in navigator) {
          (
            navigator as Navigator & { clearAppBadge: () => void }
          ).clearAppBadge();
        }
      }
    } catch {
      // not supported
    }
  }, [unreadCount]);

  // ── Browser tab title badge ──────────────────────────────────────────────
  // Prefixes document.title with "(N) " while unread > 0 so the user sees
  // the count in the tab when they switch away. Restores the clean title
  // when the count drops to zero or the tab is focused.
  useEffect(() => {
    const base = stripBadge(document.title);
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) ${base}`;
    } else {
      document.title = base;
    }
  }, [unreadCount]);

  // Restore clean title when tab regains focus (in case the user returns
  // before the next unreadCount poll brings the count to 0).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        document.title = stripBadge(document.title);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const { data: conversations } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: 15_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });
  const convId = conversations?.[0]?.id ?? null;

  const { data: messages = [] } = useGetConversationMessages(
    convId ?? 0,
    {},
    {
      query: {
        queryKey: getGetConversationMessagesQueryKey(convId ?? 0),
        enabled: !!convId,
        refetchInterval: 10_000,
      } as UseQueryOptions<MessengerMessengerMessage[]>,
    },
  );

  const { mutateAsync: sendMessageMutation } = useSendMessage();

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setNotification(null);
    setIsExpanded(false);
    isExpandedRef.current = false;
    setReplyText("");
  }, []);

  const expand = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setIsExpanded(true);
    isExpandedRef.current = true;
  }, []);

  useEffect(() => {
    if (prevCountRef.current === -1) {
      prevCountRef.current = unreadCount;
      return;
    }
    const prev = prevCountRef.current;
    prevCountRef.current = unreadCount;

    if (unreadCount <= prev) return;

    // Play a notification sound when a new message arrives.
    playNotificationSound();

    const currentUserId = user?.id ?? 0;
    const unread = (messages as MessengerMessengerMessage[])
      .filter(
        (m) =>
          !m.readAt &&
          !m.deletedAt &&
          m.senderId !== null &&
          m.senderId !== currentUserId,
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    if (!unread.length || !convId) return;

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);

    setNotification({ convId, message: unread[0] });
    setIsExpanded(false);
    isExpandedRef.current = false;
    setReplyText("");

    if (!isExpandedRef.current) {
      dismissTimerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    }
  }, [unreadCount]);

  const sendReply = useCallback(async () => {
    if (!notification || !replyText.trim() || isSending) return;
    setIsSending(true);
    try {
      await sendMessageMutation({
        id: notification.convId,
        data: { body: replyText.trim(), attachments: [] },
      });
      qc.invalidateQueries({
        queryKey: getGetConversationMessagesQueryKey(notification.convId),
      });
      qc.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      dismiss();
    } finally {
      setIsSending(false);
    }
  }, [notification, replyText, isSending, sendMessageMutation, qc, dismiss]);

  if (!notification) return <PushPermissionBanner />;

  const senderName = notification.message.senderName ?? "Someone";
  const body = notification.message.body;
  const preview = body.length > 80 ? body.slice(0, 80) + "…" : body;

  return createPortal(
    <div
      className="mnf-enter"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: isExpanded ? 340 : 310,
        zIndex: 9997,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 12px 40px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)",
        border: "1px solid rgba(0,0,0,0.07)",
        background: "var(--background, #fff)",
        transition: "width 0.18s ease",
        fontFamily: "inherit",
      }}
    >
      {/* Header */}
      <div
        onClick={!isExpanded ? expand : undefined}
        style={{
          padding: "10px 12px 9px",
          background: "linear-gradient(135deg, #3b82f6, #2563eb)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: isExpanded ? "default" : "pointer",
          userSelect: "none",
        }}
      >
        <MessageSquare size={14} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, lineHeight: "1.25" }}>
            {senderName} sent you a message
          </div>
          {!isExpanded && (
            <div
              style={{
                fontSize: 11,
                opacity: 0.82,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {preview}
            </div>
          )}
        </div>
        {!isExpanded && (
          <ChevronUp size={14} style={{ flexShrink: 0, opacity: 0.75 }} />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          aria-label="Dismiss"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgba(255,255,255,0.8)",
            padding: "2px",
            display: "flex",
            flexShrink: 0,
            borderRadius: 4,
            lineHeight: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div
          style={{
            padding: "12px 14px 14px",
            background: "var(--background, #fff)",
          }}
        >
          <div
            style={{
              background: "rgba(59,130,246,0.07)",
              borderLeft: "3px solid #3b82f6",
              borderRadius: "0 8px 8px 0",
              padding: "8px 12px",
              fontSize: 13,
              lineHeight: "1.5",
              color: "var(--foreground, #111)",
              marginBottom: 10,
              wordBreak: "break-word",
            }}
          >
            {body}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <textarea
              autoFocus
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Quick reply…"
              rows={2}
              style={{
                flex: 1,
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 13,
                resize: "none",
                outline: "none",
                fontFamily: "inherit",
                background: "var(--background, #fff)",
                color: "var(--foreground, #111)",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendReply();
                }
              }}
            />
            <button
              onClick={sendReply}
              disabled={isSending || !replyText.trim()}
              aria-label="Send reply"
              style={{
                background: "#3b82f6",
                border: "none",
                borderRadius: 8,
                cursor: isSending || !replyText.trim() ? "default" : "pointer",
                color: "#fff",
                padding: "9px 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: isSending || !replyText.trim() ? 0.45 : 1,
                transition: "opacity 0.15s",
                height: 52,
                flexShrink: 0,
              }}
            >
              <Send size={16} />
            </button>
          </div>

          <div style={{ marginTop: 8, textAlign: "center" }}>
            <a
              href="/modules/office/messenger"
              style={{
                fontSize: 11,
                color: "#3b82f6",
                textDecoration: "none",
                opacity: 0.75,
              }}
            >
              Open full Messenger →
            </a>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
