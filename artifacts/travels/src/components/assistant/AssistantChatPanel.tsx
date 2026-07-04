import { Link } from "wouter";
import {
  Send,
  ArrowRight,
  Check,
  Camera,
  X,
  CheckCircle2,
  HelpCircle,
  XCircle,
} from "lucide-react";
import type { MagnetCheckResult } from "@workspace/api-client-react";
import { getTripPhotoImageUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ElaineAvatar, ElaineName } from "./ElaineAvatar";
import type { AssistantChat } from "./useAssistantChat";

const MAGNET_VERDICT_COPY: Record<
  MagnetCheckResult["verdict"],
  { label: string; icon: React.ReactNode; className: string }
> = {
  likely_owned: {
    label: "You already have this magnet",
    icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    className: "bg-green-50 border-green-200 text-green-800",
  },
  possible_match: {
    label: "Possible match — take a closer look",
    icon: <HelpCircle className="h-4 w-4 text-amber-600" />,
    className: "bg-amber-50 border-amber-200 text-amber-800",
  },
  no_match: {
    label: "No match found — looks new!",
    icon: <XCircle className="h-4 w-4 text-muted-foreground" />,
    className: "bg-muted border-border text-muted-foreground",
  },
};

interface AssistantChatPanelProps {
  chat: AssistantChat;
  onNavigated?: () => void;
  avatarSize?: number;
  bubbleWidthClass?: string;
  emptyState?: React.ReactNode;
}

/**
 * Renders the full conversation log, pending-action/confirmation cards, the
 * magnet-check card, and the message composer. Shared by both the floating
 * widget and the full-screen chat page so every surface has identical tool
 * access — this is the single source of truth for how a turn is displayed.
 */
export function AssistantChatPanel({
  chat,
  onNavigated,
  avatarSize = 26,
  bubbleWidthClass = "max-w-[85%]",
  emptyState,
}: AssistantChatPanelProps) {
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
    magnetPreview,
    magnetResult,
    checkMagnet,
    magnetFileRef,
    endRef,
    executeAction,
    handleMagnetFileChange,
    dismissMagnetCheck,
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
                Hi, I'm <ElaineName />! Ask me anything about your trips, or
                whatever's on your screen.
              </p>
            </div>
          ))}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <ElaineAvatar size={avatarSize} className="mt-0.5" />
            )}
            <div
              className={`${bubbleWidthClass} whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "rounded-tr-sm bg-primary text-primary-foreground"
                  : "rounded-tl-sm bg-muted text-foreground"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="flex gap-2.5 justify-start">
            <ElaineAvatar size={avatarSize} className="mt-0.5" />
            {streamingContent ? (
              <div
                className={`${bubbleWidthClass} whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground`}
              >
                {streamingContent}
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

        {(magnetPreview || checkMagnet.isPending || magnetResult) && (
          <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start gap-3">
              {magnetPreview && (
                <img
                  src={magnetPreview}
                  alt="Magnet to check"
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                {checkMagnet.isPending && (
                  <p className="text-xs text-muted-foreground">
                    Checking your collection…
                  </p>
                )}
                {magnetResult && (
                  <div
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${MAGNET_VERDICT_COPY[magnetResult.verdict].className}`}
                  >
                    {MAGNET_VERDICT_COPY[magnetResult.verdict].icon}
                    {MAGNET_VERDICT_COPY[magnetResult.verdict].label}
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={dismissMagnetCheck}
                disabled={checkMagnet.isPending}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {magnetResult && magnetResult.matches.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Closest matches
                </p>
                {magnetResult.matches.map((match) => (
                  <Link
                    key={match.photoId}
                    href={`/trips/${match.tripId}`}
                    onClick={onNavigated}
                  >
                    <div className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/50 p-1.5 transition-colors hover:border-primary/30">
                      <img
                        src={getTripPhotoImageUrl(match.tripId, match.photoId)}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {match.tripTitle}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {Math.round(match.similarity * 100)}% similar
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="flex gap-2 border-t border-border/50 p-3">
        <input
          ref={magnetFileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={handleMagnetFileChange}
        />
        <Button
          size="icon"
          variant="outline"
          onClick={() => magnetFileRef.current?.click()}
          disabled={isStreaming || checkMagnet.isPending}
          title="Check if you already have this magnet"
        >
          <Camera className="h-4 w-4" />
        </Button>
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
