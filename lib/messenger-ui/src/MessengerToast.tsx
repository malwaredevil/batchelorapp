import { useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";

export interface MessengerToastItem {
  id: string;
  convId: number;
  convName: string;
  senderName: string | null;
  body: string;
}

interface MessengerToastProps {
  toasts: MessengerToastItem[];
  onDismiss: (id: string) => void;
  messengerHref?: string;
}

const AUTO_DISMISS_MS = 5_000;

function SingleToast({
  toast,
  onDismiss,
  messengerHref,
}: {
  toast: MessengerToastItem;
  onDismiss: (id: string) => void;
  messengerHref?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showTimer = requestAnimationFrame(() => setVisible(true));
    const hideTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, AUTO_DISMISS_MS);
    return () => {
      cancelAnimationFrame(showTimer);
      clearTimeout(hideTimer);
    };
  }, [toast.id, onDismiss]);

  const href =
    messengerHref ?? `/modules/office/messenger?convId=${toast.convId}`;

  const preview = toast.body
    ? toast.body.replace(/\n/g, " ").slice(0, 80) +
      (toast.body.length > 80 ? "…" : "")
    : "Sent an attachment";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: "#1e293b",
        color: "#f8fafc",
        borderRadius: 12,
        padding: "10px 12px 10px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        width: 320,
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(24px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
        position: "relative",
      }}
      onClick={() => {
        window.location.href = href;
        onDismiss(toast.id);
      }}
    >
      <div
        style={{
          background: "#3b82f6",
          borderRadius: 8,
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <MessageSquare size={15} color="#fff" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#e2e8f0",
            marginBottom: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {toast.senderName ?? "Elaine"}
          {toast.convName ? (
            <span style={{ fontWeight: 400, color: "#94a3b8" }}>
              {" "}
              in {toast.convName}
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#cbd5e1",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {preview}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setVisible(false);
          setTimeout(() => onDismiss(toast.id), 300);
        }}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#64748b",
          cursor: "pointer",
          padding: 2,
          display: "flex",
          flexShrink: 0,
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function MessengerToastContainer({
  toasts,
  onDismiss,
  messengerHref,
}: MessengerToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        right: 20,
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: "auto" }}>
          <SingleToast
            toast={t}
            onDismiss={onDismiss}
            messengerHref={messengerHref}
          />
        </div>
      ))}
    </div>
  );
}
