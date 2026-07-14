import { useState } from "react";
import { MessageSquare, Users, ArrowLeft } from "lucide-react";
import { useAuth } from "@workspace/web-core/auth";
import {
  MessengerChatPanel,
  MessengerContactsPanel,
} from "@workspace/messenger-ui";

export default function MessengerPage() {
  const { user } = useAuth();
  const [view, setView] = useState<"chat" | "contacts">("chat");
  const [pendingPrefill, setPendingPrefill] = useState("");

  if (!user) return null;

  const handleContactSelect = (prefill: string) => {
    setPendingPrefill(prefill);
    setView("chat");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 120px)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "20px 0 14px",
          borderBottom: "1px solid #f0f0f0",
          marginBottom: 0,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #3b82f6, #2563eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
          }}
        >
          {view === "contacts" ? (
            <Users size={18} />
          ) : (
            <MessageSquare size={18} />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#111827",
              lineHeight: 1.3,
            }}
          >
            {view === "contacts" ? "Contacts" : "Messenger"}
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
            {view === "contacts"
              ? "Select a person to start chatting"
              : "Household group chat · @elaine for AI help"}
          </p>
        </div>

        {/* Contacts / back button */}
        {view === "chat" ? (
          <button
            onClick={() => setView("contacts")}
            aria-label="View contacts"
            title="Contacts"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "#f3f4f6",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 500,
              color: "#374151",
              cursor: "pointer",
            }}
          >
            <Users size={15} />
            Contacts
          </button>
        ) : (
          <button
            onClick={() => setView("chat")}
            aria-label="Back to chat"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "#f3f4f6",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 500,
              color: "#374151",
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={15} />
            Back to chat
          </button>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          border: "1px solid #f0f0f0",
          borderTop: "none",
          borderBottomLeftRadius: 12,
          borderBottomRightRadius: 12,
          background: "#fff",
        }}
      >
        {view === "contacts" ? (
          <MessengerContactsPanel onSelect={handleContactSelect} />
        ) : (
          <MessengerChatPanel
            currentUserId={user.id}
            isOpen={true}
            prefillInput={pendingPrefill}
            onPrefillApplied={() => setPendingPrefill("")}
          />
        )}
      </div>
    </div>
  );
}
