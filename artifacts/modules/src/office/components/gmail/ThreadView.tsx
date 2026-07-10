import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  Archive,
  Trash2,
  Mail,
  MailOpen,
  Star,
  Reply,
  ReplyAll,
  Forward,
  Paperclip,
  Download,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  FullThread,
  ThreadMessage,
  ComposeParams,
} from "@workspace/gmail-ui";
import { attachmentUrl } from "@workspace/gmail-ui";
import { Skeleton } from "@/components/ui/skeleton";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseFrom(from: string): {
  name: string;
  email: string;
  initials: string;
} {
  if (!from) return { name: "?", email: "", initials: "?" };
  const match = from.match(/^"?(.+?)"?\s*<(.+?)>$/);
  const name = match ? match[1].trim() : from;
  const email = match ? match[2] : from;
  const words = name.split(/\s+/);
  const initials =
    words.length > 1
      ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  return { name, email, initials };
}

function getAvatarColor(email: string): string {
  const colors = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-fuchsia-500",
    "bg-teal-500",
  ];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return colors[hash % colors.length]!;
}

// ── HTML email iframe ─────────────────────────────────────────────────────────

function HtmlBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      try {
        const body = iframe.contentDocument?.body;
        if (body) {
          // A small delay lets images/fonts settle
          setTimeout(
            () => setHeight(Math.max(100, body.scrollHeight + 20)),
            50,
          );
        }
      } catch {
        /* cross-origin fallback */
      }
    };
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [html]);

  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; padding: 12px; font-family: Arial, sans-serif; font-size: 14px;
         line-height: 1.5; color: #111; background: transparent; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #1a73e8; }
  blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 12px; color: #555; }
  table { max-width: 100%; }
</style>
</head><body>${html}</body></html>`;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={doc}
      sandbox="allow-same-origin"
      className="w-full border-none"
      style={{ height: `${height}px` }}
      title="Email content"
    />
  );
}

// ── Single expanded message ───────────────────────────────────────────────────

function MessageBody({ msg }: { msg: ThreadMessage }) {
  const { name, email, initials } = parseFrom(msg.from);
  const avatarColor = getAvatarColor(email);

  return (
    <div className="flex-1 min-w-0 pt-1">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0",
            avatarColor,
          )}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{name}</div>
          <div className="text-xs text-muted-foreground truncate">
            to {msg.to}
            {msg.cc && `, cc: ${msg.cc}`}
          </div>
        </div>
        <div className="text-xs text-muted-foreground flex-shrink-0">
          {formatDate(msg.date)}
        </div>
      </div>

      {/* Body */}
      <div className="pl-11">
        {msg.htmlBody ? (
          <HtmlBody html={msg.htmlBody} />
        ) : (
          <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
            {msg.textBody || "(empty)"}
          </pre>
        )}

        {/* Attachments */}
        {msg.attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {msg.attachments.map((att) => (
              <a
                key={att.attachmentId}
                href={attachmentUrl(msg.id, att.attachmentId, att.filename)}
                download={att.filename}
                className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <Paperclip className="w-4 h-4 text-muted-foreground" />
                <span className="max-w-[200px] truncate">{att.filename}</span>
                {att.size > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {att.size > 1024 * 1024
                      ? `${(att.size / 1024 / 1024).toFixed(1)}MB`
                      : `${Math.round(att.size / 1024)}KB`}
                  </span>
                )}
                <Download className="w-3.5 h-3.5 text-muted-foreground" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsed message row ─────────────────────────────────────────────────────

function CollapsedMessage({
  msg,
  onClick,
}: {
  msg: ThreadMessage;
  onClick: () => void;
}) {
  const { name } = parseFrom(msg.from);
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors rounded-lg group"
    >
      <div className="text-sm font-medium text-foreground/80 group-hover:text-foreground">
        {name}
      </div>
      <div className="flex-1 text-sm text-muted-foreground truncate">
        {msg.snippet}
      </div>
      <div className="text-xs text-muted-foreground flex-shrink-0">
        {formatDate(msg.date)}
      </div>
    </button>
  );
}

// ── Thread view ───────────────────────────────────────────────────────────────

interface ThreadViewProps {
  thread: FullThread | undefined;
  isLoading: boolean;
  onBack: () => void;
  onReply: (params: Partial<ComposeParams>) => void;
  onArchive: (messageId: string) => void;
  onTrash: (messageId: string) => void;
  onToggleStar: (msg: ThreadMessage) => void;
  onToggleRead: (msg: ThreadMessage) => void;
}

export function ThreadView({
  thread,
  isLoading,
  onBack,
  onReply,
  onArchive,
  onTrash,
  onToggleStar,
  onToggleRead,
}: ThreadViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Auto-expand the latest message + any unread ones
  useEffect(() => {
    if (!thread?.messages.length) return;
    const msgs = thread.messages;
    const toExpand = new Set<string>();
    toExpand.add(msgs[msgs.length - 1]!.id);
    for (const m of msgs) {
      if (m.isUnread) toExpand.add(m.id);
    }
    setExpandedIds(toExpand);
  }, [thread?.id]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!thread && isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <div className="flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="w-32 h-4" />
            <Skeleton className="w-48 h-3" />
          </div>
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!thread) return null;
  const safeThread = thread;
  const lastMsg = safeThread.messages[safeThread.messages.length - 1]!;
  const subject = safeThread.messages[0]?.subject ?? "(no subject)";

  function handleReply(all = false) {
    const replyTo = lastMsg.replyTo || lastMsg.from;
    const toPart = all
      ? [lastMsg.from, lastMsg.to]
          .filter((x) => x && x !== lastMsg.from)
          .join(", ")
      : replyTo;

    onReply({
      to: toPart,
      cc: all ? lastMsg.cc : undefined,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      inReplyTo: lastMsg.messageIdHeader,
      references: [lastMsg.inReplyToHeader, lastMsg.messageIdHeader]
        .filter(Boolean)
        .join(" "),
      threadId: safeThread.id,
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="h-8 w-8"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-1 ml-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Archive thread"
            onClick={() => onArchive(lastMsg.id)}
          >
            <Archive className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Trash thread"
            onClick={() => onTrash(lastMsg.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Subject */}
        <div className="px-6 pt-5 pb-4">
          <h2 className="text-xl font-semibold text-foreground leading-tight">
            {subject}
          </h2>
        </div>

        {/* Messages */}
        <div className="px-4 pb-6 space-y-3">
          {safeThread.messages.map((msg, idx) => {
            const isExpanded = expandedIds.has(msg.id);
            const isLast = idx === safeThread.messages.length - 1;

            return (
              <div
                key={msg.id}
                className={cn(
                  "rounded-2xl border bg-card transition-shadow",
                  isExpanded ? "border-border shadow-sm" : "border-transparent",
                )}
              >
                {isExpanded ? (
                  <div className="p-5">
                    <div className="flex gap-3">
                      <MessageBody msg={msg} />
                      {/* Per-message actions */}
                      <div className="flex-shrink-0 flex flex-col items-end gap-1 ml-2">
                        <button
                          onClick={() => onToggleStar(msg)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title={msg.isStarred ? "Unstar" : "Star"}
                        >
                          <Star
                            className={cn(
                              "w-4 h-4",
                              msg.isStarred
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-muted-foreground",
                            )}
                          />
                        </button>
                        <button
                          onClick={() => onToggleRead(msg)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title={msg.isUnread ? "Mark read" : "Mark unread"}
                        >
                          {msg.isUnread ? (
                            <MailOpen className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <Mail className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                        <button
                          onClick={() => toggleExpand(msg.id)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                        >
                          <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>

                    {/* Reply buttons on last message */}
                    {isLast && (
                      <div className="mt-5 pl-11 flex gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full gap-1.5"
                          onClick={() => handleReply(false)}
                        >
                          <Reply className="w-3.5 h-3.5" /> Reply
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full gap-1.5"
                          onClick={() => handleReply(true)}
                        >
                          <ReplyAll className="w-3.5 h-3.5" /> Reply all
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full gap-1.5"
                          onClick={() =>
                            onReply({
                              subject: `Fwd: ${subject}`,
                              body: `\n\n---------- Forwarded message ----------\nFrom: ${msg.from}\nDate: ${formatDate(msg.date)}\nSubject: ${msg.subject}\n\n${msg.textBody}`,
                            })
                          }
                        >
                          <Forward className="w-3.5 h-3.5" /> Forward
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <CollapsedMessage
                    msg={msg}
                    onClick={() => toggleExpand(msg.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
