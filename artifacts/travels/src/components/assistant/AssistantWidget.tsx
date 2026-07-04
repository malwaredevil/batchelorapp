import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import {
  MessageCircle,
  X,
  MoreVertical,
  RotateCcw,
  Maximize2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useGetAssistantNudgesUnseenCount,
  getGetAssistantNudgesUnseenCountQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ElaineAvatar, ElaineName, ElaineWordmark } from "./ElaineAvatar";
import { useAssistantChat } from "./useAssistantChat";
import { AssistantChatPanel } from "./AssistantChatPanel";

const HIDE_FOR_VISIT_KEY = "elaine_hidden_for_visit";

export function AssistantWidget() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [hiddenForVisit, setHiddenForVisit] = useState(
    () => sessionStorage.getItem(HIDE_FOR_VISIT_KEY) === "1",
  );

  const chat = useAssistantChat({ active: open });
  const { settings, updateSettings, messages, isStreaming, streamingContent } =
    chat;

  // Proactive nudges (e.g. "your trip starts in 2 days...") are computed by
  // a background job and surfaced as a badge on the closed floating button.
  // Polled while the widget is closed; opening it fetches the conversation,
  // which folds any unseen nudges into chat history server-side and marks
  // them seen, so we just need to drop the badge once that happens.
  const { data: unseenNudges } = useGetAssistantNudgesUnseenCount({
    query: {
      enabled: !open,
      refetchInterval: 2 * 60 * 1000,
      queryKey: getGetAssistantNudgesUnseenCountQueryKey(),
    },
  });

  useEffect(() => {
    if (open) chat.endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, isStreaming, streamingContent, chat.endRef]);

  // The full-screen chat page renders its own experience — hide the
  // floating widget there so there's only one Elaine surface on screen.
  const onFullScreenChat = location === "/elaine";

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
              <ElaineName /> is turned off. Re-enable her anytime from Settings.
            </>,
          );
        },
      },
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div className="flex h-[32rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <ElaineAvatar size={34} />
              <ElaineWordmark className="text-lg" />
            </div>
            <div className="flex items-center gap-1">
              <Link href="/elaine">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Open full-screen chat"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </Link>
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

          <AssistantChatPanel chat={chat} onNavigated={() => setOpen(false)} />
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
