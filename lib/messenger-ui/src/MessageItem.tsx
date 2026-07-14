import { useState, useRef, useEffect } from "react";
import { Trash2, FileText, Sparkles, Pencil, Check, X } from "lucide-react";
import type { MessengerMessengerMessage } from "@workspace/api-client-react";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { ImageModal } from "./ImageModal";

interface MessageItemProps {
  message: MessengerMessengerMessage;
  isOwn: boolean;
  canEdit?: boolean;
  onDelete?: (id: number) => void;
  onEdit?: (id: number, newBody: string) => Promise<void>;
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
}: MessageItemProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [imageModal, setImageModal] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const isElaine = message.senderId === null;
  const isDeleted = !!message.deletedAt;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  const urls = isDeleted ? [] : extractUrls(message.body);
  const firstUrl = urls[0] ?? null;

  const bubbleBg = isDeleted
    ? "#f3f4f6"
    : isElaine
      ? "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
      : isOwn
        ? "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
        : "#f3f4f6";

  const bubbleColor = isDeleted
    ? "#9ca3af"
    : isElaine || isOwn
      ? "#fff"
      : "#111827";

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

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
            color: "#6b7280",
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
          <div style={{ display: "flex", gap: 2 }}>
            {canEdit && onEdit && (
              <button
                onClick={() => setEditing(true)}
                aria-label="Edit message"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6b7280",
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
                    background: "#f3f4f6",
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    cursor: "pointer",
                    padding: "2px 8px",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
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
                borderRadius: isOwn ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                padding: isDeleted ? "6px 12px" : "8px 12px",
                fontSize: 14,
                lineHeight: 1.5,
                wordBreak: "break-word",
                fontStyle: isDeleted ? "italic" : undefined,
              }}
            >
              {isDeleted ? "Message deleted" : message.body}
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
          {!editing && !isDeleted &&
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
                          border: "1px solid rgba(0,0,0,0.1)",
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
                        background: "#f3f4f6",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        textDecoration: "none",
                        color: "#374151",
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
        </div>
      </div>

      {/* Timestamp + edited indicator */}
      <div
        style={{
          fontSize: 10,
          color: "#9ca3af",
          marginTop: 2,
          paddingRight: isOwn ? 4 : 0,
          paddingLeft: isOwn ? 0 : 4,
          display: "flex",
          gap: 4,
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
