import { useCallback, useEffect, useRef, useState } from "react";
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
  uploadElaineAttachment,
  getGetElaineConversationQueryKey,
  getGetElaineSettingsQueryKey,
  getGetElaineNudgesUnseenCountQueryKey,
  getListElaineConversationsQueryKey,
  type AssistantMessage,
  type AssistantAction,
  type ExecutedAssistantAction,
  type ElaineAppId,
  type ConversationMessage,
  type ElaineAttachmentUploadResult,
} from "@workspace/api-client-react";
import { ElaineName } from "./ElaineAvatar";
import { type ChatWidget } from "./ChatWidgets";
import { useElainePageContextReader } from "./ElainePageContext";

export interface PendingAttachment {
  file: File;
  previewUrl: string;
  uploadedUrl: string | null;
  uploading: boolean;
  error: boolean;
  fileType: "image" | "pdf";
  fileName: string;
  extractedText?: string;
}

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

  // Active named conversation ID (null = use the rolling single-thread history)
  const [conversationId, setConversationId] = useState<number | null>(null);

  // Files queued for attachment to the next message
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);

  // Background screenshot — captured silently when chat becomes active.
  // Sent with every outgoing message for visual page context but never shown
  // in the UI or persisted in conversation history on the server.
  const bgScreenshotUrlRef = useRef<string | null>(null);
  const bgCapturingRef = useRef(false);

  const captureBgScreenshot = useCallback(async () => {
    if (bgCapturingRef.current) return;
    bgCapturingRef.current = true;
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        scale: 0.5,
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7),
      );
      if (!blob) return;
      const file = new File([blob], "page-context.jpg", { type: "image/jpeg" });
      const result = await uploadElaineAttachment(file);
      bgScreenshotUrlRef.current = result.url;
    } catch {
      // silently ignore — screenshot is optional context
    } finally {
      bgCapturingRef.current = false;
    }
  }, []);

  // Capture a fresh screenshot whenever the chat becomes active.
  useEffect(() => {
    if (active) {
      void captureBgScreenshot();
    }
  }, [active, captureBgScreenshot]);

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
    setConversationId(null);
    setPendingAttachments([]);
    newConversation.mutate(undefined, {
      onSuccess: (result) => {
        setMessages(result.messages);
        setPendingNavigate(null);
        qc.setQueryData(getGetElaineConversationQueryKey(), result);
      },
    });
  }

  /** Load a specific named conversation into the chat panel. */
  function handleLoadConversation(id: number, msgs: ConversationMessage[]) {
    setConversationId(id);
    setPendingAttachments([]);
    setPendingNavigate(null);
    setPendingActions([]);
    setExecutedActions([]);
    setActionDone(false);
    setMessageWidgets(new Map());
    setMessages(
      msgs.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        attachmentUrls:
          m.attachmentUrls.length > 0 ? m.attachmentUrls : undefined,
      })) as AssistantMessage[],
    );
  }

  // Attachment management -------------------------------------------------------

  async function handleAddAttachment(file: File) {
    const previewUrl = URL.createObjectURL(file);
    const fileType: "image" | "pdf" =
      file.type === "application/pdf" ? "pdf" : "image";
    setPendingAttachments((prev) => [
      ...prev,
      {
        file,
        previewUrl,
        uploadedUrl: null,
        uploading: true,
        error: false,
        fileType,
        fileName: file.name,
      },
    ]);

    try {
      const result: ElaineAttachmentUploadResult =
        await uploadElaineAttachment(file);
      setPendingAttachments((prev) =>
        prev.map((a) =>
          a.previewUrl === previewUrl
            ? {
                ...a,
                uploadedUrl: result.url,
                uploading: false,
                fileType: result.type,
                fileName: result.name ?? file.name,
                extractedText: result.extractedText,
              }
            : a,
        ),
      );
    } catch {
      setPendingAttachments((prev) =>
        prev.map((a) =>
          a.previewUrl === previewUrl
            ? { ...a, uploading: false, error: true }
            : a,
        ),
      );
      toast.error("Couldn't upload the attachment. Please try again.");
    }
  }

  function handleRemoveAttachment(previewUrl: string) {
    setPendingAttachments((prev) => {
      const item = prev.find((a) => a.previewUrl === previewUrl);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((a) => a.previewUrl !== previewUrl);
    });
  }

  function clearAttachments() {
    setPendingAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
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

    const readyAttachments = pendingAttachments.filter(
      (a) => a.uploadedUrl && !a.error,
    );
    const imageAttachments = readyAttachments.filter(
      (a) => a.fileType === "image",
    );
    const pdfAttachments = readyAttachments.filter((a) => a.fileType === "pdf");
    const uploadedAttachmentUrls = imageAttachments.map((a) => a.uploadedUrl!);
    const uploadedPdfs = pdfAttachments.map((a) => ({
      url: a.uploadedUrl!,
      name: a.fileName,
      extractedText: a.extractedText,
    }));
    const hasAttachments =
      uploadedAttachmentUrls.length > 0 || uploadedPdfs.length > 0;

    // Must have either a message body or at least one ready attachment
    if ((!trimmed && !hasAttachments) || isStreaming) return;

    setInput("");
    clearAttachments();
    setPendingNavigate(null);
    setPendingActions([]);
    setExecutedActions([]);
    setActionDone(false);
    setStreamingContent("");
    setStatusMessage("");
    const optimisticAttachmentRefs = [
      ...imageAttachments.map((a) => ({
        url: a.uploadedUrl!,
        type: "image" as const,
      })),
      ...pdfAttachments.map((a) => ({
        url: a.uploadedUrl!,
        type: "pdf" as const,
        name: a.fileName,
      })),
    ];
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: trimmed,
        ...(hasAttachments ? { attachmentUrls: optimisticAttachmentRefs } : {}),
      },
    ]);
    setIsStreaming(true);
    // accumulate widgets for the new assistant turn
    const pendingWidgets: ChatWidget[] = [];

    try {
      const pageScreenshotUrl = bgScreenshotUrlRef.current ?? undefined;
      // Refresh screenshot in the background for the next message.
      void captureBgScreenshot();

      const result = await streamElaineMessage(
        {
          message: trimmed,
          pageContext: getPageContext(),
          appId,
          ...(conversationId !== null ? { conversationId } : {}),
          ...(uploadedAttachmentUrls.length > 0
            ? { attachmentUrls: uploadedAttachmentUrls }
            : {}),
          ...(uploadedPdfs.length > 0 ? { attachmentPdfs: uploadedPdfs } : {}),
          ...(pageScreenshotUrl ? { pageScreenshotUrl } : {}),
        },
        {
          onDelta: (text) => {
            setStatusMessage("");
            setStreamingContent((prev) => prev + text);
          },
          onAction: (action) => setPendingActions((prev) => [...prev, action]),
          onStatus: (msg) => setStatusMessage(msg),
          onWidget: (widget) => pendingWidgets.push(widget),
          onDone: (res) => {
            setMessages(res.messages);
            // attach widgets to the last assistant message index
            if (pendingWidgets.length > 0) {
              const lastIdx = res.messages.length - 1;
              setMessageWidgets((prev) => {
                const next = new Map(prev);
                next.set(lastIdx, pendingWidgets);
                return next;
              });
            }
            if (res.navigate) setPendingNavigate(res.navigate);
            if (res.actions.length > 0) setPendingActions(res.actions);
            if (res.executedActions.length > 0) {
              setExecutedActions(res.executedActions);
              invalidateActionQueries();
            }
            if (
              res.actionConfirmationMode !== settings?.actionConfirmationMode
            ) {
              qc.invalidateQueries({
                queryKey: getGetElaineSettingsQueryKey(),
              });
            }
            // Track the conversation ID returned by the server so future
            // sends continue in the same named conversation.
            if (res.conversationId !== undefined) {
              setConversationId(res.conversationId);
              qc.invalidateQueries({
                queryKey: getListElaineConversationsQueryKey(),
              });
            }
          },
        },
      );
      void result;
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
    const path = pendingNavigate.path;
    setPendingNavigate(null);
    // Cross-SPA paths (start with /pottery, /quilting, /travels, /elaine) need
    // a full page load because they belong to a different React bundle.
    // Using wouter's navigate() for these would just render a 404 within the
    // current SPA instead of loading the correct app.
    const CROSS_SPA_PREFIXES = ["/pottery", "/quilting", "/travels", "/elaine"];
    const isCrossSpa = CROSS_SPA_PREFIXES.some(
      (prefix) =>
        path === prefix ||
        path.startsWith(prefix + "/") ||
        path.startsWith(prefix + "?"),
    );
    if (isCrossSpa) {
      window.location.href = path;
    } else {
      navigate(path);
      onAfter?.();
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
    conversationId,
    setConversationId,
    pendingAttachments,
    handleAddAttachment,
    handleRemoveAttachment,
    handleNewConversation,
    handleLoadConversation,
    handleSend,
    handleConfirmNavigate,
    handleConfirmAction,
    handleSkipAction,
    handleConfirmAll,
    handleCancelAll,
  };
}

export type ElaineChat = ReturnType<typeof useElaineChat>;
