import { useState, useEffect } from "react";
import { Users, ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "@workspace/web-core/auth";
import {
  MessengerChatPanel,
  MessengerContactsPanel,
  MessengerConversationSidebar,
} from "@workspace/messenger-ui";
import {
  useListConversations,
  getListConversationsQueryKey,
  type MessengerConversationSummary,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

export default function MessengerPage() {
  const { user } = useAuth();
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [view, setView] = useState<"chat" | "contacts">("chat");
  const [pendingPrefill, setPendingPrefill] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { data: conversations = [] } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: 5_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });

  // Auto-select the first active conversation on load
  useEffect(() => {
    if (selectedConvId !== null) return;
    const first = conversations.find((c) => !c.archivedAt);
    if (first) setSelectedConvId(first.id);
  }, [conversations, selectedConvId]);

  if (!user) return null;

  const selectedConv = conversations.find((c) => c.id === selectedConvId);
  const convName = selectedConv?.name ?? "Group Chat";

  function participantSubtitle(
    conv: typeof selectedConv,
    currentId: number,
  ): string {
    if (!conv?.participants?.length) return "";
    const subset = conv.isDirect
      ? conv.participants.filter((p) => p.id !== currentId)
      : conv.participants;
    const names = subset.map((p) => p.displayName ?? `User ${p.id}`);
    if (names.length === 0) return "";
    if (names.length <= 4) return names.join(", ");
    return `${names.slice(0, 4).join(", ")} +${names.length - 4} more`;
  }

  const participantLine = selectedConv
    ? participantSubtitle(selectedConv, user.id)
    : "";

  const handleContactSelect = (prefill: string) => {
    setPendingPrefill(prefill);
    setView("chat");
  };

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 120px)",
        overflow: "hidden",
        border: "1px solid #f0f0f0",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      {/* Left sidebar — collapsible */}
      {sidebarOpen && (
        <MessengerConversationSidebar
          selectedConvId={selectedConvId}
          onSelect={(id) => {
            setSelectedConvId(id);
            setView("chat");
          }}
        />
      )}

      {/* Right: header + body */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {/* Panel header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderBottom: "1px solid #f0f0f0",
            flexShrink: 0,
          }}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide chat list" : "Show chat list"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#9ca3af",
              padding: 2,
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </button>

          {view === "contacts" ? (
            <>
              <button
                onClick={() => setView("chat")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6b7280",
                  padding: "2px 4px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 13,
                }}
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>
                Contacts
              </span>
            </>
          ) : (
            <>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#111827",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {selectedConvId ? convName : "Messenger"}
                </span>
                {participantLine && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedConv?.isDirect ? "Chat with " : "Members: "}
                    <span style={{ color: "#374151", fontWeight: 500 }}>
                      {participantLine}
                    </span>
                  </span>
                )}
              </div>
              <button
                onClick={() => setView("contacts")}
                title="Contacts"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: "#f3f4f6",
                  border: "none",
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                <Users size={13} />
                Contacts
              </button>
            </>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {view === "contacts" ? (
            <MessengerContactsPanel onSelect={handleContactSelect} />
          ) : selectedConvId ? (
            <MessengerChatPanel
              currentUserId={user.id}
              conversationId={selectedConvId}
              isOpen={true}
              prefillInput={pendingPrefill}
              onPrefillApplied={() => setPendingPrefill("")}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#9ca3af",
                fontSize: 13,
              }}
            >
              Select a chat or create a new one
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
