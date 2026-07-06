import type { ReactNode } from "react";
import { Send, ArrowRight, Check, X } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ElaineAvatar, ElaineName } from "./ElaineAvatar";
import type { ElaineChat } from "./useElaineChat";

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

/** Strips stray markdown syntax the model may slip into a visible reply
 *  despite being told not to (the chat bubble has no markdown renderer, so
 *  **bold**, * bullets, and # headers would otherwise show up as literal
 *  asterisks/hashes). Belt-and-suspenders on top of the system prompt
 *  instruction — also cleans up any already-stored history. */
function stripStrayMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^([ \t]*)[*-]\s+/gm, "$1");
}

/** Renders message text with [N] citation markers turned into clickable links. */
function MessageText({
  text,
  citations,
}: {
  text: string;
  citations: string[];
}) {
  const cleaned = stripStrayMarkdown(text);
  if (citations.length === 0) return <>{cleaned}</>;
  const parts = cleaned.split(/(\[\d+\])/g);
  return (
    <>
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
        return <span key={i}>{part}</span>;
      })}
    </>
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
    handleSend,
    handleConfirmNavigate,
    handleConfirmAction,
    handleSkipAction,
    handleConfirmAll,
    handleCancelAll,
  } = chat;

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
                  className={`${bubbleWidthClass} whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground`}
                >
                  {msg.content}
                </div>
              </div>
            );
          }
          const { text, citations } = parseMessageCitations(msg.content);
          return (
            <div key={i} className="flex gap-2.5 justify-start">
              <ElaineAvatar size={avatarSize} className="mt-0.5" />
              <div className={`${bubbleWidthClass} flex flex-col gap-1.5`}>
                <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                  <MessageText text={text} citations={citations} />
                </div>
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
            <ElaineAvatar size={avatarSize} className="mt-0.5" />
            {streamingContent ? (
              <div
                className={`${bubbleWidthClass} whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground`}
              >
                {stripStrayMarkdown(streamingContent)}
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
                {pendingNavigate.path}
              </span>
              ?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleConfirmNavigate(onNavigated)}
              >
                <ArrowRight className="h-3 w-3 mr-1" />
                Yes, take me there
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setPendingNavigate(null)}
              >
                No thanks
              </Button>
            </div>
          </div>
        )}

        {pendingActions.length > 0 &&
          settings?.actionConfirmationMode === "all_at_once" && (
            <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">
                {pendingActions.length === 1
                  ? "1 thing"
                  : `${pendingActions.length} things`}{" "}
                to confirm:
              </p>
              <ul className="space-y-1">
                {pendingActions.map((action, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-foreground"
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    {action.label}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleConfirmAll}
                  disabled={confirmingAll}
                >
                  <Check className="h-3 w-3 mr-1" />
                  {confirmingAll ? "Doing it…" : "Yes, do all of it"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleCancelAll}
                  disabled={confirmingAll}
                >
                  Cancel all
                </Button>
              </div>
            </div>
          )}

        {pendingActions.length > 0 &&
          settings?.actionConfirmationMode !== "all_at_once" && (
            <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">
                {pendingActions[0]!.label}?
                {pendingActions.length > 1 && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    ({pendingActions.length} more after this)
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleConfirmAction}
                  disabled={executeAction.isPending}
                >
                  <Check className="h-3 w-3 mr-1" />
                  {executeAction.isPending ? "Doing it…" : "Yes, do it"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleSkipAction}
                  disabled={executeAction.isPending}
                >
                  No thanks
                </Button>
              </div>
            </div>
          )}

        {executedActions.length > 0 && (
          <div className="ml-8 flex flex-col gap-1 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              Already done automatically:
            </p>
            <ul className="space-y-1">
              {executedActions.map((action, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs text-foreground"
                >
                  {action.status < 400 ? (
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  ) : (
                    <X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                  )}
                  {action.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {actionDone && (
          <div className="ml-8 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3 w-3 text-primary" />
            Done!
          </div>
        )}

        {belowMessagesSlot}

        <div ref={endRef} />
      </div>

      <div className="flex gap-2 border-t border-border/50 p-3">
        {composerLeftSlot}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Elaine anything…"
          className="min-h-9 flex-1 resize-none"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={isStreaming}
        />
        <Button
          size="icon"
          onClick={() => handleSend()}
          disabled={!input.trim() || isStreaming}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}
