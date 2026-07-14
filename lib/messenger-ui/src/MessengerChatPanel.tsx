import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Paperclip, Loader2, MessageSquare } from "lucide-react";
import { useMessengerChat } from "./useMessengerChat";
import { MessageItem } from "./MessageItem";
import { useUploadAttachment } from "@workspace/api-client-react";
import type { MessengerSendMessageBody } from "@workspace/api-client-react";

interface MessengerChatPanelProps {
  currentUserId: number;
  isOpen: boolean;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
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

export function MessengerChatPanel({ currentUserId, isOpen }: MessengerChatPanelProps) {
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    NonNullable<MessengerSendMessageBody["attachments"]>
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { messages, isLoading, isSending, sendMessage, markRead, deleteMessage, convId } =
    useMessengerChat(isOpen);

  const { mutateAsync: uploadAttachment } = useUploadAttachment();

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
      .find((m) => !m.readAt && (m.senderId === null || m.senderId !== currentUserId));
    if (lastUnread) markRead(lastUnread.id);
  }, [isOpen, messages, currentUserId, markRead]);

  const handleSend = useCallback(async () => {
    const body = input.trim();
    if (!body && pendingAttachments.length === 0) return;
    const attachments = [...pendingAttachments];
    setInput("");
    setPendingAttachments([]);
    await sendMessage(body, attachments);
  }, [input, pendingAttachments, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
          return uploadAttachment({ data: formData as unknown as { file: Blob } });
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
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
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
            <span style={{ fontSize: 11, color: "#d1d5db" }}>Say hi, or try @elaine</span>
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
                  setPendingAttachments((prev) => prev.filter((_, j) => j !== i))
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
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <Paperclip size={18} />
          )}
        </button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
          disabled={isSending || (!input.trim() && pendingAttachments.length === 0)}
          aria-label="Send message"
          style={{
            background: isSending || (!input.trim() && pendingAttachments.length === 0)
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
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <Send size={15} />
          )}
        </button>
      </div>
    </div>
  );
}
