import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Bell, X, Check, CheckCheck, ChevronRight } from "lucide-react";
import {
  useGetCounts,
  getGetCountsQueryKey,
  useList,
  getListQueryKey,
  useBulkUpdateState,
  useUpdateState,
  type NotificationsNotificationItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";

const SEVERITY_DOT: Record<string, string> = {
  critical: "#ef4444",
  important: "#f97316",
  attention: "#eab308",
  informational: "#3b82f6",
};

function SeverityDot({ severity }: { severity: string }) {
  const color = SEVERITY_DOT[severity] ?? "#6b7280";
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        marginTop: 4,
      }}
    />
  );
}

function NotificationRow({
  item,
  onMarkRead,
}: {
  item: NotificationsNotificationItem;
  onMarkRead: (id: number) => void;
}) {
  const ago = formatDistanceToNow(new Date(item.occurredAt), {
    addSuffix: true,
  });
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid hsl(var(--border))",
        background: item.isRead ? "transparent" : "hsl(var(--accent) / 0.25)",
        cursor: item.actionUrl ? "pointer" : "default",
        transition: "background 0.15s",
      }}
      onClick={() => {
        if (!item.isRead) onMarkRead(item.recipientId);
        if (item.actionUrl) window.location.href = item.actionUrl;
      }}
    >
      <SeverityDot severity={item.severity} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: item.isRead ? 400 : 600,
            lineHeight: 1.4,
            color: "hsl(var(--foreground))",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
            marginTop: 2,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.summary}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "hsl(var(--muted-foreground) / 0.7)",
            marginTop: 4,
          }}
        >
          {ago}
          {item.actionLabel && (
            <span
              style={{
                marginLeft: 8,
                color: "hsl(var(--primary))",
                fontWeight: 500,
              }}
            >
              {item.actionLabel} →
            </span>
          )}
        </div>
      </div>
      {!item.isRead && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(item.recipientId);
          }}
          aria-label="Mark as read"
          title="Mark as read"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "hsl(var(--muted-foreground))",
            padding: 4,
            borderRadius: 4,
            display: "flex",
            alignItems: "flex-start",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <Check size={13} />
        </button>
      )}
    </div>
  );
}

interface NotificationBellProps {
  iconSize?: number;
  buttonClassName?: string;
}

export function NotificationBell({
  iconSize = 16,
  buttonClassName = "",
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const queryClient = useQueryClient();

  const { data: counts } = useGetCounts({
    query: {
      queryKey: getGetCountsQueryKey(),
      refetchInterval: isOpen ? 10_000 : 60_000,
    },
  });

  const { data: list, isLoading } = useList(
    { pageSize: 30, unread: false },
    {
      query: {
        queryKey: getListQueryKey({ pageSize: 30, unread: false }),
        enabled: isOpen,
      },
    },
  );

  const { mutate: bulkMark } = useBulkUpdateState({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetCountsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListQueryKey({ pageSize: 30, unread: false }),
        });
      },
    },
  });

  const { mutate: markOne } = useUpdateState({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetCountsQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getListQueryKey({ pageSize: 30, unread: false }),
        });
      },
    },
  });

  const unreadCount = counts?.total ?? 0;
  const items = list?.items ?? [];

  // Position panel below trigger button
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const panelW = Math.min(360, vw - 16);
    const left = Math.max(8, Math.min(rect.right - panelW, vw - panelW - 8));
    setPanelPos({ top: rect.bottom + 6, left });
  }, [isOpen]);

  // Outside-click close
  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!document.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen]);

  const handleMarkAllRead = useCallback(() => {
    const unreadIds = items.filter((i) => !i.isRead).map((i) => i.recipientId);
    if (unreadIds.length === 0) return;
    bulkMark({ data: { recipientIds: unreadIds, action: "read" } });
  }, [items, bulkMark]);

  const handleMarkOne = useCallback(
    (recipientId: number) => {
      markOne({
        recipientId,
        data: { read: true },
      });
    },
    [markOne],
  );

  const vw = window.innerWidth ?? 1024;
  const panelW = Math.min(360, vw - 16);

  const panel = isOpen
    ? createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: panelPos.top,
            left: panelPos.left,
            width: panelW,
            maxHeight: 480,
            zIndex: 9998,
            boxShadow:
              "0 20px 60px -12px rgba(0,0,0,0.25), 0 8px 24px -6px rgba(0,0,0,0.1)",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid hsl(var(--border))",
            display: "flex",
            flexDirection: "column",
            background: "hsl(var(--card))",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 14px",
              borderBottom: "1px solid hsl(var(--border))",
              background:
                "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.85) 100%)",
              color: "#fff",
              gap: 8,
            }}
          >
            <Bell size={14} />
            <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    background: "rgba(255,255,255,0.25)",
                    borderRadius: 8,
                    padding: "0 6px",
                    fontSize: 11,
                  }}
                >
                  {unreadCount} unread
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                title="Mark all as read"
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "#fff",
                  padding: "3px 8px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <CheckCheck size={12} />
                All read
              </button>
            )}
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close notifications"
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "none",
                cursor: "pointer",
                color: "#fff",
                padding: 4,
                borderRadius: 6,
                display: "flex",
              }}
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {isLoading ? (
              <div
                style={{
                  padding: "40px 14px",
                  textAlign: "center",
                  color: "hsl(var(--muted-foreground))",
                  fontSize: 13,
                }}
              >
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div
                style={{
                  padding: "40px 14px",
                  textAlign: "center",
                  color: "hsl(var(--muted-foreground))",
                  fontSize: 13,
                }}
              >
                <Bell
                  size={28}
                  style={{ margin: "0 auto 8px", opacity: 0.4 }}
                />
                <div>No notifications</div>
              </div>
            ) : (
              items.map((item) => (
                <NotificationRow
                  key={item.recipientId}
                  item={item}
                  onMarkRead={handleMarkOne}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div
              style={{
                padding: "8px 14px",
                borderTop: "1px solid hsl(var(--border))",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <a
                href="/modules/notifications"
                style={{
                  fontSize: 12,
                  color: "hsl(var(--primary))",
                  textDecoration: "none",
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                View all <ChevronRight size={12} />
              </a>
            </div>
          )}
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
            ? `Notifications — ${unreadCount} unread`
            : "Open Notifications"
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
        <Bell size={iconSize} />
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
    </>
  );
}
