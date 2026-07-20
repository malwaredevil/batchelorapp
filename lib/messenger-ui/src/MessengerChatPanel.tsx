import { useEffect, useRef, useState, useCallback } from "react";
import {
  Send,
  Paperclip,
  Loader2,
  MessageSquare,
  Sparkles,
  Trash2,
  Users,
  FileText,
} from "lucide-react";
import { useMessengerChat } from "./useMessengerChat";
import { MessageItem } from "./MessageItem";
import { useTypingIndicator } from "./useTypingIndicator";
import { TypingIndicator } from "./TypingIndicator";
import {
  useListHouseholdMembers,
  type MessengerHouseholdMember,
} from "@workspace/api-client-react";
import type { MessengerSendMessageBody } from "@workspace/api-client-react";

type PendingAttachment = NonNullable<
  MessengerSendMessageBody["attachments"]
>[number] & {
  previewUrl?: string;
};

interface UploadingFile {
  name: string;
  progress: number;
}

async function uploadFileWithProgress(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{
  storagePath: string;
  url: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/messenger/attachments/upload");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(
          JSON.parse(xhr.responseText) as {
            storagePath: string;
            url: string;
            mimeType: string;
            fileName: string;
            sizeBytes: number;
          },
        );
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

interface MessengerChatPanelProps {
  currentUserId: number;
  conversationId?: number;
  isOpen: boolean;
  /** When false the participants strip below the header is hidden.
   *  Use false in contexts (like the full messenger page) where the
   *  parent header already shows the participant list. Defaults to true. */
  showParticipants?: boolean;
  prefillInput?: string;
  onPrefillApplied?: () => void;
}

interface MentionAnchor {
  start: number;
  query: string;
  selectIdx: number;
}

type MemberEntry = { id: number; displayName: string | null; email: string };
const ELAINE_ENTRY: MemberEntry = {
  id: -1,
  displayName: "Elaine",
  email: "elaine@app.batchelor.app",
};

function memberName(m: MemberEntry): string {
  return m.displayName ?? m.email.split("@")[0] ?? "?";
}

function findMentionAnchor(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  for (let i = cursor - 1; i >= 0; i--) {
    if (text[i] === "@") {
      return { start: i, query: text.slice(i + 1, cursor) };
    }
    if (/\s/.test(text[i])) break;
  }
  return null;
}

function participantLabel(
  participants: Array<{ id: number; displayName?: string | null }>,
  currentUserId: number,
  isDirect: boolean,
): string {
  const subset = isDirect
    ? participants.filter((p) => p.id !== currentUserId)
    : participants;
  const names = subset.map((p) => p.displayName ?? `User ${p.id}`);
  if (names.length === 0) return "";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function groupByDate(
  messages: Array<{ createdAt: string; id: number }>,
): Array<{ date: string; ids: number[] }> {
  const groups: Array<{ date: string; ids: number[] }> = [];
  for (const m of messages) {
    const label = formatDateLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last?.date === label) {
      last.ids.push(m.id);
    } else {
      groups.push({ date: label, ids: [m.id] });
    }
  }
  return groups;
}

export function MessengerChatPanel({
  currentUserId,
  conversationId,
  isOpen,
  showParticipants = true,
  prefillInput,
  onPrefillApplied,
}: MessengerChatPanelProps) {
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [mentionAnchor, setMentionAnchor] = useState<MentionAnchor | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const {
    convId,
    currentConversation,
    messages,
    isLoading,
    isSending,
    sendMessage,
    markRead,
    deleteMessage,
    editMessage,
    clearConversation,
    addReaction,
    removeReaction,
  } = useMessengerChat(isOpen, conversationId);

  const typingNames = useTypingIndicator(convId ?? undefined, input);

  // The only editable message: the last non-deleted message sent by the current user,
  // AND it must be the last non-deleted message in the conversation overall.
  const nonDeletedMessages = messages.filter((m) => !m.deletedAt);
  const lastMsg = nonDeletedMessages[nonDeletedMessages.length - 1];
  const editableMessageId =
    lastMsg && lastMsg.senderId === currentUserId ? lastMsg.id : null;

  const handleClear = useCallback(async () => {
    await clearConversation();
    setShowClearConfirm(false);
  }, [clearConversation]);

  const { data: rawMembers = [] } = useListHouseholdMembers();

  const allMembers: MemberEntry[] = [
    ELAINE_ENTRY,
    ...(rawMembers as MessengerHouseholdMember[]).map((m) => ({
      id: m.id,
      displayName: m.displayName ?? null,
      email: m.email,
    })),
  ];

  const filteredMembers = mentionAnchor
    ? allMembers.filter((m) =>
        memberName(m)
          .toLowerCase()
          .startsWith(mentionAnchor.query.toLowerCase()),
      )
    : [];

  // Apply prefillInput from contacts panel
  useEffect(() => {
    if (!prefillInput) return;
    setInput(prefillInput);
    setMentionAnchor(null);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`;
        ta.focus();
        ta.setSelectionRange(prefillInput.length, prefillInput.length);
      }
      onPrefillApplied?.();
    }, 30);
  }, [prefillInput, onPrefillApplied]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, isOpen]);

  // Mark latest message as read when panel opens / new messages arrive
  useEffect(() => {
    if (!isOpen || messages.length === 0) return;
    const lastUnread = [...messages]
      .reverse()
      .find(
        (m) =>
          !m.readAt && (m.senderId === null || m.senderId !== currentUserId),
      );
    if (lastUnread) markRead(lastUnread.id);
  }, [isOpen, messages, currentUserId, markRead]);

  const handleSend = useCallback(async () => {
    const body = input.trim();
    if (!body && pendingAttachments.length === 0) return;
    const attachments = pendingAttachments.map(
      ({ previewUrl: _p, ...rest }) => rest,
    );
    pendingAttachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setInput("");
    setPendingAttachments([]);
    setMentionAnchor(null);
    await sendMessage(body, attachments);
  }, [input, pendingAttachments, sendMessage]);

  const selectMention = useCallback(
    (member: MemberEntry) => {
      if (!mentionAnchor) return;
      const name = memberName(member).split(" ")[0] ?? memberName(member);
      const before = input.slice(0, mentionAnchor.start);
      const after = input.slice(
        mentionAnchor.start + 1 + mentionAnchor.query.length,
      );
      const newInput = `${before}@${name} ${after}`;
      setInput(newInput);
      setMentionAnchor(null);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.style.height = "auto";
          ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`;
          ta.focus();
          const pos = before.length + name.length + 2;
          ta.setSelectionRange(pos, pos);
        }
      }, 0);
    },
    [input, mentionAnchor],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setInput(val);
    const anchor = findMentionAnchor(val, cursor);
    if (anchor) {
      const q = anchor.query;
      const matches = allMembers.filter((m) =>
        memberName(m).toLowerCase().startsWith(q.toLowerCase()),
      );
      setMentionAnchor(matches.length > 0 ? { ...anchor, selectIdx: 0 } : null);
    } else {
      setMentionAnchor(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionAnchor && filteredMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionAnchor((prev) =>
          prev
            ? {
                ...prev,
                selectIdx: (prev.selectIdx + 1) % filteredMembers.length,
              }
            : null,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionAnchor((prev) =>
          prev
            ? {
                ...prev,
                selectIdx:
                  (prev.selectIdx - 1 + filteredMembers.length) %
                  filteredMembers.length,
              }
            : null,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectMention(filteredMembers[mentionAnchor.selectIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionAnchor(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const previews = files.map((f) =>
      f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    );
    setUploadingFiles(files.map((f) => ({ name: f.name, progress: 0 })));
    try {
      const results = await Promise.all(
        files.map((file, i) =>
          uploadFileWithProgress(file, (pct) => {
            setUploadingFiles((prev) =>
              prev.map((u, j) => (j === i ? { ...u, progress: pct } : u)),
            );
          }),
        ),
      );
      setPendingAttachments((prev) => [
        ...prev,
        ...results.map((r, i) => ({
          storagePath: r.storagePath,
          mimeType: r.mimeType,
          fileName: r.fileName,
          sizeBytes: r.sizeBytes,
          previewUrl: previews[i],
        })),
      ]);
    } catch {
      previews.forEach((p) => {
        if (p) URL.revokeObjectURL(p);
      });
    } finally {
      setUploadingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const dateGroups = groupByDate(messages);
  const msgById = new Map(messages.map((m) => [m.id, m]));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "hsl(var(--card))",
        position: "relative",
      }}
    >
      {/* Participants strip — only shown when requested (e.g. widget) */}
      {showParticipants &&
        currentConversation?.participants &&
        currentConversation.participants.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 12px",
              borderBottom: "1px solid hsl(var(--border))",
              background: "hsl(var(--muted))",
              flexShrink: 0,
              minHeight: 28,
            }}
          >
            <Users
              size={11}
              style={{
                color: "hsl(var(--muted-foreground))",
                flexShrink: 0,
                marginTop: 1,
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: "hsl(var(--muted-foreground))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentConversation.isDirect ? "Chat with " : "Members: "}
              <span
                style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
              >
                {participantLabel(
                  currentConversation.participants,
                  currentUserId,
                  currentConversation.isDirect ?? false,
                )}
              </span>
            </span>
          </div>
        )}

      {/* Clear history bar */}
      {nonDeletedMessages.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "3px 12px",
            borderBottom: "1px solid hsl(var(--border))",
          }}
        >
          {showClearConfirm ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "hsl(var(--foreground))",
              }}
            >
              <span>Clear all messages?</span>
              <button
                onClick={() => void handleClear()}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: 5,
                  padding: "2px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  background: "hsl(var(--muted))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 5,
                  padding: "2px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                  color: "hsl(var(--foreground))",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowClearConfirm(true)}
              title="Clear conversation history"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "hsl(var(--muted-foreground))",
                padding: "2px 4px",
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                borderRadius: 4,
              }}
            >
              <Trash2 size={11} />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Message list */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: 12,
          paddingBottom: 8,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {isLoading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <Loader2
              size={20}
              style={{ animation: "spin 1s linear infinite" }}
            />
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 8,
              color: "hsl(var(--muted-foreground))",
              fontSize: 13,
            }}
          >
            <MessageSquare size={28} strokeWidth={1.5} />
            <span>No messages yet</span>
            <span
              style={{
                fontSize: 11,
                color: "hsl(var(--muted-foreground))",
                opacity: 0.6,
              }}
            >
              Say hi, or try @elaine
            </span>
          </div>
        ) : (
          dateGroups.map((group) => (
            <div key={group.date}>
              <div
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  color: "hsl(var(--muted-foreground))",
                  padding: "8px 0 4px",
                  userSelect: "none",
                }}
              >
                {group.date}
              </div>
              {group.ids.map((id) => {
                const msg = msgById.get(id);
                if (!msg) return null;
                return (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    isOwn={msg.senderId === currentUserId}
                    canEdit={msg.id === editableMessageId}
                    onDelete={deleteMessage}
                    onEdit={editMessage}
                    onAddReaction={addReaction}
                    onRemoveReaction={removeReaction}
                  />
                );
              })}
            </div>
          ))
        )}
        {/* Elaine typing indicator — shown while waiting for her reply */}
        {isSending && (
          <div
            style={{
              padding: "2px 12px",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
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
            <div
              style={{
                background: "rgba(109, 40, 217, 0.07)",
                border: "1px solid rgba(109, 40, 217, 0.15)",
                borderRadius: "16px 16px 16px 4px",
                padding: "10px 16px",
                display: "flex",
                gap: 5,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#8b5cf6",
                  display: "inline-block",
                  animation: "bounce 1s infinite",
                }}
              />
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#8b5cf6",
                  display: "inline-block",
                  animation: "bounce 1s infinite",
                  animationDelay: "0.15s",
                }}
              />
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#8b5cf6",
                  display: "inline-block",
                  animation: "bounce 1s infinite",
                  animationDelay: "0.3s",
                }}
              />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Upload progress bars */}
      {uploadingFiles.length > 0 && (
        <div
          style={{
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            borderTop: "1px solid hsl(var(--border))",
          }}
        >
          {uploadingFiles.map((uf, i) => (
            <div key={i}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "hsl(var(--muted-foreground))",
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {uf.name}
                </span>
                <span>{uf.progress}%</span>
              </div>
              <div
                style={{
                  height: 3,
                  background: "hsl(var(--border))",
                  borderRadius: 9999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${uf.progress}%`,
                    background: "#3b82f6",
                    borderRadius: 9999,
                    transition: "width 0.1s ease",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <div
          style={{
            padding: "6px 12px",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            borderTop:
              uploadingFiles.length === 0
                ? "1px solid hsl(var(--border))"
                : undefined,
          }}
        >
          {pendingAttachments.map((a, i) =>
            a.mimeType.startsWith("image/") && a.previewUrl ? (
              <div
                key={i}
                style={{ position: "relative", display: "inline-flex" }}
              >
                <img
                  src={a.previewUrl}
                  alt={a.fileName}
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: "cover",
                    borderRadius: 6,
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <button
                  onClick={() => {
                    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
                    setPendingAttachments((prev) =>
                      prev.filter((_, j) => j !== i),
                    );
                  }}
                  aria-label={`Remove ${a.fileName}`}
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -5,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "#1e293b",
                    border: "none",
                    cursor: "pointer",
                    color: "#fff",
                    fontSize: 10,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "rgba(59,130,246,0.08)",
                  border: "1px solid rgba(59,130,246,0.25)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  color: "#3b82f6",
                }}
              >
                <FileText size={12} />
                <span
                  style={{
                    maxWidth: 120,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.fileName}
                </span>
                <button
                  onClick={() =>
                    setPendingAttachments((prev) =>
                      prev.filter((_, j) => j !== i),
                    )
                  }
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#3b82f6",
                    opacity: 0.6,
                    padding: 0,
                    fontSize: 13,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {/* @mention autocomplete popup */}
      {mentionAnchor && filteredMembers.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 58,
            left: 8,
            right: 8,
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 10,
            boxShadow:
              "0 -4px 20px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.06)",
            zIndex: 100,
            overflow: "hidden",
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "5px 12px 3px",
              fontSize: 10,
              color: "hsl(var(--muted-foreground))",
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              borderBottom: "1px solid hsl(var(--border))",
            }}
          >
            Mention
          </div>
          {filteredMembers.map((m, i) => {
            const name = memberName(m);
            const isElaine = m.id === -1;
            const isSelected = i === mentionAnchor.selectIdx;
            return (
              <div
                key={m.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(m);
                }}
                style={{
                  padding: "7px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  background: isSelected
                    ? "rgba(59,130,246,0.1)"
                    : "transparent",
                  borderBottom:
                    i < filteredMembers.length - 1
                      ? "1px solid hsl(var(--border))"
                      : "none",
                }}
                onMouseEnter={() =>
                  setMentionAnchor((prev) =>
                    prev ? { ...prev, selectIdx: i } : null,
                  )
                }
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: isElaine
                      ? "linear-gradient(135deg, #7c3aed, #4f46e5)"
                      : "linear-gradient(135deg, #3b82f6, #2563eb)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: isElaine ? 11 : 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {isElaine ? "✦" : (name[0]?.toUpperCase() ?? "?")}
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "hsl(var(--foreground))",
                  }}
                >
                  {name}
                </span>
                {isElaine && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "#7c3aed",
                      background: "rgba(124,58,237,0.1)",
                      borderRadius: 4,
                      padding: "1px 5px",
                      fontWeight: 600,
                      marginLeft: "auto",
                    }}
                  >
                    AI
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Typing indicator */}
      <TypingIndicator names={typingNames} />

      {/* Composer */}
      <div
        style={{
          padding: "8px 10px",
          borderTop: "1px solid hsl(var(--border))",
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          background: "hsl(var(--muted))",
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: "none" }}
          accept="image/*,application/pdf"
          multiple
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingFiles.length > 0}
          aria-label="Attach file"
          style={{
            background: "none",
            border: "none",
            cursor: uploadingFiles.length > 0 ? "default" : "pointer",
            color:
              uploadingFiles.length > 0
                ? "#3b82f6"
                : "hsl(var(--muted-foreground))",
            padding: "6px",
            borderRadius: 8,
            display: "flex",
            flexShrink: 0,
          }}
        >
          {uploadingFiles.length > 0 ? (
            <Loader2
              size={18}
              style={{ animation: "spin 1s linear infinite" }}
            />
          ) : (
            <Paperclip size={18} />
          )}
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message… (@elaine to ask AI)"
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid hsl(var(--border))",
            borderRadius: 10,
            padding: "7px 12px",
            fontSize: 14,
            lineHeight: 1.5,
            outline: "none",
            fontFamily: "inherit",
            background: "hsl(var(--card))",
            color: "hsl(var(--foreground))",
            maxHeight: 100,
            overflowY: "auto",
          }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={
            isSending || (!input.trim() && pendingAttachments.length === 0)
          }
          aria-label="Send message"
          style={{
            background:
              isSending || (!input.trim() && pendingAttachments.length === 0)
                ? "hsl(var(--muted-foreground))"
                : "#3b82f6",
            border: "none",
            borderRadius: 10,
            cursor:
              isSending || (!input.trim() && pendingAttachments.length === 0)
                ? "default"
                : "pointer",
            color: "#fff",
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            opacity:
              isSending || (!input.trim() && pendingAttachments.length === 0)
                ? 0.45
                : 1,
            transition: "opacity 0.15s, background 0.15s",
          }}
        >
          {isSending ? (
            <Loader2
              size={16}
              style={{ animation: "spin 1s linear infinite" }}
            />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
