import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  useGetAssistantConversation,
  streamAssistantMessage,
  useNewAssistantConversation,
  useGetAssistantSettings,
  useUpdateAssistantSettings,
  useExecuteAssistantAction,
  useCheckMagnet,
  getGetAssistantConversationQueryKey,
  getGetAssistantSettingsQueryKey,
  getGetAssistantNudgesUnseenCountQueryKey,
  getListTripsQueryKey,
  getListWishlistQueryKey,
  getGetTripQueryKey,
  getGetCalendarStatusQueryKey,
  getListCalendarsQueryKey,
  getListConnectedCalendarsQueryKey,
  type AssistantMessage,
  type AssistantAction,
  type ExecutedAssistantAction,
  type MagnetCheckResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ElaineName } from "./ElaineAvatar";
import { useAssistantPageContextReader } from "@/lib/assistant-context";

/**
 * Shared conversation/tooling state for Elaine, used by both the floating
 * widget and the full-screen chat page. Both surfaces get identical tool
 * access (actions, magnet check, streaming, confirmations) — the full-screen
 * page is never a stripped-down mode, just a different container around the
 * same logic.
 */
export function useAssistantChat({ active }: { active: boolean }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const getPageContext = useAssistantPageContextReader();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [pendingNavigate, setPendingNavigate] = useState<{ path: string; reason: string } | null>(null);
  const [pendingActions, setPendingActions] = useState<AssistantAction[]>([]);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [executedActions, setExecutedActions] = useState<ExecutedAssistantAction[]>([]);
  const [actionDone, setActionDone] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [magnetPreview, setMagnetPreview] = useState<string | null>(null);
  const [magnetResult, setMagnetResult] = useState<MagnetCheckResult | null>(null);
  const magnetFileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useGetAssistantSettings();
  const updateSettings = useUpdateAssistantSettings();
  const { data: conversation } = useGetAssistantConversation({
    query: { enabled: active && !initialized, queryKey: getGetAssistantConversationQueryKey() },
  });
  const newConversation = useNewAssistantConversation();
  const executeAction = useExecuteAssistantAction();
  const checkMagnet = useCheckMagnet({
    mutation: {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Check failed"),
    },
  });

  useEffect(() => {
    if (conversation && !initialized) {
      setMessages(conversation.messages);
      setInitialized(true);
      qc.invalidateQueries({ queryKey: getGetAssistantNudgesUnseenCountQueryKey() });
    }
  }, [conversation, initialized, qc]);

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

  async function handleSend(overrideText?: string) {
    const trimmed = (overrideText ?? input).trim();
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
    setStatusMessage("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setIsStreaming(true);

    try {
      await streamAssistantMessage(
        { message: trimmed, pageContext: getPageContext() },
        {
          onDelta: (text) => {
            setStatusMessage("");
            setStreamingContent((prev) => prev + text);
          },
          onAction: (action) => setPendingActions((prev) => [...prev, action]),
          onStatus: (msg) => setStatusMessage(msg),
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
      toast.error(
        <>
          <ElaineName /> couldn't respond just now. Please try again.
        </>,
      );
      setMessages((prev) => prev.slice(0, -1));
      setPendingActions([]);
    } finally {
      setStreamingContent("");
      setStatusMessage("");
      setIsStreaming(false);
    }
  }

  function handleConfirmNavigate(onAfter?: () => void) {
    if (!pendingNavigate) return;
    navigate(pendingNavigate.path);
    setPendingNavigate(null);
    onAfter?.();
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
      action.type === "rescan_document" ||
      action.type === "generate_itinerary" ||
      action.type === "confirm_itinerary_activity" ||
      action.type === "remove_itinerary_activity"
    ) {
      const tripId = action.payload.tripId;
      if (typeof tripId === "number") {
        qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
      }
    }
    if (action.type === "add_connected_calendar" || action.type === "disconnect_calendar") {
      qc.invalidateQueries({ queryKey: getGetCalendarStatusQueryKey() });
      qc.invalidateQueries({ queryKey: getListCalendarsQueryKey() });
      qc.invalidateQueries({ queryKey: getListConnectedCalendarsQueryKey() });
    }
  }

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
          toast.error(
            <>
              <ElaineName /> couldn't do that just now. Please try again.
            </>,
          );
        },
      },
    );
  }

  function handleSkipAction() {
    setPendingActions((prev) => prev.slice(1));
  }

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

  return {
    settings,
    updateSettings,
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
    handleNewConversation,
    handleMagnetFileChange,
    dismissMagnetCheck,
    handleSend,
    handleConfirmNavigate,
    handleConfirmAction,
    handleSkipAction,
    handleConfirmAll,
    handleCancelAll,
  };
}

export type AssistantChat = ReturnType<typeof useAssistantChat>;
