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
import { MarkdownMessage, ChatWidget, useTheme } from "@workspace/elaine-ui";
import type { ChatWidget as ChatWidgetType } from "@workspace/elaine-ui";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { ImageModal } from "./ImageModal";
import { ReactionEmojiPicker } from "./ReactionEmojiPicker";

// Shown directly on the hover toolbar for one-click reacting, Teams-style.
// Anything else is reachable by opening the full picker via the "+" button.
const TOOLBAR_QUICK_EMOJIS = ["👍", "❤️", "😂", "😮"];

/** Two small circles: hollow = delivered, filled blue = read. Only shown on own messages. */
function ReadReceipt({ isRead }: { isRead: boolean }) {
  return (
    <span
      title={isRead ? "Read" : "Delivered"}
      aria-label={isRead ? "Read" : "Delivered"}
      style={{ display: "flex", alignItems: "center" }}
    >
      <svg width="17" height="8" viewBox="0 0 17 8" fill="none">
        <circle
          cx="4"
          cy="4"
          r="2.8"
          stroke={isRead ? "#3b82f6" : "currentColor"}
          strokeWidth="1.4"
          fill={isRead ? "#3b82f6" : "none"}
        />
        <circle
          cx="12"
          cy="4"
          r="2.8"
          stroke={isRead ? "#3b82f6" : "currentColor"}
          strokeWidth="1.4"
          fill={isRead ? "#3b82f6" : "none"}
        />
      </svg>
    </span>
  );
}

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
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [toolbarBelow, setToolbarBelow] = useState(false);
  // On touch devices hover never fires, so always show the reaction / action
  // buttons (they are small and unobtrusive even when persistently visible).
  const isTouchDevice =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  const [imageModal, setImageModal] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const bubbleWrapRef = useRef<HTMLDivElement>(null);
  const { isDark } = useTheme();

  const isElaine = message.senderId === null;
  const isDeleted = !!message.deletedAt;
  const toolbarVisible =
    (hovered || isTouchDevice || showFullPicker) && !isDeleted && !editing;

  // Flip the hover toolbar (and its "+" full-picker) to sit below the bubble
  // instead of above whenever there isn't ~40px of room above it — e.g. for
  // messages near the top of the scrollable list — so it can never render
  // partly off the top of the page.
  useEffect(() => {
    if (!toolbarVisible) return;
    const el = bubbleWrapRef.current;
    if (!el) return;
    setToolbarBelow(el.getBoundingClientRect().top < 40);
  }, [toolbarVisible]);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

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
    setShowFullPicker(false);
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
  const userReactedWith = (emoji: string) =>
    reactions.some((r) => r.emoji === emoji && r.userReacted);

  const toolbarButtonStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 4,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    lineHeight: 1,
  };

  // Teams-style floating toolbar: a few one-click quick reactions, a "+" that
  // opens the full categorized/searchable emoji grid, and edit/delete for
  // own messages. Rendered as an absolutely-positioned pill overlapping the
  // top edge of the bubble so it never affects the row's layout width (the
  // old side-by-side flex buttons could overflow a narrow mobile viewport
  // once more buttons were added).
  const hoverToolbar = toolbarVisible && (
    <div
      style={{
        position: "absolute",
        ...(toolbarBelow ? { top: "calc(100% + 4px)" } : { top: -34 }),
        ...(isOwn ? { right: 0 } : { left: 0 }),
        display: "flex",
        alignItems: "center",
        gap: 1,
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 999,
        padding: "3px 4px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.14)",
        zIndex: 40,
      }}
    >
      {canReact &&
        TOOLBAR_QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() =>
              void handleReactionChipClick(emoji, userReactedWith(emoji))
            }
            aria-label={`React with ${emoji}`}
            style={{ ...toolbarButtonStyle, fontSize: 16 }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1.25)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1)";
            }}
          >
            {emoji}
          </button>
        ))}
      {canReact && (
        <div style={{ position: "relative" }}>
          <button
            ref={plusButtonRef}
            onClick={() => setShowFullPicker((v) => !v)}
            aria-label="More reactions"
            style={{
              ...toolbarButtonStyle,
              color: showFullPicker
                ? "#3b82f6"
                : "hsl(var(--muted-foreground))",
            }}
          >
            <SmilePlus size={15} />
          </button>
          {showFullPicker && (
            <ReactionEmojiPicker
              anchorRef={plusButtonRef}
              isDark={isDark}
              align={isOwn ? "right" : "left"}
              onSelect={(emoji) => void handlePickEmoji(emoji)}
              onClose={() => setShowFullPicker(false)}
            />
          )}
        </div>
      )}
      {isOwn && canEdit && onEdit && (
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit message"
          style={{
            ...toolbarButtonStyle,
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <Pencil size={13} />
        </button>
      )}
      {isOwn && onDelete && (
        <button
          onClick={() => onDelete(message.id)}
          aria-label="Delete message"
          style={{ ...toolbarButtonStyle, color: "#ef4444" }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        // Don't close showFullPicker here — it floats above/below the
        // message row, so moving the mouse into it triggers mouseleave on
        // this div. ReactionEmojiPicker's own click-outside handler closes
        // it when the user clicks elsewhere.
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
        <div
          ref={bubbleWrapRef}
          style={{ maxWidth: 280, position: "relative" }}
        >
          {hoverToolbar}
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
      </div>

      {/* Timestamp + edited indicator + read receipt */}
      <div
        style={{
          fontSize: 10,
          color: "hsl(var(--muted-foreground))",
          marginTop: 2,
          paddingRight: isOwn ? 4 : 0,
          paddingLeft: isOwn ? 0 : 4,
          display: "flex",
          alignItems: "center",
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
        {isOwn && !isDeleted && !editing && (
          <ReadReceipt isRead={!!message.readAt} />
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
