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
  const [selectedConvId, setSelectedConvId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("convId");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  });
  const [view, setView] = useState<"chat" | "contacts">("chat");
  const [pendingPrefill, setPendingPrefill] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth >= 640,
  );

  const { data: conversations = [] } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: 5_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });

  // Auto-select the first active conversation on load, unless a convId was
  // supplied in the URL (e.g. from a notification link or the widget).
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
      className="flex overflow-hidden rounded-xl border border-border bg-card"
      style={{ height: "calc(100vh - 120px)" }}
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
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Panel header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide chat list" : "Show chat list"}
            className="flex items-center text-muted-foreground hover:text-foreground transition-colors p-0.5 flex-shrink-0"
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
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <span className="text-sm font-semibold text-foreground">
                Contacts
              </span>
            </>
          ) : (
            <>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground truncate">
                  {selectedConvId ? convName : "Messenger"}
                </span>
                {participantLine && (
                  <span className="text-[11px] text-muted-foreground truncate">
                    {selectedConv?.isDirect ? "Chat with " : "Members: "}
                    <span className="text-foreground/80 font-medium">
                      {participantLine}
                    </span>
                  </span>
                )}
              </div>
              <button
                onClick={() => setView("contacts")}
                title="Contacts"
                className="flex items-center gap-1.5 bg-muted hover:bg-muted/80 rounded-lg px-2.5 py-1 text-xs font-medium text-foreground transition-colors"
              >
                <Users size={13} />
                Contacts
              </button>
            </>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {view === "contacts" ? (
            <MessengerContactsPanel onSelect={handleContactSelect} />
          ) : selectedConvId ? (
            <MessengerChatPanel
              currentUserId={user.id}
              conversationId={selectedConvId}
              isOpen={true}
              showParticipants={false}
              prefillInput={pendingPrefill}
              onPrefillApplied={() => setPendingPrefill("")}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Select a chat or create a new one
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
