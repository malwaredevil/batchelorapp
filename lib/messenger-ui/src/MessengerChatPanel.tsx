import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Paperclip, Loader2, MessageSquare } from "lucide-react";
import { useMessengerChat } from "./useMessengerChat";
import { MessageItem } from "./MessageItem";
import {
  useUploadAttachment,
  useListHouseholdMembers,
  type MessengerHouseholdMember,
} from "@workspace/api-client-react";
import type { MessengerSendMessageBody } from "@workspace/api-client-react";

interface MessengerChatPanelProps {
  currentUserId: number;
  isOpen: boolean;
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
  isOpen,
  prefillInput,
  onPrefillApplied,
}: MessengerChatPanelProps) {
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    NonNullable<MessengerSendMessageBody["attachments"]>
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const [mentionAnchor, setMentionAnchor] = useState<MentionAnchor | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages,
    isLoading,
    isSending,
    sendMessage,
    markRead,
    deleteMessage,
  } = useMessengerChat(isOpen);

  const { mutateAsync: uploadAttachment } = useUploadAttachment();
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
    const attachments = [...pendingAttachments];
    setInput("");
    setPendingAttachments([]);
    setMentionAnchor(null);
    await sendMessage(body, attachments);
  }, [input, pendingAttachments, sendMessage]);

  const selectMention = useCallback(
    (member: MemberEntry) => {
      if (!mentionAnchor) return;
      // Use first name only so @mentions never contain spaces — keeps them
      // unambiguous to parse server-side if we add per-person routing later.
      // The popup still shows the full name for disambiguation.
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
    setIsUploading(true);
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);
          return uploadAttachment({
            data: formData as unknown as { file: Blob },
          });
        }),
      );
      setPendingAttachments((prev) => [
        ...prev,
        ...results.map((r) => ({
          storagePath: r.storagePath,
          mimeType: r.mimeType,
          fileName: r.fileName,
          sizeBytes: r.sizeBytes,
        })),
      ]);
    } catch {
      // silent
    } finally {
      setIsUploading(false);
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
        background: "#fff",
        position: "relative",
      }}
    >
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
              color: "#9ca3af",
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
              color: "#9ca3af",
              fontSize: 13,
            }}
          >
            <MessageSquare size={28} strokeWidth={1.5} />
            <span>No messages yet</span>
            <span style={{ fontSize: 11, color: "#d1d5db" }}>
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
                  color: "#9ca3af",
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
                    onDelete={deleteMessage}
                  />
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <div
          style={{
            padding: "4px 12px",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            borderTop: "1px solid #f3f4f6",
          }}
        >
          {pendingAttachments.map((a, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 6,
                padding: "3px 8px",
                fontSize: 11,
                color: "#1d4ed8",
              }}
            >
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
                  color: "#93c5fd",
                  padding: 0,
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
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
            background: "#fff",
            border: "1px solid #e5e7eb",
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
              color: "#9ca3af",
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              borderBottom: "1px solid #f3f4f6",
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
                  background: isSelected ? "#eff6ff" : "transparent",
                  borderBottom:
                    i < filteredMembers.length - 1
                      ? "1px solid #f9fafb"
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
                  style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}
                >
                  {name}
                </span>
                {isElaine && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "#7c3aed",
                      background: "#f3e8ff",
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

      {/* Composer */}
      <div
        style={{
          padding: "8px 10px",
          borderTop: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          background: "#fafafa",
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
          disabled={isUploading}
          aria-label="Attach file"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9ca3af",
            padding: "6px",
            borderRadius: 8,
            display: "flex",
            flexShrink: 0,
          }}
        >
          {isUploading ? (
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
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "8px 12px",
            fontSize: 13,
            lineHeight: 1.4,
            fontFamily: "inherit",
            outline: "none",
            background: "#fff",
            maxHeight: 100,
            overflowY: "auto",
          }}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = `${Math.min(t.scrollHeight, 100)}px`;
          }}
        />

        <button
          onClick={handleSend}
          disabled={
            isSending || (!input.trim() && pendingAttachments.length === 0)
          }
          aria-label="Send message"
          style={{
            background:
              isSending || (!input.trim() && pendingAttachments.length === 0)
                ? "#e5e7eb"
                : "linear-gradient(135deg, #3b82f6, #2563eb)",
            border: "none",
            borderRadius: 10,
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor:
              isSending || (!input.trim() && pendingAttachments.length === 0)
                ? "not-allowed"
                : "pointer",
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {isSending ? (
            <Loader2
              size={16}
              style={{ animation: "spin 1s linear infinite" }}
            />
          ) : (
            <Send size={15} />
          )}
        </button>
      </div>
    </div>
  );
}
