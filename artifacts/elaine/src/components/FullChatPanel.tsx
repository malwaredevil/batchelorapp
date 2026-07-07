import { Link } from "wouter";
import { Camera, X, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { MagnetCheckResult } from "@workspace/api-client-react";
import { getTripPhotoImageUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  ElaineChatPanel,
  ElaineAvatar,
  ElaineName,
} from "@workspace/elaine-ui";
import type { FullChat } from "@/lib/useFullChat";

const MAGNET_VERDICT_COPY: Record<
  MagnetCheckResult["verdict"],
  { label: string; icon: ReactNode; className: string }
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

interface FullChatPanelProps {
  chat: FullChat;
  onNavigated?: () => void;
  avatarSize?: number;
  bubbleWidthClass?: string;
  emptyState?: ReactNode;
}

/**
 * Elaine's full-screen chat panel: the shared `ElaineChatPanel` handles the
 * conversation log, pending-action cards, and composer; this wrapper adds
 * the travels magnet-check camera button and result card via the panel's
 * pluggable slots. Magnet check is a travels-domain feature, but it lives
 * here (not in the shared widget) since it's only useful in the full,
 * "SUPER AI Agent" chat surface — it naturally stays inactive/empty when
 * the user isn't working with travel/magnet data.
 */
export function FullChatPanel({
  chat,
  onNavigated,
  avatarSize,
  bubbleWidthClass,
  emptyState,
}: FullChatPanelProps) {
  const {
    magnetPreview,
    magnetResult,
    checkMagnet,
    magnetFileRef,
    handleMagnetFileChange,
    dismissMagnetCheck,
    isStreaming,
  } = chat;

  return (
    <ElaineChatPanel
      chat={chat}
      onNavigated={onNavigated}
      avatarSize={avatarSize}
      bubbleWidthClass={bubbleWidthClass}
      emptyState={
        emptyState ?? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ElaineAvatar size={48} />
            <p className="text-sm text-muted-foreground">
              Hi, I'm <ElaineName />! Ask me anything about your pottery,
              quilting, or trips.
            </p>
          </div>
        )
      }
      composerLeftSlot={
        <>
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
        </>
      }
      belowMessagesSlot={
        (magnetPreview || checkMagnet.isPending || magnetResult) && (
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
                  <a
                    key={match.photoId}
                    href={`/travels/trips/${match.tripId}`}
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
                  </a>
                ))}
              </div>
            )}
          </div>
        )
      }
    />
  );
}
