import { useEffect, useState } from "react";
import {
  MessageCircle,
  X,
  MoreVertical,
  RotateCcw,
  Maximize2,
  Settings as SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  useGetElaineNudgesUnseenCount,
  getGetElaineNudgesUnseenCountQueryKey,
  type ElaineAppId,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ElaineAvatar, ElaineName, ElaineWordmark } from "./ElaineAvatar";
import { useElaineChat } from "./useElaineChat";
import { ElaineChatPanel } from "./ElaineChatPanel";

const HIDE_FOR_VISIT_KEY = "elaine_hidden_for_visit";

// Desktop popup dimensions per size preference. All are capped by
// max-w-[calc(100vw-2rem)]/max-h so small viewports (mobile) never overflow
// regardless of which size is picked — mobile effectively always gets the
// screen-width behavior the user expects there.
const CHAT_WINDOW_SIZE_CLASSES: Record<string, string> = {
  compact: "h-[28rem] w-[20rem]",
  comfortable: "h-[32rem] w-[24rem]",
  large: "h-[38rem] w-[28rem]",
};

export function ElaineWidget({
  appId,
  fullScreenPath,
  currentPath,
}: {
  appId: ElaineAppId;
  /** If provided, shows a "full-screen chat" link pointing at this route
   *  (e.g. travels' `/elaine`). Omit for apps with no full-screen surface. */
  fullScreenPath?: string;
  /** Current route, used to hide the widget while the full-screen chat page
   *  itself is open (so there's only one Elaine surface on screen). */
  currentPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hiddenForVisit, setHiddenForVisit] = useState(
    () => sessionStorage.getItem(HIDE_FOR_VISIT_KEY) === "1",
  );

  const chat = useElaineChat({ appId, active: open });
  const { settings, updateSettings, messages, isStreaming, streamingContent } =
    chat;

  // Proactive nudges (e.g. "your trip starts in 2 days...") are computed by
  // a background job and surfaced as a badge on the closed floating button.
  // Polled while the widget is closed; opening it fetches the conversation,
  // which folds any unseen nudges into chat history server-side and marks
  // them seen, so we just need to drop the badge once that happens.
  const { data: unseenNudges } = useGetElaineNudgesUnseenCount({
    query: {
      enabled: !open,
      refetchInterval: 2 * 60 * 1000,
      queryKey: getGetElaineNudgesUnseenCountQueryKey(),
    },
  });

  useEffect(() => {
    if (open) chat.endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, isStreaming, streamingContent, chat.endRef]);

  const onFullScreenChat =
    fullScreenPath !== undefined && currentPath === fullScreenPath;

  if (!settings?.enabled || hiddenForVisit || onFullScreenChat) {
    return null;
  }

  function handleHideForVisit() {
    sessionStorage.setItem(HIDE_FOR_VISIT_KEY, "1");
    setHiddenForVisit(true);
    setOpen(false);
  }

  function handleTurnOff() {
    updateSettings.mutate(
      { enabled: false },
      {
        onSuccess: () => {
          setOpen(false);
          toast.info(
            <>
              <ElaineName /> is turned off. Re-enable her anytime from settings.
            </>,
          );
        },
      },
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div
          className={`flex max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-2xl ${
            CHAT_WINDOW_SIZE_CLASSES[settings?.chatWindowSize ?? "compact"]
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <ElaineAvatar size={34} />
              <ElaineWordmark className="text-lg" />
            </div>
            <div className="flex items-center gap-1">
              {fullScreenPath && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Open full-screen chat"
                  onClick={() => {
                    // fullScreenPath may point at a different deployed
                    // artifact (e.g. "/elaine/" from pottery/quilting/hub),
                    // which is a separate SPA bundle entirely. A client-side
                    // router Link can't cross that boundary, so this must
                    // always be a hard navigation.
                    window.location.href = fullScreenPath;
                  }}
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onSelect={chat.handleNewConversation}
                    className="cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-2" />
                    New conversation
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      // Elaine's config always lives in the standalone
                      // Elaine app, regardless of which sub-app the widget
                      // is mounted in — same cross-bundle caveat as
                      // fullScreenPath above.
                      window.location.href = "/elaine/settings";
                    }}
                    className="cursor-pointer"
                  >
                    <SettingsIcon className="h-3.5 w-3.5 mr-2" />
                    <ElaineName /> settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={handleHideForVisit}
                    className="cursor-pointer"
                  >
                    Hide for this visit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handleTurnOff}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    Turn off <ElaineName />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ElaineChatPanel chat={chat} onNavigated={() => setOpen(false)} />
        </div>
      )}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="relative flex items-center gap-2 rounded-full border border-card-border bg-card py-2 pl-2 pr-4 shadow-lg transition-transform hover:scale-105"
          aria-label={
            unseenNudges && unseenNudges.count > 0
              ? `Open Elaine assistant (${unseenNudges.count} new)`
              : "Open Elaine assistant"
          }
        >
          {unseenNudges && unseenNudges.count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold leading-none text-destructive-foreground">
              {unseenNudges.count > 9 ? "9+" : unseenNudges.count}
            </span>
          )}
          <ElaineAvatar size={36} />
          <span className="flex items-center gap-1 text-sm font-medium">
            <ElaineWordmark />
          </span>
          <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
