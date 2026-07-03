import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import {
  MessageCircle,
  X,
  MoreVertical,
  Send,
  ArrowRight,
  RotateCcw,
  Check,
  Camera,
  CheckCircle2,
  HelpCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  useGetAssistantConversation,
  streamAssistantMessage,
  useNewAssistantConversation,
  useGetAssistantSettings,
  useUpdateAssistantSettings,
  useExecuteAssistantAction,
  useGetAssistantNudgesUnseenCount,
  useCheckMagnet,
  getTripPhotoImageUrl,
  getGetAssistantConversationQueryKey,
  getGetAssistantSettingsQueryKey,
  getGetAssistantNudgesUnseenCountQueryKey,
  getListTripsQueryKey,
  getListWishlistQueryKey,
  getGetTripQueryKey,
  getGetCalendarStatusQueryKey,
  getListCalendarsQueryKey,
  type AssistantMessage,
  type AssistantAction,
  type ExecutedAssistantAction,
  type MagnetCheckResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ElaineAvatar, ElaineWordmark } from "./ElaineAvatar";
import { useAssistantPageContextReader } from "@/lib/assistant-context";

const HIDE_FOR_VISIT_KEY = "elaine_hidden_for_visit";

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

export function AssistantWidget() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const getPageContext = useAssistantPageContextReader();

  const [open, setOpen] = useState(false);
  const [hiddenForVisit, setHiddenForVisit] = useState(
    () => sessionStorage.getItem(HIDE_FOR_VISIT_KEY) === "1",
  );
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [pendingNavigate, setPendingNavigate] = useState<{ path: string; reason: string } | null>(null);
  // Actions elAIne proposed this turn, still awaiting confirmation. In
  // one_by_one mode only the first entry is shown at a time; in
  // all_at_once mode they're all shown together with a single confirm/cancel.
  const [pendingActions, setPendingActions] = useState<AssistantAction[]>([]);
  const [confirmingAll, setConfirmingAll] = useState(false);
  // Actions elAIne already ran on her own this turn (auto_run mode) — shown
  // as a summary instead of a confirmation card, since there's nothing left
  // to confirm.
  const [executedActions, setExecutedActions] = useState<ExecutedAssistantAction[]>([]);
  const [actionDone, setActionDone] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  // Magnet duplicate-photo check: bypasses the normal chat/tool-call loop
  // entirely and hits the same /magnets/check endpoint the standalone
  // MagnetCheckDialog uses, since it needs an actual image upload rather
  // than a text tool call. Shown as its own ephemeral card below the chat
  // log rather than woven into `messages` (which is server-persisted text
  // only), so it resets on new conversation / next message and doesn't
  // survive a reload.
  const [magnetPreview, setMagnetPreview] = useState<string | null>(null);
  const [magnetResult, setMagnetResult] = useState<MagnetCheckResult | null>(null);
  const magnetFileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useGetAssistantSettings();
  const updateSettings = useUpdateAssistantSettings();
  const { data: conversation } = useGetAssistantConversation({
    query: { enabled: open && !initialized, queryKey: getGetAssistantConversationQueryKey() },
  });
  const newConversation = useNewAssistantConversation();
  const executeAction = useExecuteAssistantAction();
  const checkMagnet = useCheckMagnet({
    mutation: {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Check failed"),
    },
  });
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
    if (conversation && !initialized) {
      setMessages(conversation.messages);
      setInitialized(true);
      qc.invalidateQueries({ queryKey: getGetAssistantNudgesUnseenCountQueryKey() });
    }
  }, [conversation, initialized, qc]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, isStreaming, streamingContent]);

  if (!settings?.enabled || hiddenForVisit) {
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
          toast.info("elAIne is turned off. Re-enable her anytime from Settings.");
        },
      },
    );
  }

  function handleNewConversation() {
    newConversation.mutate(undefined, {
      onSuccess: (result) => {
        setMessages(result.messages);
        setPendingNavigate(null);
        setMagnetPreview(null);
        setMagnetResult(null);
        checkMagnet.reset();
        qc.setQueryData(getGetAssistantConversationQueryKey(), result);
      },
    });
  }

  function handleMagnetFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMagnetPreview(URL.createObjectURL(file));
    setMagnetResult(null);
    const formData = new FormData();
    formData.append("photo", file);
    checkMagnet.mutate(formData, { onSuccess: setMagnetResult });
  }

  function dismissMagnetCheck() {
    setMagnetPreview(null);
    setMagnetResult(null);
    checkMagnet.reset();
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    setPendingNavigate(null);
    setPendingActions([]);
    setExecutedActions([]);
    setActionDone(false);
    setMagnetPreview(null);
    setMagnetResult(null);
    checkMagnet.reset();
    setStreamingContent("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setIsStreaming(true);

    try {
      await streamAssistantMessage(
        { message: trimmed, pageContext: getPageContext() },
        {
          onDelta: (text) => setStreamingContent((prev) => prev + text),
          onAction: (action) => setPendingActions((prev) => [...prev, action]),
          onDone: (result) => {
            setMessages(result.messages);
            if (result.navigate) setPendingNavigate(result.navigate);
            if (result.actions.length > 0) setPendingActions(result.actions);
            if (result.executedActions.length > 0) {
              setExecutedActions(result.executedActions);
              qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
              qc.invalidateQueries({ queryKey: getListWishlistQueryKey() });
            }
            if (result.actionConfirmationMode !== settings?.actionConfirmationMode) {
              qc.invalidateQueries({ queryKey: getGetAssistantSettingsQueryKey() });
            }
          },
        },
      );
    } catch {
      toast.error("elAIne couldn't respond just now. Please try again.");
      setMessages((prev) => prev.slice(0, -1));
      setPendingActions([]);
    } finally {
      setStreamingContent("");
      setIsStreaming(false);
    }
  }

  function handleConfirmNavigate() {
    if (!pendingNavigate) return;
    navigate(pendingNavigate.path);
    setPendingNavigate(null);
    setOpen(false);
  }

  function invalidateActionQueries(action: AssistantAction) {
    qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
    qc.invalidateQueries({ queryKey: getListWishlistQueryKey() });
    if (
      action.type === "add_packing_item" ||
      action.type === "update_trip_status" ||
      action.type === "update_trip_details" ||
      action.type === "cancel_trip" ||
      action.type === "remove_packing_item" ||
      action.type === "add_itinerary_day" ||
      action.type === "regenerate_itinerary_day" ||
      action.type === "rescan_document"
    ) {
      const tripId = action.payload.tripId;
      if (typeof tripId === "number") {
        qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
      }
    }
    if (action.type === "select_calendar" || action.type === "disconnect_calendar") {
      qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
      qc.invalidateQueries({ queryKey: getListCalendarsQueryKey() });
    }
  }

  // one_by_one mode: confirm or skip just the first queued action, then
  // move on to the next one (if any).
  function handleConfirmAction() {
    const action = pendingActions[0];
    if (!action || executeAction.isPending) return;
    executeAction.mutate(
      { type: action.type, payload: action.payload },
      {
        onSuccess: () => {
          setActionDone(true);
          setPendingActions((prev) => prev.slice(1));
          invalidateActionQueries(action);
          toast.success("Done!");
        },
        onError: () => {
          toast.error("elAIne couldn't do that just now. Please try again.");
        },
      },
    );
  }

  function handleSkipAction() {
    setPendingActions((prev) => prev.slice(1));
  }

  // all_at_once mode: confirm every queued action in order, one request
  // at a time, then clear the queue once they've all run.
  async function handleConfirmAll() {
    if (pendingActions.length === 0 || confirmingAll) return;
    setConfirmingAll(true);
    let failed = 0;
    for (const action of pendingActions) {
      try {
        await executeAction.mutateAsync({ type: action.type, payload: action.payload });
        invalidateActionQueries(action);
      } catch {
        failed += 1;
      }
    }
    setConfirmingAll(false);
    setPendingActions([]);
    if (failed > 0) {
      toast.error(`${failed} of ${pendingActions.length} action(s) couldn't be done.`);
    } else {
      setActionDone(true);
      toast.success("Done!");
    }
  }

  function handleCancelAll() {
    setPendingActions([]);
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={handleNewConversation} className="cursor-pointer">
                    <RotateCcw className="h-3.5 w-3.5 mr-2" />
                    New conversation
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleHideForVisit} className="cursor-pointer">
                    Hide for this visit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleTurnOff} className="cursor-pointer text-destructive focus:text-destructive">
                    Turn off elAIne
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ElaineAvatar size={48} />
                <p className="text-sm text-muted-foreground">
                  Hi, I'm elAIne! Ask me anything about your trips, or whatever's on your screen.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && <ElaineAvatar size={26} className="mt-0.5" />}
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
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
                <ElaineAvatar size={26} className="mt-0.5" />
                {streamingContent ? (
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                    {streamingContent}
                  </div>
                ) : (
                  <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-3 text-muted-foreground">
                    <span className="inline-flex gap-1 text-lg leading-none">
                      <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
                      <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
                      <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {pendingNavigate && (
              <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Take you to <span className="font-medium text-foreground">{pendingNavigate.path}</span>?
                </p>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={handleConfirmNavigate}>
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

            {pendingActions.length > 0 && settings?.actionConfirmationMode === "all_at_once" && (
              <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">
                  {pendingActions.length === 1 ? "1 thing" : `${pendingActions.length} things`} to
                  confirm:
                </p>
                <ul className="space-y-1">
                  {pendingActions.map((action, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
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

            {pendingActions.length > 0 && settings?.actionConfirmationMode !== "all_at_once" && (
              <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">
                  {pendingActions[0]!.label}?
                  {pendingActions.length > 1 && (
                    <span className="text-muted-foreground/70"> ({pendingActions.length} more after this)</span>
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
                <p className="text-xs text-muted-foreground">Already done automatically:</p>
                <ul className="space-y-1">
                  {executedActions.map((action, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
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
                      <p className="text-xs text-muted-foreground">Checking your collection…</p>
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
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Closest matches</p>
                    {magnetResult.matches.map((match) => (
                      <Link
                        key={match.photoId}
                        href={`/trips/${match.tripId}`}
                        onClick={() => setOpen(false)}
                      >
                        <div className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/50 p-1.5 transition-colors hover:border-primary/30">
                          <img
                            src={getTripPhotoImageUrl(match.tripId, match.photoId)}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-md object-cover"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium">{match.tripTitle}</p>
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
              placeholder="Ask elAIne anything…"
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
            <Button size="icon" onClick={handleSend} disabled={!input.trim() || isStreaming}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="relative flex items-center gap-2 rounded-full border border-card-border bg-card py-2 pl-2 pr-4 shadow-lg transition-transform hover:scale-105"
          aria-label={
            unseenNudges && unseenNudges.count > 0
              ? `Open elAIne assistant (${unseenNudges.count} new)`
              : "Open elAIne assistant"
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
