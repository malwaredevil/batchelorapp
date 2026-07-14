import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/web-core/auth";
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
  ArrowLeft,
  User,
  Users,
} from "lucide-react";
import {
  useListConversations,
  useCreateConversation,
  useUpdateConversation,
  useDeleteConversation,
  useListHouseholdMembers,
  getListConversationsQueryKey,
  type MessengerConversationSummary,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

interface MessengerConversationSidebarProps {
  selectedConvId: number | null;
  onSelect: (id: number) => void;
}

type CreateStep =
  | null
  | { step: "picker"; selectedIds: number[] }
  | { step: "group-name"; selectedIds: number[]; name: string };

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
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function convDisplayName(
  c: MessengerConversationSummary,
  currentUserId: number,
): string {
  if (c.isDirect) {
    const other = c.participants?.find((p) => p.id !== currentUserId);
    return other?.displayName ?? "Direct Message";
  }
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
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: allConversations = [], isLoading } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: 5_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });

  const { data: members = [] } = useListHouseholdMembers();

  const active = allConversations.filter((c) => !c.archivedAt);
  const archived = allConversations.filter((c) => !!c.archivedAt);

  const { mutateAsync: createConv } = useCreateConversation();
  const { mutateAsync: updateConv } = useUpdateConversation();
  const { mutateAsync: deleteConv } = useDeleteConversation();

  // Create a DM with the selected person (or find existing)
  const handleCreateDm = useCallback(
    async (otherId: number) => {
      const created = await createConv({
        data: { isDirect: true, participantIds: [otherId] },
      });
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      setCreateStep(null);
      onSelect(created.id);
    },
    [createConv, qc, onSelect],
  );

  // Create a named group chat
  const handleCreateGroup = useCallback(
    async (selectedIds: number[], name: string) => {
      const trimmed = name.trim() || "Group Chat";
      const created = await createConv({
        data: { isDirect: false, participantIds: selectedIds, name: trimmed },
      });
      qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      setCreateStep(null);
      onSelect(created.id);
    },
    [createConv, qc, onSelect],
  );

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
    const name = convDisplayName(c, currentUserId);
    const preview = lastMessagePreview(c);
    const time = c.lastMessage?.createdAt ? relativeTime(c.lastMessage.createdAt) : "";

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
          background: isSelected ? "#eff6ff" : isHovered ? "#f9fafb" : "transparent",
          borderLeft: isSelected ? "2px solid #3b82f6" : "2px solid transparent",
          position: "relative",
          transition: "background 0.1s",
        }}
      >
        {/* Name + time row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, marginBottom: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
            {c.isDirect
              ? <User size={10} style={{ color: "#9ca3af", flexShrink: 0 }} />
              : <Users size={10} style={{ color: "#9ca3af", flexShrink: 0 }} />
            }
            <span
              style={{
                fontSize: 13,
                fontWeight: c.unreadCount > 0 ? 600 : 500,
                color: "#111827",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
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
            {time && <span style={{ fontSize: 10, color: "#9ca3af" }}>{time}</span>}
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
          <div style={{ fontSize: 11, color: "#ef4444", display: "flex", alignItems: "center", gap: 6 }}>
            <span>Delete this chat?</span>
            <button
              onClick={(e) => { e.stopPropagation(); void handleDelete(c.id); }}
              style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, padding: "1px 6px", fontSize: 10, cursor: "pointer" }}
            >
              Delete
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
              style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 6px", fontSize: 10, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Hover actions */}
        {isHovered && !isConfirmingDelete && (
          <div style={{ position: "absolute", right: 8, bottom: 6, display: "flex", gap: 2 }}>
            <button
              title={isArchived ? "Unarchive" : "Archive"}
              onClick={(e) => { e.stopPropagation(); void handleArchive(c.id, !isArchived); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 2, borderRadius: 4, display: "flex", alignItems: "center" }}
            >
              {isArchived ? <ArchiveX size={12} /> : <Archive size={12} />}
            </button>
            <button
              title="Delete"
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(c.id); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 2, borderRadius: 4, display: "flex", alignItems: "center" }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render the member picker / group-name step
  const renderCreateFlow = () => {
    if (!createStep) return null;

    // Step 1: Member picker
    if (createStep.step === "picker") {
      const otherMembers = members.filter((m) => m.id !== currentUserId);
      const { selectedIds } = createStep;

      const toggleMember = (id: number) => {
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        setCreateStep({ step: "picker", selectedIds: next });
      };

      return (
        <div
          style={{
            borderBottom: "1px solid #f3f4f6",
            paddingBottom: 6,
          }}
        >
          {/* Picker header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px 4px",
            }}
          >
            <button
              onClick={() => setCreateStep(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 2, display: "flex" }}
            >
              <ArrowLeft size={13} />
            </button>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#374151", flex: 1 }}>
              {selectedIds.length === 0
                ? "Select people"
                : `${selectedIds.length} selected`}
            </span>
            <button
              onClick={() => setCreateStep(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 2, display: "flex" }}
            >
              <X size={13} />
            </button>
          </div>

          {/* Member list */}
          <div style={{ maxHeight: 140, overflowY: "auto", padding: "0 6px" }}>
            {otherMembers.length === 0 && (
              <div style={{ fontSize: 11, color: "#9ca3af", padding: "8px 4px" }}>
                No other household members.
              </div>
            )}
            {otherMembers.map((m) => {
              const checked = selectedIds.includes(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => toggleMember(m.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 6px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: checked ? "#eff6ff" : "transparent",
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      border: checked ? "2px solid #3b82f6" : "2px solid #d1d5db",
                      background: checked ? "#3b82f6" : "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {checked && <Check size={9} color="#fff" />}
                  </div>
                  <span style={{ fontSize: 12, color: "#374151" }}>
                    {m.displayName ?? m.email}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          {selectedIds.length > 0 && (
            <div style={{ padding: "4px 10px 0", display: "flex", gap: 4 }}>
              {selectedIds.length === 1 && (
                <button
                  onClick={() => void handleCreateDm(selectedIds[0])}
                  style={{
                    flex: 1,
                    background: "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "5px 0",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Start DM
                </button>
              )}
              {selectedIds.length >= 2 && (
                <button
                  onClick={() =>
                    setCreateStep({ step: "group-name", selectedIds, name: "" })
                  }
                  style={{
                    flex: 1,
                    background: "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "5px 0",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Name Group →
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    // Step 2: Group name
    if (createStep.step === "group-name") {
      const { selectedIds, name } = createStep;
      return (
        <div
          style={{
            padding: "6px 10px",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <button
              onClick={() => setCreateStep({ step: "picker", selectedIds })}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 2, display: "flex" }}
            >
              <ArrowLeft size={13} />
            </button>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>
              Group name
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              autoFocus
              value={name}
              onChange={(e) =>
                setCreateStep({ step: "group-name", selectedIds, name: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateGroup(selectedIds, name);
                if (e.key === "Escape") setCreateStep(null);
              }}
              placeholder="e.g. Family Trip Planning"
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
              onClick={() => void handleCreateGroup(selectedIds, name)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#3b82f6", padding: 2, display: "flex" }}
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => setCreateStep(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 2, display: "flex" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      );
    }

    return null;
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Chats</span>
        </div>
        <button
          title="New conversation"
          onClick={() =>
            setCreateStep(createStep ? null : { step: "picker", selectedIds: [] })
          }
          style={{
            background: createStep ? "#eff6ff" : "none",
            border: "none",
            cursor: "pointer",
            color: createStep ? "#3b82f6" : "#6b7280",
            padding: 2,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      {/* Create conversation flow */}
      {renderCreateFlow()}

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
        {isLoading && (
          <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, padding: "16px 0" }}>
            Loading…
          </div>
        )}

        {!isLoading && active.length === 0 && (
          <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 11, padding: "16px 8px" }}>
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
              {showArchived ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Archived ({archived.length})
            </button>
            {showArchived && archived.map((c) => renderItem(c, true))}
          </div>
        )}
      </div>
    </div>
  );
}
