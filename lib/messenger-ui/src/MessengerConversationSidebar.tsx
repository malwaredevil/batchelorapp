import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Plus,
  Archive,
  ArchiveX,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import {
  useListConversations,
  useCreateConversation,
  useUpdateConversation,
  useDeleteConversation,
  getListConversationsQueryKey,
  type MessengerConversationSummary,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

interface MessengerConversationSidebarProps {
  selectedConvId: number | null;
  onSelect: (id: number) => void;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function convDisplayName(c: MessengerConversationSummary): string {
  return c.name ?? "Group Chat";
}

function lastMessagePreview(c: MessengerConversationSummary): string {
  const msg = c.lastMessage;
  if (!msg) return "No messages yet";
  if (msg.deletedAt) return "Message deleted";
  const prefix = msg.senderName ? `${msg.senderName.split(" ")[0]}: ` : "";
  const body = msg.body.replace(/\n/g, " ").slice(0, 60);
  return `${prefix}${body}${msg.body.length > 60 ? "…" : ""}`;
}

export function MessengerConversationSidebar({
  selectedConvId,
  onSelect,
}: MessengerConversationSidebarProps) {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: allConversations = [], isLoading } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: 5_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });

  const active = allConversations.filter((c) => !c.archivedAt);
  const archived = allConversations.filter((c) => !!c.archivedAt);

  const { mutateAsync: createConv } = useCreateConversation();
  const { mutateAsync: updateConv } = useUpdateConversation();
  const { mutateAsync: deleteConv } = useDeleteConversation();

  const handleCreate = useCallback(async () => {
    const name = (creatingName ?? "").trim() || "New Chat";
    const created = await createConv({ data: { name } });
    qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    setCreatingName(null);
    onSelect(created.id);
  }, [creatingName, createConv, qc, onSelect]);

  const handleArchive = useCallback(
    async (id: number, archive: boolean) => {
      await updateConv({ id, data: { archived: archive } });
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      if (archive && selectedConvId === id) {
        const next = active.find((c) => c.id !== id);
        if (next) onSelect(next.id);
      }
    },
    [updateConv, qc, active, selectedConvId, onSelect],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      await deleteConv({ id });
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      setConfirmDeleteId(null);
      if (selectedConvId === id) {
        const next = active.find((c) => c.id !== id);
        if (next) onSelect(next.id);
      }
    },
    [deleteConv, qc, active, selectedConvId, onSelect],
  );

  const renderItem = (c: MessengerConversationSummary, isArchived = false) => {
    const isSelected = c.id === selectedConvId;
    const isHovered = hoveredId === c.id;
    const isConfirmingDelete = confirmDeleteId === c.id;
    const name = convDisplayName(c);
    const preview = lastMessagePreview(c);
    const time = c.lastMessage?.createdAt
      ? relativeTime(c.lastMessage.createdAt)
      : "";

    return (
      <div
        key={c.id}
        onMouseEnter={() => setHoveredId(c.id)}
        onMouseLeave={() => {
          setHoveredId(null);
          if (confirmDeleteId === c.id) setConfirmDeleteId(null);
        }}
        onClick={() => !isConfirmingDelete && onSelect(c.id)}
        style={{
          padding: "8px 10px",
          borderRadius: 8,
          cursor: "pointer",
          background: isSelected
            ? "#eff6ff"
            : isHovered
              ? "#f9fafb"
              : "transparent",
          borderLeft: isSelected
            ? "2px solid #3b82f6"
            : "2px solid transparent",
          position: "relative",
          transition: "background 0.1s",
        }}
      >
        {/* Name + time row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 4,
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: c.unreadCount > 0 ? 600 : 500,
              color: "#111827",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {name}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
            }}
          >
            {c.unreadCount > 0 && (
              <span
                style={{
                  background: "#3b82f6",
                  color: "#fff",
                  borderRadius: 10,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  minWidth: 16,
                  textAlign: "center",
                }}
              >
                {c.unreadCount}
              </span>
            )}
            {time && (
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{time}</span>
            )}
          </div>
        </div>

        {/* Preview */}
        {!isConfirmingDelete && (
          <div
            style={{
              fontSize: 11,
              color: "#6b7280",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {preview}
          </div>
        )}

        {/* Delete confirm */}
        {isConfirmingDelete && (
          <div
            style={{
              fontSize: 11,
              color: "#ef4444",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>Delete this chat?</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete(c.id);
              }}
              style={{
                background: "#ef4444",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Delete
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDeleteId(null);
              }}
              style={{
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Hover actions */}
        {isHovered && !isConfirmingDelete && (
          <div
            style={{
              position: "absolute",
              right: 8,
              bottom: 6,
              display: "flex",
              gap: 2,
            }}
          >
            <button
              title={isArchived ? "Unarchive" : "Archive"}
              onClick={(e) => {
                e.stopPropagation();
                void handleArchive(c.id, !isArchived);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#9ca3af",
                padding: 2,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              {isArchived ? <ArchiveX size={12} /> : <Archive size={12} />}
            </button>
            <button
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDeleteId(c.id);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#9ca3af",
                padding: 2,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid #f0f0f0",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 8px",
          borderBottom: "1px solid #f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <MessageSquare size={14} style={{ color: "#6b7280" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
            Chats
          </span>
        </div>
        <button
          title="New conversation"
          onClick={() => setCreatingName("")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#6b7280",
            padding: 2,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      {/* New conversation input */}
      {creatingName !== null && (
        <div
          style={{
            padding: "6px 10px",
            borderBottom: "1px solid #f3f4f6",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <input
            autoFocus
            value={creatingName}
            onChange={(e) => setCreatingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") setCreatingName(null);
            }}
            placeholder="Chat name…"
            style={{
              flex: 1,
              fontSize: 12,
              border: "1px solid #d1d5db",
              borderRadius: 5,
              padding: "3px 6px",
              outline: "none",
            }}
          />
          <button
            onClick={() => void handleCreate()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#3b82f6",
              padding: 2,
              display: "flex",
            }}
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => setCreatingName(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#9ca3af",
              padding: 2,
              display: "flex",
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Conversation list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 6px",
        }}
      >
        {isLoading && (
          <div
            style={{
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 12,
              padding: "16px 0",
            }}
          >
            Loading…
          </div>
        )}

        {!isLoading && active.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 11,
              padding: "16px 8px",
            }}
          >
            No chats yet.
            <br />
            Click + to create one.
          </div>
        )}

        {active.map((c) => renderItem(c, false))}

        {/* Archived section */}
        {archived.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowArchived((v) => !v)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 4px",
                color: "#9ca3af",
                fontSize: 11,
                width: "100%",
              }}
            >
              {showArchived ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )}
              Archived ({archived.length})
            </button>
            {showArchived && archived.map((c) => renderItem(c, true))}
          </div>
        )}
      </div>
    </div>
  );
}
