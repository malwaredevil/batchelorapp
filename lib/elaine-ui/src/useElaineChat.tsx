import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetElaineConversation,
  streamElaineMessage,
  useNewElaineConversation,
  useGetElaineSettings,
  useUpdateElaineSettings,
  useExecuteElaineAction,
  getGetElaineConversationQueryKey,
  getGetElaineSettingsQueryKey,
  getGetElaineNudgesUnseenCountQueryKey,
  type AssistantMessage,
  type AssistantAction,
  type ExecutedAssistantAction,
  type ElaineAppId,
  type ChatWidget,
} from "@workspace/api-client-react";
import { ElaineName } from "./ElaineAvatar";
import { useElainePageContextReader } from "./ElainePageContext";

/**
 * Shared conversation/tooling state for Elaine, used identically by the
 * floating widget and any full-screen chat surface across every app
 * (travels, pottery, quilting, hub). `appId` tells the server which app's
 * on-screen context/tools/nav-paths are relevant for the current turn — the
 * conversation itself is one continuous thread shared across all apps.
 */
export function useElaineChat({
  appId,
  active,
}: {
  appId: ElaineAppId;
  active: boolean;
}) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const getPageContext = useElainePageContextReader();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  // widgets[i] holds rich widget data for messages[i] (assistant turns only)
  const [messageWidgets, setMessageWidgets] = useState<
    Map<number, ChatWidget[]>
  >(new Map());
  const [initialized, setInitialized] = useState(false);
  const [pendingNavigate, setPendingNavigate] = useState<{
    path: string;
    reason: string;
  } | null>(null);
  const [pendingActions, setPendingActions] = useState<AssistantAction[]>([]);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [executedActions, setExecutedActions] = useState<
    ExecutedAssistantAction[]
  >([]);
  const [actionDone, setActionDone] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data: settings } = useGetElaineSettings();
  const updateSettings = useUpdateElaineSettings();
  const { data: conversation } = useGetElaineConversation({
    query: {
      enabled: active && !initialized,
      queryKey: getGetElaineConversationQueryKey(),
    },
  });
  const newConversation = useNewElaineConversation();
  const executeAction = useExecuteElaineAction();

  useEffect(() => {
    if (conversation && !initialized) {
      setMessages(conversation.messages);
      setInitialized(true);
      qc.invalidateQueries({
        queryKey: getGetElaineNudgesUnseenCountQueryKey(),
      });
    }
  }, [conversation, initialized, qc]);

  function handleNewConversation() {
    newConversation.mutate(undefined, {
      onSuccess: (result) => {
        setMessages(result.messages);
        setPendingNavigate(null);
        qc.setQueryData(getGetElaineConversationQueryKey(), result);
      },
    });
  }

  // Actions can touch data belonging to any app (a single conversation
  // spans travels/pottery/quilting), so rather than hardcoding every app's
  // query keys here, invalidate broadly whenever a write happens — these
  // are infrequent, explicitly user-confirmed events.
  function invalidateActionQueries() {
    qc.invalidateQueries();
  }

  async function handleSend(overrideText?: string) {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    setPendingNavigate(null);
    setPendingActions([]);
    setExecutedActions([]);
    setActionDone(false);
    setStreamingContent("");
    setStatusMessage("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setIsStreaming(true);
    // accumulate widgets for the new assistant turn
    const pendingWidgets: ChatWidget[] = [];

    try {
      await streamElaineMessage(
        { message: trimmed, pageContext: getPageContext(), appId },
        {
          onDelta: (text) => {
            setStatusMessage("");
            setStreamingContent((prev) => prev + text);
          },
          onAction: (action) => setPendingActions((prev) => [...prev, action]),
          onStatus: (msg) => setStatusMessage(msg),
          onWidget: (widget) => pendingWidgets.push(widget),
          onDone: (result) => {
            setMessages(result.messages);
            // attach widgets to the last assistant message index
            if (pendingWidgets.length > 0) {
              const lastIdx = result.messages.length - 1;
              setMessageWidgets((prev) => {
                const next = new Map(prev);
                next.set(lastIdx, pendingWidgets);
                return next;
              });
            }
            if (result.navigate) setPendingNavigate(result.navigate);
            if (result.actions.length > 0) setPendingActions(result.actions);
            if (result.executedActions.length > 0) {
              setExecutedActions(result.executedActions);
              invalidateActionQueries();
            }
            if (
              result.actionConfirmationMode !== settings?.actionConfirmationMode
            ) {
              qc.invalidateQueries({
                queryKey: getGetElaineSettingsQueryKey(),
              });
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

  function handleConfirmAction() {
    const action = pendingActions[0];
    if (!action || executeAction.isPending) return;
    executeAction.mutate(
      { type: action.type, payload: action.payload },
      {
        onSuccess: () => {
          setActionDone(true);
          setPendingActions((prev) => prev.slice(1));
          invalidateActionQueries();
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
        await executeAction.mutateAsync({
          type: action.type,
          payload: action.payload,
        });
      } catch {
        failed += 1;
      }
    }
    invalidateActionQueries();
    setConfirmingAll(false);
    setPendingActions([]);
    if (failed > 0) {
      toast.error(
        `${failed} of ${pendingActions.length} action(s) couldn't be done.`,
      );
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
    handleNewConversation,
    handleSend,
    handleConfirmNavigate,
    handleConfirmAction,
    handleSkipAction,
    handleConfirmAll,
    handleCancelAll,
  };
}

export type ElaineChat = ReturnType<typeof useElaineChat>;
