import { useRef, type ReactNode } from "react";
import { Send, ArrowRight, Check, X, Paperclip, Loader2, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ElaineAvatar, ElaineName } from "./ElaineAvatar";
import type { ElaineChat } from "./useElaineChat";
import { MarkdownMessage } from "./MarkdownMessage";
import { ChatWidget } from "./ChatWidgets";

/** Splits a stored message content into display text + citation URL list.
 *  \x1f (ASCII unit separator) is the delimiter — safe in PostgreSQL JSONB
 *  (unlike \x00) and never emitted by the model. */
function parseMessageCitations(content: string): {
  text: string;
  citations: string[];
} {
  const nullIdx = content.indexOf("\x1f");
  if (nullIdx === -1) return { text: content, citations: [] };
  const suffix = content.slice(nullIdx + 1);
  let citations: string[] = [];
  try {
    citations = JSON.parse(suffix);
    if (!Array.isArray(citations)) citations = [];
  } catch {
    citations = [];
  }
  return { text: content.slice(0, nullIdx), citations };
}

/** Renders message text with markdown + [N] citation markers turned into clickable links. */
function MessageText({
  text,
  citations,
}: {
  text: string;
  citations: string[];
}) {
  if (citations.length === 0) return <MarkdownMessage text={text} />;

  // Inject citation links as inline [N] markers inside the final text block
  // by replacing [N] references with anchor elements after markdown rendering.
  // For simplicity: split on [N] markers, render text blocks as markdown, links inline.
  const parts = text.split(/(\[\d+\])/g);
  return (
    <div className="space-y-0.5">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (m) {
          const idx = parseInt(m[1]!, 10) - 1;
          const url = citations[idx];
          if (url) {
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded bg-primary/10 px-0.5 text-xs font-semibold text-primary hover:bg-primary/20"
                onClick={(e) => e.stopPropagation()}
              >
                {part}
              </a>
            );
          }
        }
        return part ? <MarkdownMessage key={i} text={part} /> : null;
      })}
    </div>
  );
}

interface ElaineChatPanelProps {
  chat: ElaineChat;
  onNavigated?: () => void;
  avatarSize?: number;
  bubbleWidthClass?: string;
  emptyState?: ReactNode;
  /** Rendered before the message textarea, e.g. an app-specific attachment
   *  button (travels uses this for its magnet-check camera button). */
  composerLeftSlot?: ReactNode;
  /** Rendered above the composer, below the message list — for app-specific
   *  in-progress cards (travels uses this for the magnet-check result). */
  belowMessagesSlot?: ReactNode;
}

/**
 * Renders the full conversation log, pending-action/confirmation cards, and
 * the message composer. Shared by every Elaine surface (floating widget,
 * full-screen chat) across every app so tool access and confirmation UX
 * stay identical everywhere.
 */
export function ElaineChatPanel({
  chat,
  onNavigated,
  avatarSize = 26,
  bubbleWidthClass = "max-w-[85%]",
  emptyState,
  composerLeftSlot,
  belowMessagesSlot,
}: ElaineChatPanelProps) {
  const {
    settings,
    input,
    setInput,
    messages,
    messageWidgets,
    pendingNavigate,
    setPendingNavigate,
    pendingActions,
    confirmingAll,
    executedActions,
    actionDone,
    isStreaming,
    streamingContent,
    statusMessage,
    endRef,
    executeAction,
    pendingAttachments,
    handleAddAttachment,
    handleRemoveAttachment,
    handleSend,
    handleConfirmNavigate,
    handleConfirmAction,
    handleSkipAction,
    handleConfirmAll,
    handleCancelAll,
  } = chat;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasUploadingAttachments = pendingAttachments.some((a) => a.uploading);

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 &&
          !isStreaming &&
          (emptyState ?? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ElaineAvatar size={48} />
              <p className="text-sm text-muted-foreground">
                Hi, I'm <ElaineName />! Ask me anything, or whatever's on your
                screen.
              </p>
            </div>
          ))}

        {messages.map((msg, i) => {
          if (msg.role === "user") {
            return (
              <div key={i} className="flex gap-2.5 justify-end">
                <div
                  className={`${bubbleWidthClass} rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground`}
                >
                  {msg.attachmentUrls && msg.attachmentUrls.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {msg.attachmentUrls.map((url, j) => (
                        <img
                          key={j}
                          src={url}
                          alt=""
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {msg.content && (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            );
          }
          const { text, citations } = parseMessageCitations(msg.content);
          const widgets = messageWidgets.get(i);
          return (
            <div key={i} className="flex gap-2.5 justify-start">
              <ElaineAvatar
                size={avatarSize}
                className="mt-0.5"
                animated={false}
              />
              <div className={`${bubbleWidthClass} flex flex-col gap-1.5`}>
                <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                  <MessageText text={text} citations={citations} />
                </div>
                {widgets && widgets.length > 0 && (
                  <div className="flex flex-col gap-2 pl-0.5">
                    {widgets.map((widget, wi) => (
                      <ChatWidget key={wi} widget={widget} />
                    ))}
                  </div>
                )}
                {citations.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
                    {citations.map((url, ci) => {
                      let host = url;
                      try {
                        host = new URL(url).hostname.replace(/^www\./, "");
                      } catch {
                        // keep raw url
                      }
                      return (
                        <a
                          key={ci}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <span className="font-semibold text-primary">
                            [{ci + 1}]
                          </span>
                          <span className="max-w-[180px] truncate">{host}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isStreaming && (
          <div className="flex gap-2.5 justify-start">
            <ElaineAvatar
              size={avatarSize}
              className="mt-0.5"
              animated={false}
            />
            {streamingContent ? (
              <div
                className={`${bubbleWidthClass} rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground`}
              >
                <MarkdownMessage text={streamingContent} />
              </div>
            ) : statusMessage ? (
              <div
                className={`flex ${bubbleWidthClass} items-center gap-2 rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm text-muted-foreground`}
              >
                <span className="inline-flex gap-1 text-lg leading-none">
                  <span
                    className="animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  >
                    ·
                  </span>
                  <span
                    className="animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  >
                    ·
                  </span>
                  <span
                    className="animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  >
                    ·
                  </span>
                </span>
                <span>{statusMessage}</span>
              </div>
            ) : (
              <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-3 text-muted-foreground">
                <span className="inline-flex gap-1 text-lg leading-none">
                  <span
                    className="animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  >
                    ·
                  </span>
                  <span
                    className="animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  >
                    ·
                  </span>
                  <span
                    className="animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  >
                    ·
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {pendingNavigate && (
          <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              Take you to{" "}
              <span className="font-medium text-foreground">
                {pendingNavigate.reason}
              </span>
              ?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => {
                  handleConfirmNavigate(onNavigated);
                }}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                Go
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setPendingNavigate(null)}
              >
                Stay here
              </Button>
            </div>
          </div>
        )}

        {pendingActions.length > 0 && !actionDone && (
          <div className="ml-8 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            {settings?.actionConfirmationMode === "one_by_one" ? (
              <>
                <p className="text-xs font-medium text-foreground">
                  {pendingActions[0]!.label}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    disabled={executeAction.isPending}
                    onClick={handleConfirmAction}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={handleSkipAction}
                  >
                    <X className="h-3.5 w-3.5" />
                    Skip
                  </Button>
                </div>
                {pendingActions.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    +{pendingActions.length - 1} more
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-foreground">
                  {pendingActions.length} action
                  {pendingActions.length > 1 ? "s" : ""} ready
                </p>
                <ul className="space-y-1">
                  {pendingActions.map((action, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      • {action.label}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    disabled={confirmingAll}
                    onClick={handleConfirmAll}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Confirm all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={handleCancelAll}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {actionDone && executedActions.length > 0 && (
          <div className="ml-8 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2 dark:border-green-800 dark:bg-green-950/30">
            <p className="text-xs font-medium text-green-800 dark:text-green-300">
              <Check className="mr-1 inline h-3.5 w-3.5" />
              Done
            </p>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {belowMessagesSlot}

      {/* Pending attachment previews */}
      {pendingAttachments.length > 0 && (
        <div className="shrink-0 flex gap-2 flex-wrap border-t border-border/40 bg-background/80 px-3 pt-2 pb-1 backdrop-blur-sm">
          {pendingAttachments.map((a) => (
            <div
              key={a.previewUrl}
              className="relative h-14 shrink-0 rounded-lg overflow-hidden border border-border/50"
              style={{ width: a.fileType === "pdf" ? "auto" : "3.5rem", minWidth: "3.5rem" }}
            >
              {a.fileType === "pdf" ? (
                <div className="flex h-14 items-center gap-1.5 rounded-lg bg-muted px-2">
                  <FileText className="h-5 w-5 shrink-0 text-destructive" />
                  <span className="max-w-[120px] truncate text-xs text-foreground/80">
                    {a.fileName ?? "document.pdf"}
                  </span>
                </div>
              ) : (
                <img
                  src={a.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              {a.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                </div>
              )}
              {a.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
                  <X className="h-4 w-4 text-destructive" />
                </div>
              )}
              {!a.uploading && (
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(a.previewUrl)}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-background"
                  aria-label="Remove attachment"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 border-t border-border/60 bg-background/80 px-3 py-2.5 backdrop-blur-sm">
        {/* Hidden file input for paperclip */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleAddAttachment(file);
          }}
        />
        <div className="flex items-end gap-2">
          {composerLeftSlot}
          <Button
            size="icon"
            variant="ghost"
            className="h-[38px] w-[38px] shrink-0 rounded-xl"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || pendingAttachments.length >= 5}
            title="Attach an image"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Message Elaine…"
            className="min-h-[38px] flex-1 resize-none rounded-xl border-border/50 bg-muted/50 py-2 text-sm shadow-none focus-visible:ring-1"
            rows={1}
            disabled={isStreaming}
          />
          <Button
            size="sm"
            className="h-[38px] w-[38px] shrink-0 rounded-xl p-0"
            onClick={() => void handleSend()}
            disabled={
              (!input.trim() && pendingAttachments.every((a) => !a.uploadedUrl)) ||
              isStreaming ||
              hasUploadingAttachments
            }
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}
