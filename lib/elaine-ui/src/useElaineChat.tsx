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
  getInfiniteElaineConversationsQueryKey,
  getListElaineConversationsQueryKey,
  getUploadErrorMessage,
  getElaineConversationMessagesFn,
  type AssistantMessage,
  type AssistantAction,
  type ExecutedAssistantAction,
  type ElaineAppId,
  type ConversationMessage,
  type ElaineAttachmentUploadResult,
  type ElaineRuntimeTrace,
} from "@workspace/api-client-react";
import { ElaineName } from "./ElaineAvatar";
import { type ChatWidget } from "./ChatWidgets";
import { useElainePageContextReader } from "./ElainePageContext";
import {
  LARGE_ATTACHMENT_UPLOAD,
  validateClientUpload,
} from "@workspace/upload-policy";

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
  const [streamingReasoningSummary, setStreamingReasoningSummary] =
    useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [runtimeTrace, setRuntimeTrace] = useState<ElaineRuntimeTrace | null>(
    null,
  );
  const endRef = useRef<HTMLDivElement | null>(null);

  // Active named conversation ID (null = use the rolling single-thread history)
  const [conversationId, setConversationId] = useState<number | null>(null);

  // Pagination for "load older messages" (infinite-scroll-up). The initial
  // page comes from GET /conversation (or from picking a conversation in the
  // history panel); older pages are fetched on demand via
  // GET /conversations/:id/messages?before=<oldestId>.
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Tracks whether we've already done the "jump straight to the bottom" scroll
  // for the current activation, so we can distinguish it from later smooth
  // scrolls as new content streams in. Reset whenever the surface goes
  // inactive (widget closed) so the next activation gets a fresh instant jump.
  // Deliberately NOT keyed off the `active` transition alone: the full-page
  // surface is active from mount, before history has loaded, so the *first*
  // populated render (not the first active render) is what must jump instantly.
  const didInitialScrollRef = useRef(false);
  // Monotonic source for optimistic-message temp ids (see handleSend).
  const tempIdCounterRef = useRef(0);
  // Synchronous in-flight guard for loadOlderMessages. `isLoadingOlder` state
  // is not enough on its own: React can batch/delay the re-render that would
  // make `isLoadingOlder` true, so two scroll events (or a scroll event plus
  // the viewport-underflow backstop in ElaineChatPanel) firing back-to-back
  // can both read the same stale `false` and both fetch the same cursor,
  // duplicating a page of history. This ref is set/cleared synchronously.
  const isLoadingOlderRef = useRef(false);
  // Set right before an older-messages page is prepended so the scroll-to-
  // bottom effect below (which also fires on any messages-array change)
  // skips that update instead of yanking the view back down.
  const suppressAutoScrollRef = useRef(false);

  // Files queued for attachment to the next message
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);

  // Background screenshot — captured silently when chat becomes active.
  // Sent with every outgoing message for visual page context but never shown
  // in the UI or persisted in conversation history on the server.
  const bgScreenshotUrlRef = useRef<string | null>(null);
  const bgCapturingRef = useRef(false);

  // User's current geolocation — collected once per session when chat opens.
  // Enables location-aware queries (nearby places, weather, directions) without
  // asking the user to type their city. Optional — silently skipped on denial.
  const geoRef = useRef<{ lat: number; lng: number } | null>(null);

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

  // Collect geolocation once per session when chat opens. 10 s browser timeout,
  // 5 min cached position acceptable. Silently skipped on denial or unavailable.
  const captureGeo = useCallback(() => {
    if (!navigator.geolocation || geoRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
      },
      () => {}, // silently ignore — geolocation is optional context
      { timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  // Capture a fresh screenshot whenever the chat becomes active, and keep it
  // current while the panel is open: re-capture on scroll (debounced 1.5 s so
  // it doesn't thrash during fast scrolling) and on any URL change (SPA
  // navigation via history.pushState / popstate).
  useEffect(() => {
    if (!active) return;

    void captureBgScreenshot();
    captureGeo();

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => void captureBgScreenshot(), 1500);
    };

    const onNavigate = () => void captureBgScreenshot();

    // Patch pushState once so SPA navigations trigger the handler.
    const origPush = history.pushState.bind(history);
    history.pushState = (...args) => {
      origPush(...args);
      onNavigate();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onNavigate);

    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onNavigate);
      // Restore the original pushState when the panel closes.
      history.pushState = origPush;
    };
  }, [active, captureBgScreenshot, captureGeo]);

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
      setConversationId(conversation.conversationId);
      setHasOlderMessages(conversation.hasMore);
      setInitialized(true);
      qc.invalidateQueries({
        queryKey: getGetElaineNudgesUnseenCountQueryKey(),
      });
    }
  }, [conversation, initialized, qc]);

  // Scroll to the latest message whenever the panel opens or new content
  // arrives — but not when older history was just prepended by
  // loadOlderMessages (that update wants the scroll position preserved, not
  // yanked back to the bottom; ElaineChatPanel handles that separately).
  useEffect(() => {
    if (!active) {
      // Reset so the next activation (widget reopened) jumps straight to the
      // bottom again instead of smooth-scrolling through history.
      didInitialScrollRef.current = false;
      return;
    }
    if (suppressAutoScrollRef.current) {
      suppressAutoScrollRef.current = false;
      return;
    }
    // Wait for the first page of history to actually load — on the full-page
    // surface `active` is true from mount, before `messages` is populated, so
    // scrolling here would be a no-op anyway and would (wrongly) consume the
    // "first scroll" slot before there's anything to jump to.
    if (!initialized) return;

    const isFirstScrollThisActivation = !didInitialScrollRef.current;
    didInitialScrollRef.current = true;
    endRef.current?.scrollIntoView({
      behavior: isFirstScrollThisActivation ? "instant" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [messages, active, initialized, isStreaming, streamingContent]);

  /** Fetches and prepends the previous page of older messages for the active
   *  conversation, for infinite-scroll-up in the message list. No-op if
   *  there's no known conversation, no older page, or a fetch is in flight. */
  const loadOlderMessages = useCallback(async () => {
    if (
      isLoadingOlderRef.current ||
      !hasOlderMessages ||
      conversationId === null
    )
      return;
    const oldestId = messages[0]?.id;
    if (oldestId === undefined) return;

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const page = await getElaineConversationMessagesFn(conversationId, {
        before: oldestId,
      });
      const older: AssistantMessage[] = page.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachmentUrls:
          m.attachmentUrls.length > 0 ? m.attachmentUrls : undefined,
        ...(m.runtimeTrace ? { runtimeTrace: m.runtimeTrace } : {}),
        ...(m.reasoningSummary ? { reasoningSummary: m.reasoningSummary } : {}),
        createdAt: m.createdAt,
      }));
      if (older.length > 0) {
        suppressAutoScrollRef.current = true;
        // No widget-map reshuffling needed here: messageWidgets is keyed by
        // each message's own persisted id, not its array position, so
        // prepending older messages above the existing ones never
        // invalidates an existing entry.
        setMessages((prev) => [...older, ...prev]);
      }
      setHasOlderMessages(page.hasMore);
    } catch {
      toast.error("Couldn't load earlier messages. Please try again.");
    } finally {
      isLoadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [hasOlderMessages, conversationId, messages]);

  function handleNewConversation() {
    // Clear the UI immediately — don't wait for the server round-trip.
    setMessages([]);
    setPendingNavigate(null);
    setPendingActions([]);
    setExecutedActions([]);
    setActionDone(false);
    setMessageWidgets(new Map());
    setPendingAttachments([]);
    setRuntimeTrace(null);
    setHasOlderMessages(false);

    newConversation.mutate(undefined, {
      onSuccess: (result) => {
        // The server rotates the isWidgetDefault conversation and returns the
        // new (empty) conversation's ID.  Pin conversationId to it so the next
        // send goes to the fresh thread rather than the old rolling one.
        setConversationId(result.conversationId ?? null);
        qc.setQueryData(getGetElaineConversationQueryKey(), {
          messages: [] as AssistantMessage[],
          conversationId: result.conversationId ?? null,
          hasMore: false,
        });
        qc.invalidateQueries({
          queryKey: getListElaineConversationsQueryKey(),
        });
        qc.invalidateQueries({
          queryKey: getInfiniteElaineConversationsQueryKey(),
        });
      },
    });
  }

  /** Load a specific named conversation into the chat panel. `msgs` is the
   *  most recent page (oldest-first); `hasMore` indicates whether older
   *  messages exist beyond it for loadOlderMessages to fetch. */
  function handleLoadConversation(
    id: number,
    msgs: ConversationMessage[],
    hasMore = false,
  ) {
    setConversationId(id);
    setPendingAttachments([]);
    setPendingNavigate(null);
    setPendingActions([]);
    setExecutedActions([]);
    setActionDone(false);
    setMessageWidgets(new Map());
    setRuntimeTrace(null);
    setHasOlderMessages(hasMore);
    setMessages(
      msgs.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        attachmentUrls:
          m.attachmentUrls.length > 0 ? m.attachmentUrls : undefined,
        ...(m.runtimeTrace ? { runtimeTrace: m.runtimeTrace } : {}),
        ...(m.reasoningSummary ? { reasoningSummary: m.reasoningSummary } : {}),
        createdAt: m.createdAt,
      })) as AssistantMessage[],
    );
  }

  // Attachment management -------------------------------------------------------

  async function handleAddAttachment(file: File) {
    const validation = validateClientUpload(file, LARGE_ATTACHMENT_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

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
    } catch (err) {
      setPendingAttachments((prev) =>
        prev.map((a) =>
          a.previewUrl === previewUrl
            ? { ...a, uploading: false, error: true }
            : a,
        ),
      );
      toast.error(
        getUploadErrorMessage(
          err,
          "Couldn't upload the attachment. Please try again.",
        ),
      );
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
    setStreamingReasoningSummary("");
    setStatusMessage("");
    setRuntimeTrace(null);
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
    // Tag the optimistic message with a negative temp id (real message ids
    // from the server are always positive serials) so the completion handler
    // below can find and replace *this specific* message wherever it ends up
    // in the array — a concurrent loadOlderMessages() prepend can land while
    // this send is in flight, so it is not safe to assume it stays last.
    const tempId = -++tempIdCounterRef.current;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
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
          ...(geoRef.current
            ? { userLat: geoRef.current.lat, userLng: geoRef.current.lng }
            : {}),
        },
        {
          onDelta: (text) => {
            setStatusMessage("");
            setStreamingContent((prev) => prev + text);
          },
          onReasoningSummaryDelta: (delta) => {
            setStreamingReasoningSummary((prev) => prev + delta);
          },
          onResponseReset: () => setStreamingContent(""),
          onAction: (action) => setPendingActions((prev) => [...prev, action]),
          onStatus: (msg) => setStatusMessage(msg),
          onWidget: (widget) => pendingWidgets.push(widget as ChatWidget),
          onRuntime: ({ trace }) => setRuntimeTrace(trace),
          onDone: (res) => {
            // `res.messages` is always an empty array (the legacy rolling
            // window backed by elaineConversations has been retired). Use
            // `res.userMessageId` / `res.assistantMessageId` — real
            // elaineHistoryMessages row ids — to reconcile the optimistic
            // message and keep "load older" cursors correct.
            const assistantMsg: AssistantMessage = {
              id: res.assistantMessageId ?? undefined,
              role: "assistant",
              content: res.content,
              runtimeTrace: res.runtimeTrace,
              ...(res.reasoningSummary
                ? { reasoningSummary: res.reasoningSummary }
                : {}),
            };
            setMessages((prev) => {
              const optimisticIdx = prev.findIndex((m) => m.id === tempId);
              if (optimisticIdx >= 0) {
                // Find by `tempId` rather than assuming the optimistic message
                // is still last: a concurrent loadOlderMessages() prepend can
                // land while this send is in flight, and it never touches the
                // tail, so the optimistic message's *identity* (tempId) is the
                // only safe anchor — its array index is not.
                const optimisticUser = prev[optimisticIdx];
                const replacement: AssistantMessage = {
                  ...optimisticUser,
                  id: res.userMessageId ?? undefined,
                };
                const merged = [
                  ...prev.slice(0, optimisticIdx),
                  replacement,
                  assistantMsg,
                  ...prev.slice(optimisticIdx + 1),
                ];
                return merged;
              }
              // Optimistic message was somehow already removed (e.g. an
              // error-path reset raced this completion) — fall back to
              // appending the assistant reply so it isn't lost.
              return [...prev, assistantMsg];
            });
            // Keyed by the assistant message's own persisted id, not its
            // array position: a concurrent loadOlderMessages() prepend can
            // land between the setMessages call above and this one (or even
            // between this update and the next render), which would silently
            // invalidate any numeric index captured here. The id is stable
            // regardless of how many older pages get prepended above it.
            if (pendingWidgets.length > 0 && assistantMsg.id !== undefined) {
              const widgetKey = assistantMsg.id;
              setMessageWidgets((prev) => {
                const next = new Map(prev);
                next.set(widgetKey, pendingWidgets);
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
              qc.invalidateQueries({
                queryKey: getInfiniteElaineConversationsQueryKey(),
              });
            }
            setRuntimeTrace(null);
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
      // Remove by tempId, not position — a concurrent loadOlderMessages()
      // prepend can land while this send is in flight, so the optimistic
      // message is not guaranteed to still be last.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setPendingActions([]);
      setRuntimeTrace(null);
    } finally {
      setStreamingContent("");
      setStreamingReasoningSummary("");
      setStatusMessage("");
      setRuntimeTrace(null);
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
    const CROSS_SPA_PREFIXES = [
      "/pottery",
      "/quilting",
      "/ornaments",
      "/travels",
      "/elaine",
    ];
    const isCrossSpa = CROSS_SPA_PREFIXES.some(
      (prefix) =>
        path === prefix ||
        path.startsWith(prefix + "/") ||
        path.startsWith(prefix + "?"),
    );
    // Pottery/quilting/travels/ornaments are now merged under the "modules"
    // artifact, which mounts a single wouter Router at base "/modules" and
    // routes every merged app under its own literal "/pottery", "/quilting",
    // etc. prefix (e.g. "/travels/wishlist"). Elaine's tool contract still
    // emits paths relative to the requesting app's own "home" (e.g. "/wishlist"
    // for a same-app suggestion), since that contract predates the merge and
    // still matches how each app runs standalone. When this bundle IS the
    // modules host, same-app relative paths and old-style cross-app prefixes
    // both need the "/modules" segment (and same-app paths also need their
    // own app prefix) added before handing off to wouter/window.location.
    const MERGED_APP_IDS = ["pottery", "quilting", "travels", "ornaments"];
    const envBaseUrl = (import.meta as { env?: { BASE_URL?: string } }).env
      ?.BASE_URL;
    const base = (envBaseUrl ?? "/").replace(/\/$/, "");
    const isModulesHost = base === "/modules";
    if (isCrossSpa) {
      const target = !path.startsWith("/elaine") ? `/modules${path}` : path;
      window.location.href = target;
    } else {
      const target =
        isModulesHost && MERGED_APP_IDS.includes(appId)
          ? `/${appId}${path}`
          : path;
      navigate(target);
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
    streamingReasoningSummary,
    statusMessage,
    runtimeTrace,
    endRef,
    executeAction,
    conversationId,
    setConversationId,
    hasOlderMessages,
    isLoadingOlder,
    loadOlderMessages,
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
