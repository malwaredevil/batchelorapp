import { useState, useRef, useEffect } from "react";
import {
  Trash2,
  FileText,
  Sparkles,
  Pencil,
  Check,
  X,
  SmilePlus,
} from "lucide-react";
import type { MessengerMessengerMessage } from "@workspace/api-client-react";
import { MarkdownMessage, ChatWidget } from "@workspace/elaine-ui";
import type { ChatWidget as ChatWidgetType } from "@workspace/elaine-ui";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { ImageModal } from "./ImageModal";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "👏", "🔥"];

interface MessageItemProps {
  message: MessengerMessengerMessage;
  isOwn: boolean;
  canEdit?: boolean;
  onDelete?: (id: number) => void;
  onEdit?: (id: number, newBody: string) => Promise<void>;
  onAddReaction?: (id: number, emoji: string) => Promise<void>;
  onRemoveReaction?: (id: number, emoji: string) => Promise<void>;
}

const URL_RE = /https?:\/\/[^\s]+/g;

function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_RE) ?? []));
}

export function MessageItem({
  message,
  isOwn,
  canEdit,
  onDelete,
  onEdit,
  onAddReaction,
  onRemoveReaction,
}: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [imageModal, setImageModal] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const isElaine = message.senderId === null;
  const isDeleted = !!message.deletedAt;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker]);

  const urls = isDeleted ? [] : extractUrls(message.body);
  const firstUrl = urls[0] ?? null;

  const widgets: ChatWidgetType[] =
    !isDeleted &&
    isElaine &&
    message.metadata &&
    typeof message.metadata === "object" &&
    "widgets" in message.metadata &&
    Array.isArray((message.metadata as { widgets?: unknown }).widgets)
      ? ((message.metadata as { widgets: ChatWidgetType[] }).widgets ?? [])
      : [];

  const bubbleBg = isDeleted
    ? "hsl(var(--muted))"
    : isElaine
      ? "rgba(109, 40, 217, 0.07)"
      : isOwn
        ? "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
        : "hsl(var(--muted))";

  const bubbleBorder =
    isElaine && !isDeleted ? "1px solid rgba(109, 40, 217, 0.15)" : undefined;

  const bubbleColor = isDeleted
    ? "hsl(var(--muted-foreground))"
    : isElaine
      ? "hsl(var(--foreground))"
      : isOwn
        ? "#fff"
        : "hsl(var(--foreground))";

  const handleSaveEdit = async () => {
    if (!onEdit || !editValue.trim() || editValue.trim() === message.body) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onEdit(message.id, editValue.trim());
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditValue(message.body);
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSaveEdit();
    }
    if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const handlePickEmoji = async (emoji: string) => {
    setShowPicker(false);
    if (!onAddReaction) return;
    await onAddReaction(message.id, emoji);
  };

  const handleReactionChipClick = async (
    emoji: string,
    userReacted: boolean,
  ) => {
    if (userReacted) {
      await onRemoveReaction?.(message.id, emoji);
    } else {
      await onAddReaction?.(message.id, emoji);
    }
  };

  const reactions = message.reactions ?? [];
  const canReact = !isDeleted && (onAddReaction || onRemoveReaction);

  const reactionButton = canReact && hovered && !editing && (
    <div style={{ position: "relative" }} ref={pickerRef}>
      <button
        onClick={() => setShowPicker((v) => !v)}
        aria-label="Add reaction"
        style={{
          background: showPicker
            ? "hsl(var(--muted))"
            : "hsl(var(--background))",
          border: "1px solid hsl(var(--border))",
          cursor: "pointer",
          color: "hsl(var(--muted-foreground))",
          padding: "2px 5px",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          gap: 2,
          fontSize: 12,
        }}
      >
        <SmilePlus size={13} />
      </button>
      {showPicker && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            ...(isOwn ? { right: 0 } : { left: 0 }),
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 10,
            padding: "6px 8px",
            display: "flex",
            gap: 2,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            zIndex: 50,
            whiteSpace: "nowrap",
          }}
        >
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => void handlePickEmoji(emoji)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 20,
                padding: "2px 4px",
                borderRadius: 6,
                lineHeight: 1,
                transition: "transform 0.1s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "scale(1.3)";
                (e.currentTarget as HTMLButtonElement).style.background =
                  "hsl(var(--muted))";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "scale(1)";
                (e.currentTarget as HTMLButtonElement).style.background =
                  "none";
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setShowPicker(false);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isOwn ? "flex-end" : "flex-start",
        padding: "2px 12px",
        position: "relative",
      }}
    >
      {/* Sender label */}
      {!isOwn && !isElaine && (
        <div
          style={{
            fontSize: 11,
            color: "hsl(var(--muted-foreground))",
            marginBottom: 2,
            paddingLeft: 4,
          }}
        >
          {message.senderName ?? "Household member"}
        </div>
      )}
      {isElaine && (
        <div
          style={{
            fontSize: 11,
            color: "#8b5cf6",
            marginBottom: 2,
            paddingLeft: 4,
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Sparkles size={10} />
          Elaine
        </div>
      )}

      {/* Bubble row */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
        {isOwn && hovered && !isDeleted && !editing && (
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {reactionButton}
            {canEdit && onEdit && (
              <button
                onClick={() => setEditing(true)}
                aria-label="Edit message"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "hsl(var(--muted-foreground))",
                  padding: 4,
                  borderRadius: 4,
                  display: "flex",
                }}
              >
                <Pencil size={13} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(message.id)}
                aria-label="Delete message"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#ef4444",
                  padding: 4,
                  borderRadius: 4,
                  display: "flex",
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}

        <div style={{ maxWidth: 280 }}>
          {/* Bubble — normal or edit mode */}
          {editing ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 180,
              }}
            >
              <textarea
                ref={editRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={2}
                style={{
                  resize: "none",
                  border: "1.5px solid #3b82f6",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 14,
                  lineHeight: 1.5,
                  outline: "none",
                  fontFamily: "inherit",
                  minWidth: 180,
                  background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))",
                }}
              />
              <div
                style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}
              >
                <button
                  onClick={handleCancelEdit}
                  disabled={saving}
                  aria-label="Cancel edit"
                  style={{
                    background: "hsl(var(--muted))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    cursor: "pointer",
                    padding: "2px 8px",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    color: "hsl(var(--foreground))",
                  }}
                >
                  <X size={11} /> Cancel
                </button>
                <button
                  onClick={() => void handleSaveEdit()}
                  disabled={saving || !editValue.trim()}
                  aria-label="Save edit"
                  style={{
                    background: "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: saving ? "not-allowed" : "pointer",
                    padding: "2px 8px",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  <Check size={11} /> Save
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                background: bubbleBg,
                color: bubbleColor,
                border: bubbleBorder,
                borderRadius: isOwn
                  ? "16px 16px 4px 16px"
                  : "16px 16px 16px 4px",
                padding: isDeleted ? "6px 12px" : "8px 12px",
                fontSize: 14,
                lineHeight: 1.5,
                wordBreak: "break-word",
                fontStyle: isDeleted ? "italic" : undefined,
              }}
            >
              {isDeleted ? (
                "Message deleted"
              ) : isElaine ? (
                <MarkdownMessage text={message.body} />
              ) : (
                message.body
              )}
            </div>
          )}

          {/* Elaine widget cards */}
          {!editing && widgets.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {widgets.map((w, i) => (
                <ChatWidget key={i} widget={w} />
              ))}
            </div>
          )}

          {/* Link preview */}
          {!editing && firstUrl && !isDeleted && (
            <div
              style={{
                display: "flex",
                justifyContent: isOwn ? "flex-end" : "flex-start",
              }}
            >
              <LinkPreviewCard url={firstUrl} />
            </div>
          )}

          {/* Attachments */}
          {!editing &&
            !isDeleted &&
            message.attachments &&
            message.attachments.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  justifyContent: isOwn ? "flex-end" : "flex-start",
                }}
              >
                {message.attachments.map((att) => {
                  if (att.mimeType.startsWith("image/")) {
                    return (
                      <img
                        key={att.id}
                        src={att.url ?? undefined}
                        alt={att.fileName}
                        onClick={() =>
                          att.url &&
                          setImageModal({ url: att.url, name: att.fileName })
                        }
                        style={{
                          width: 120,
                          height: 90,
                          objectFit: "cover",
                          borderRadius: 8,
                          cursor: "pointer",
                          border: "1px solid hsl(var(--border))",
                        }}
                      />
                    );
                  }
                  return (
                    <a
                      key={att.id}
                      href={att.url ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        background: "hsl(var(--muted))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        textDecoration: "none",
                        color: "hsl(var(--foreground))",
                        fontSize: 12,
                      }}
                    >
                      <FileText size={14} />
                      <span
                        style={{
                          maxWidth: 140,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {att.fileName}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}

          {/* Reaction chips */}
          {!editing && reactions.length > 0 && (
            <div
              style={{
                marginTop: 4,
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                justifyContent: isOwn ? "flex-end" : "flex-start",
              }}
            >
              {reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() =>
                    void handleReactionChipClick(r.emoji, r.userReacted)
                  }
                  title={
                    r.userReacted ? "Remove your reaction" : "Add reaction"
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "2px 7px",
                    borderRadius: 12,
                    border: r.userReacted
                      ? "1.5px solid #3b82f6"
                      : "1px solid hsl(var(--border))",
                    background: r.userReacted
                      ? "rgba(59,130,246,0.12)"
                      : "hsl(var(--background))",
                    cursor: "pointer",
                    fontSize: 13,
                    lineHeight: 1,
                    color: r.userReacted ? "#2563eb" : "hsl(var(--foreground))",
                    fontWeight: r.userReacted ? 600 : 400,
                    transition: "all 0.1s",
                  }}
                >
                  <span style={{ fontSize: 14 }}>{r.emoji}</span>
                  <span style={{ fontSize: 11 }}>{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reaction button for non-own messages (right side of bubble) */}
        {!isOwn && hovered && !isDeleted && !editing && (
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {reactionButton}
          </div>
        )}
      </div>

      {/* Timestamp + edited indicator */}
      <div
        style={{
          fontSize: 10,
          color: "hsl(var(--muted-foreground))",
          marginTop: 2,
          paddingRight: isOwn ? 4 : 0,
          paddingLeft: isOwn ? 0 : 4,
          display: "flex",
          gap: 4,
          opacity: 0.7,
        }}
      >
        <span>
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {message.editedAt && !isDeleted && (
          <span style={{ fontStyle: "italic" }}>edited</span>
        )}
      </div>

      {/* Image modal */}
      {imageModal && (
        <ImageModal
          url={imageModal.url}
          alt={imageModal.name}
          onClose={() => setImageModal(null)}
        />
      )}
    </div>
  );
}
