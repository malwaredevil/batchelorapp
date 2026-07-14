import { MessageSquare } from "lucide-react";
import { useAuth } from "@workspace/web-core/auth";
import { MessengerChatPanel } from "@workspace/messenger-ui";

export default function MessengerPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 120px)",
        maxWidth: 720,
        margin: "0 auto",
        padding: "0 16px",
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
          <MessageSquare size={18} />
        </div>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#111827",
              lineHeight: 1.3,
            }}
          >
            Messenger
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
            Household group chat · @elaine for AI help
          </p>
        </div>
      </div>

      {/* Chat panel */}
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
        <MessengerChatPanel currentUserId={user.id} isOpen={true} />
      </div>
    </div>
  );
}
