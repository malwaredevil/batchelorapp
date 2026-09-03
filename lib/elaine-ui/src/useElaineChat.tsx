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
  signalElaineTurnHandoff,
  resumeElaineTurnStream,
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
  fileType: "image" | "pdf" | "csv" | "docx" | "xlsx";
  fileName: string;
  extractedText?: string;
}

/** A user message captured while a prior turn was still streaming — held
 *  here until it's this message's turn to actually be sent. */
interface QueuedSend {
  tempId: number;
  trimmed: string;
  uploadedAttachmentUrls: string[];
  uploadedPdfs: Array<{ url: string; name: string; extractedText?: string }>;
  uploadedDocs: Array<{
    url: string;
    name: string;
    docType: "csv" | "docx" | "xlsx";
    extractedText?: string;
  }>;
}

/** Minimal state stashed by the widget on maximize so the full Elaine app can
 *  open the exact same conversation and (when a turn was in flight) attach to
 *  the still-running generation without any visible restart. */
export interface ElaineHandoffState {
  /** Null only in the rare case the server couldn't resolve a conversation
   *  for the in-flight turn — hydration then relies on the resume stream's
   *  terminal event to learn the id. */
  conversationId: number | null;
  /** Non-null when a turn was mid-flight at maximize time. */
  turnId: string | null;
  /** The just-sent (not yet persisted) user message, for instant rendering. */
  userMessage: string | null;
}

const DOC_MIME_TO_TYPE: Record<string, "csv" | "docx" | "xlsx"> = {
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

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
  handoff = null,
}: {
  appId: ElaineAppId;
  active: boolean;
  /** When set (full Elaine app opened via the widget's maximize button),
   *  hydrate from this conversation — and, if a turn id is present, attach to
   *  the in-progress turn instead of doing the default conversation load. */
  handoff?: ElaineHandoffState | null;
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

  // Drives the live "Thinking…" panel's streaming/collapsing state
  // independently of `isStreaming` (which controls whether the whole
  // streaming bubble is mounted at all). Flipping this false slightly
  // *before* the bubble unmounts gives the disclosure a moment to visibly
  // collapse instead of just vanishing when swapped for the persisted
  // message. See the `finally` block in handleSend for the handoff.
  const [reasoningActive, setReasoningActive] = useState(false);
  const hadReasoningRef = useRef(false);
  const turnStartRef = useRef(0);
  // Mirrors `streamingContent` state but is readable synchronously from
  // inside the same in-flight `runSend` call's catch block — a plain closure
  // over the `streamingContent` state variable would only see whatever it
  // was when `runSend` started (state updates don't mutate that closure's
  // captured value), so the accumulated text at the moment of a Stop would
  // otherwise be lost.
  const streamingContentRef = useRef("");
  // Cancels the in-flight `streamElaineMessage` fetch when the user clicks
  // Stop. Null whenever no turn is streaming.
  const currentAbortControllerRef = useRef<AbortController | null>(null);
  // Stable id of the turn currently streaming (surfaced by the server's
  // `turn` SSE event as soon as the turn starts). Used by beginHandoff() so
  // the widget's maximize button can hand the in-flight turn to the full app.
  const currentTurnIdRef = useRef<string | null>(null);
  // Authoritative conversation id for the turn currently streaming, from the
  // same `turn` SSE event. Matters when the turn started a brand-new
  // conversation: the hook's `conversationId` state is still null until the
  // terminal `done` event, but a maximize handoff needs the real id now.
  const currentTurnConversationIdRef = useRef<number | null>(null);
  // Waiters registered by beginHandoff() when the user maximizes before the
  // `turn` SSE event has arrived (send just started). Resolved with the turn
  // info as soon as it lands, or null when the turn ends without one.
  const turnIdWaitersRef = useRef<
    Array<
      (info: { turnId: string; conversationId: number | null } | null) => void
    >
  >([]);
  function flushTurnIdWaiters(
    info: { turnId: string; conversationId: number | null } | null,
  ) {
    const waiters = turnIdWaitersRef.current;
    turnIdWaitersRef.current = [];
    for (const w of waiters) w(info);
  }
  // Synchronous "a turn is actively being sent" flag. `isStreaming` state is
  // not safe to gate on here: React can batch/delay the re-render that would
  // make it true, so two handleSend calls in the same tick (e.g. queueing
  // two messages back-to-back) could both see a stale `false` and both try
  // to start a request instead of the second one queueing.
  const isSendingRef = useRef(false);
  // Messages queued while a prior turn is still streaming, sent strictly in
  // order the instant the in-progress turn finishes or is stopped.
  const queueRef = useRef<QueuedSend[]>([]);
  // Retains the original send payload for any message currently marked
  // `failed`, keyed by its (negative) tempId, so retrySend() can resend the
  // exact same text/attachments without the user retyping anything.
  const failedItemsRef = useRef<Map<number, QueuedSend>>(new Map());

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
  const { data: conversation, refetch: refetchConversation } =
    useGetElaineConversation({
      query: {
        // A maximize handoff hydrates its own specific conversation below —
        // the default (widget-thread) load must not race/clobber it.
        enabled: active && !initialized && handoff === null,
        queryKey: getGetElaineConversationQueryKey(),
      },
    });
  const newConversation = useNewElaineConversation();
  const executeAction = useExecuteElaineAction();

  // Synchronous mirror of `messages`, readable from the visibilitychange
  // handler below without needing to re-subscribe that listener on every
  // message change.
  const messagesRef = useRef<AssistantMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Reconciles against the server whenever the app/tab comes back into the
  // foreground and there's a message locally marked `failed` (the request
  // died without ever getting a server response — the leading real-world
  // cause is the mobile OS killing the connection when the app is
  // closed/backgrounded mid-request). The connection failing client-side
  // does NOT mean the server didn't finish the turn — only refetching the
  // real persisted history can say for sure. Deliberately skipped while a
  // send is actively in flight (`isSendingRef`): at that point nothing is
  // stuck (queue draining/finalization already happened for every prior
  // failure) and reconciling could otherwise race that in-flight turn.
  useEffect(() => {
    if (!active) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (isSendingRef.current) return;
      if (!messagesRef.current.some((m) => m.failed)) return;
      void refetchConversation().then((result) => {
        const fresh = result.data;
        if (!fresh) return;
        setMessages(fresh.messages);
        setConversationId(fresh.conversationId);
        setHasOlderMessages(fresh.hasMore);
        failedItemsRef.current.clear();
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [active, refetchConversation]);

  // ── Maximize-handoff hydration ────────────────────────────────────────────
  // When the full app was opened via the widget's maximize button, load the
  // exact conversation the widget was showing and — if a turn was mid-flight —
  // attach to the still-running generation so planning/streaming continues
  // seamlessly. Consumed exactly once; every failure path falls back silently
  // to plain persisted history (never an error for a maximize).
  const handoffConsumedRef = useRef(false);
  useEffect(() => {
    if (!active || handoff === null || initialized) return;
    if (handoffConsumedRef.current) return;
    handoffConsumedRef.current = true;
    let cancelled = false;

    const mapMsgs = (msgs: ConversationMessage[]): AssistantMessage[] =>
      msgs.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        attachmentUrls:
          m.attachmentUrls.length > 0 ? m.attachmentUrls : undefined,
        ...(m.runtimeTrace ? { runtimeTrace: m.runtimeTrace } : {}),
        ...(m.reasoningSummary ? { reasoningSummary: m.reasoningSummary } : {}),
        ...(m.reasoningDurationMs != null
          ? { reasoningDurationMs: m.reasoningDurationMs }
          : {}),
        ...(m.stopped ? { stopped: true } : {}),
        createdAt: m.createdAt,
      })) as AssistantMessage[];

    void (async () => {
      if (handoff.conversationId !== null) {
        setConversationId(handoff.conversationId);
        try {
          const page = await getElaineConversationMessagesFn(
            handoff.conversationId,
          );
          if (cancelled) return;
          setMessages(mapMsgs(page.messages));
          setHasOlderMessages(page.hasMore);
        } catch {
          // Start from an empty list — the resume stream (or a later refetch)
          // fills in what it can; a maximize must never surface an error.
        }
      }
      if (cancelled) return;
      setInitialized(true);

      if (!handoff.turnId) return;

      // Show the just-sent (not yet persisted) user message instantly while
      // attaching to the in-progress turn.
      const tempId = -++tempIdCounterRef.current;
      if (handoff.userMessage !== null) {
        setMessages((prev) => [
          ...prev,
          { id: tempId, role: "user", content: handoff.userMessage! },
        ]);
      }
      isSendingRef.current = true;
      setIsStreaming(true);
      turnStartRef.current = Date.now();
      hadReasoningRef.current = false;
      const pendingWidgets: ChatWidget[] = [];
      try {
        await resumeElaineTurnStream(handoff.turnId, {
          onDelta: (text) => {
            setStatusMessage("");
            streamingContentRef.current += text;
            setStreamingContent((prev) => prev + text);
          },
          onReasoningSummaryDelta: (delta) => {
            hadReasoningRef.current = true;
            setReasoningActive(true);
            setStreamingReasoningSummary((prev) => prev + delta);
          },
          onResponseReset: () => {
            streamingContentRef.current = "";
            setStreamingContent("");
          },
          onAction: (action) => setPendingActions((prev) => [...prev, action]),
          onStatus: (msg) => setStatusMessage(msg),
          onWidget: (widget) => pendingWidgets.push(widget as ChatWidget),
          onRuntime: ({ trace }) => setRuntimeTrace(trace),
          onDone: (res) => {
            if (hadReasoningRef.current) setReasoningActive(false);
            const assistantMsg: AssistantMessage = {
              id: res.assistantMessageId ?? undefined,
              role: "assistant",
              content: res.content,
              runtimeTrace: res.runtimeTrace,
              ...(res.reasoningSummary
                ? { reasoningSummary: res.reasoningSummary }
                : {}),
              ...(hadReasoningRef.current
                ? { reasoningDurationMs: Date.now() - turnStartRef.current }
                : {}),
            };
            setMessages((prev) => {
              // If the turn had already finished before our history fetch,
              // its persisted rows are in the fetched page — dedupe by id so
              // the replayed `done` never duplicates them.
              const withoutOptimistic = prev.filter((m) => m.id !== tempId);
              if (
                res.assistantMessageId != null &&
                withoutOptimistic.some((m) => m.id === res.assistantMessageId)
              ) {
                return withoutOptimistic;
              }
              const hasUserRow =
                res.userMessageId != null &&
                withoutOptimistic.some((m) => m.id === res.userMessageId);
              const userMsg: AssistantMessage = {
                id: res.userMessageId ?? undefined,
                role: "user",
                content: handoff.userMessage ?? "",
              };
              const includeUser =
                !hasUserRow &&
                (handoff.userMessage !== null || res.userMessageId != null);
              return [
                ...withoutOptimistic,
                ...(includeUser ? [userMsg] : []),
                assistantMsg,
              ];
            });
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
            // Skip conversation-ID update when a new chat was requested —
            // handleNewConversation fires last (below) and resets it to null;
            // updating it here first would win the React batch and leave the
            // hook pointing at the old conversation for the first render after
            // the new-chat transition.
            if (res.conversationId !== undefined && !res.newChatRequested) {
              setConversationId(res.conversationId);
              qc.invalidateQueries({
                queryKey: getListElaineConversationsQueryKey(),
              });
              qc.invalidateQueries({
                queryKey: getInfiniteElaineConversationsQueryKey(),
              });
            }
            setRuntimeTrace(null);
            // Fire last so its state resets (messages → [], conversationId →
            // null) always win the React batch over any earlier setConversationId
            // / setMessages calls above.
            if (res.newChatRequested) {
              // Clear any queued messages before rotating.  handleNewConversation
              // fires newConversation.mutate asynchronously — the new conversation
              // ID is only available in its onSuccess callback.  If we let the
              // queue drain normally the finally block would call runSend with
              // the OLD conversationId still captured in its closure, routing the
              // queued message to the wrong thread.  Discarding is correct: the
              // messages were composed in the context of the ending conversation.
              queueRef.current = [];
              handleNewConversation();
            }
          },
        });
      } catch {
        // Turn expired/unknown or the stream broke — reconcile quietly
        // against persisted history (which, if the turn finished, already
        // contains the final message).
        try {
          if (handoff.conversationId === null) throw new Error("no conv");
          const page = await getElaineConversationMessagesFn(
            handoff.conversationId,
          );
          if (!cancelled) {
            setMessages(mapMsgs(page.messages));
            setHasOlderMessages(page.hasMore);
          }
        } catch {
          if (!cancelled) {
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
          }
        }
      } finally {
        if (!cancelled) {
          if (hadReasoningRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          setStreamingContent("");
          streamingContentRef.current = "";
          setStreamingReasoningSummary("");
          setStatusMessage("");
          setRuntimeTrace(null);
          setIsStreaming(false);
          currentTurnIdRef.current = null;
          currentTurnConversationIdRef.current = null;
          flushTurnIdWaiters(null);
          isSendingRef.current = false;
          // Anything the user queued while the resumed turn was streaming
          // sends now, exactly like the normal post-turn queue drain.
          const next = queueRef.current.shift();
          if (next) void runSend(next);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot hydration; runSend & setters are stable for its purposes
  }, [active, handoff, initialized]);

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
        ...(m.reasoningDurationMs != null
          ? { reasoningDurationMs: m.reasoningDurationMs }
          : {}),
        ...(m.stopped ? { stopped: true } : {}),
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
        ...(m.reasoningDurationMs != null
          ? { reasoningDurationMs: m.reasoningDurationMs }
          : {}),
        ...(m.stopped ? { stopped: true } : {}),
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
    const fileType: PendingAttachment["fileType"] =
      file.type === "application/pdf"
        ? "pdf"
        : (DOC_MIME_TO_TYPE[file.type] ?? "image");
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

  /** Cancels the currently-streaming turn. The client immediately finalizes
   *  whatever had been displayed as a locally-marked "stopped" message; the
   *  server (which sees the same disconnect) persists the authoritative
   *  version with `stopped: true` so a later reload shows the real content.
   *  Any queued messages still send automatically once this turn's `finally`
   *  block runs. */
  function handleStop() {
    currentAbortControllerRef.current?.abort();
  }

  /** Actually sends one message to the server and streams its reply. Called
   *  either immediately (no turn in flight) or by the queue drain below once
   *  a prior turn finishes or is stopped — never called directly while
   *  another call to this function is still running. */
  async function runSend(item: QueuedSend) {
    isSendingRef.current = true;
    // No-op if this message was sent immediately (never queued); clears the
    // "queued" badge if it was waiting in line.
    setMessages((prev) =>
      prev.map((m) => (m.id === item.tempId ? { ...m, queued: false } : m)),
    );
    setPendingNavigate(null);
    setPendingActions([]);
    setExecutedActions([]);
    setActionDone(false);
    setStreamingContent("");
    streamingContentRef.current = "";
    setStreamingReasoningSummary("");
    setStatusMessage("");
    setRuntimeTrace(null);
    hadReasoningRef.current = false;
    setReasoningActive(false);
    turnStartRef.current = Date.now();
    setIsStreaming(true);
    // accumulate widgets for the new assistant turn
    const pendingWidgets: ChatWidget[] = [];
    const abortController = new AbortController();
    currentAbortControllerRef.current = abortController;

    try {
      const pageScreenshotUrl = bgScreenshotUrlRef.current ?? undefined;
      // Refresh screenshot in the background for the next message.
      void captureBgScreenshot();

      const result = await streamElaineMessage(
        {
          message: item.trimmed,
          pageContext: getPageContext(),
          appId,
          ...(conversationId !== null ? { conversationId } : {}),
          ...(item.uploadedAttachmentUrls.length > 0
            ? { attachmentUrls: item.uploadedAttachmentUrls }
            : {}),
          ...(item.uploadedPdfs.length > 0
            ? { attachmentPdfs: item.uploadedPdfs }
            : {}),
          ...(item.uploadedDocs.length > 0
            ? { attachmentDocs: item.uploadedDocs }
            : {}),
          ...(pageScreenshotUrl ? { pageScreenshotUrl } : {}),
          ...(geoRef.current
            ? { userLat: geoRef.current.lat, userLng: geoRef.current.lng }
            : {}),
        },
        {
          onTurnId: (info) => {
            currentTurnIdRef.current = info.turnId;
            currentTurnConversationIdRef.current = info.conversationId;
            flushTurnIdWaiters(info);
          },
          onDelta: (text) => {
            setStatusMessage("");
            streamingContentRef.current += text;
            setStreamingContent((prev) => prev + text);
          },
          onReasoningSummaryDelta: (delta) => {
            hadReasoningRef.current = true;
            setReasoningActive(true);
            setStreamingReasoningSummary((prev) => prev + delta);
          },
          onResponseReset: () => {
            streamingContentRef.current = "";
            setStreamingContent("");
          },
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
            // Stop force-holding the live panel open the moment we know the
            // turn is done, while the bubble is still mounted (isStreaming
            // hasn't flipped false yet) — this is what lets the disclosure
            // visibly collapse instead of just disappearing.
            if (hadReasoningRef.current) setReasoningActive(false);
            const assistantMsg: AssistantMessage = {
              id: res.assistantMessageId ?? undefined,
              role: "assistant",
              content: res.content,
              runtimeTrace: res.runtimeTrace,
              ...(res.reasoningSummary
                ? { reasoningSummary: res.reasoningSummary }
                : {}),
              ...(hadReasoningRef.current
                ? { reasoningDurationMs: Date.now() - turnStartRef.current }
                : {}),
            };
            setMessages((prev) => {
              const optimisticIdx = prev.findIndex((m) => m.id === item.tempId);
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
            // Skip conversation-ID update when a new chat was requested —
            // handleNewConversation fires last (below) and resets it to null;
            // updating it here first would win the React batch and leave the
            // hook pointing at the old conversation for the first render after
            // the new-chat transition.
            if (res.conversationId !== undefined && !res.newChatRequested) {
              setConversationId(res.conversationId);
              qc.invalidateQueries({
                queryKey: getListElaineConversationsQueryKey(),
              });
              qc.invalidateQueries({
                queryKey: getInfiniteElaineConversationsQueryKey(),
              });
            }
            setRuntimeTrace(null);
            // Fire last so its state resets (messages → [], conversationId →
            // null) always win the React batch over any earlier setConversationId
            // / setMessages calls above.
            if (res.newChatRequested) {
              // Clear any queued messages before rotating — see the same guard
              // in the handoff path above for the full rationale.
              queueRef.current = [];
              handleNewConversation();
            }
          },
        },
        abortController.signal,
      );
      void result;
    } catch {
      if (abortController.signal.aborted) {
        // User-initiated Stop: the server never gets to send `done` over the
        // now-closed connection, so finalize locally with whatever had
        // streamed in — the server independently persists the authoritative
        // `stopped: true` row, which a reload will show in its place.
        if (hadReasoningRef.current) setReasoningActive(false);
        const stoppedAssistantId = -++tempIdCounterRef.current;
        setMessages((prev) => [
          ...prev,
          {
            id: stoppedAssistantId,
            role: "assistant",
            content: streamingContentRef.current,
            stopped: true,
          },
        ]);
        setPendingActions([]);
        setRuntimeTrace(null);
      } else {
        // The request died without a server response — most commonly the
        // connection was killed outright (mobile OS suspending/closing the
        // app mid-request is the single most common real-world cause).
        // Previously this removed the optimistic message entirely, which
        // made a message the user actually sent just vanish from the chat
        // with only an easy-to-miss toast — indistinguishable from it never
        // having been sent, so the natural reaction was to retype and resend
        // it. Instead, keep it visible and mark it failed so the user can
        // see exactly what happened and retry with one tap; a background
        // reconciliation (see the visibilitychange handler below) will
        // silently clear this if the server actually did finish the turn.
        failedItemsRef.current.set(item.tempId, item);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === item.tempId ? { ...m, queued: false, failed: true } : m,
          ),
        );
        toast.error(
          <>
            <ElaineName /> couldn't respond — check your connection and tap the
            message to retry.
          </>,
        );
        setPendingActions([]);
        setRuntimeTrace(null);
      }
    } finally {
      // If the live "Thinking" panel was ever shown, give its collapse
      // animation (triggered by `setReasoningActive(false)` in onDone above)
      // a brief moment to actually play before the streaming bubble is
      // unmounted and swapped for the persisted message — otherwise the
      // panel would just vanish rather than visibly close.
      if (hadReasoningRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      setStreamingContent("");
      streamingContentRef.current = "";
      setStreamingReasoningSummary("");
      setStatusMessage("");
      setRuntimeTrace(null);
      setIsStreaming(false);
      currentAbortControllerRef.current = null;
      currentTurnIdRef.current = null;
      currentTurnConversationIdRef.current = null;
      flushTurnIdWaiters(null);
      isSendingRef.current = false;

      // Drain the queue: the moment this turn is done (normally or via
      // Stop), the next queued message — if any — sends automatically,
      // strictly in the order it was queued.
      const next = queueRef.current.shift();
      if (next) void runSend(next);
    }
  }

  /** Resends a message that previously failed without ever reaching the
   *  server (see the `failed` handling in runSend's catch block above).
   *  Reuses the exact original text/attachments so the user never has to
   *  retype anything — they just tap the failed message. */
  function retrySend(tempId: number) {
    const item = failedItemsRef.current.get(tempId);
    if (!item) return;
    failedItemsRef.current.delete(tempId);
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, failed: false } : m)),
    );
    if (isSendingRef.current) {
      // A different turn is already in flight (e.g. a queued message sent
      // while this one was sitting failed) — rejoin the queue rather than
      // racing it.
      queueRef.current.push(item);
      return;
    }
    void runSend(item);
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
    const docAttachments = readyAttachments.filter(
      (a) =>
        a.fileType === "csv" || a.fileType === "docx" || a.fileType === "xlsx",
    );
    const uploadedAttachmentUrls = imageAttachments.map((a) => a.uploadedUrl!);
    const uploadedPdfs = pdfAttachments.map((a) => ({
      url: a.uploadedUrl!,
      name: a.fileName,
      extractedText: a.extractedText,
    }));
    const uploadedDocs = docAttachments.map((a) => ({
      url: a.uploadedUrl!,
      name: a.fileName,
      docType: a.fileType as "csv" | "docx" | "xlsx",
      extractedText: a.extractedText,
    }));
    const hasAttachments =
      uploadedAttachmentUrls.length > 0 ||
      uploadedPdfs.length > 0 ||
      uploadedDocs.length > 0;

    // Must have either a message body or at least one ready attachment
    if (!trimmed && !hasAttachments) return;

    setInput("");
    clearAttachments();
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
      ...docAttachments.map((a) => ({
        url: a.uploadedUrl!,
        type: a.fileType as "csv" | "docx" | "xlsx",
        name: a.fileName,
      })),
    ];
    // A turn is already streaming — queue this one instead of blocking the
    // composer. It's shown right away (marked pending/queued) and will send
    // automatically, in order, once the in-progress turn finishes or stops.
    const willQueue = isSendingRef.current;
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
        ...(willQueue ? { queued: true } : {}),
      },
    ]);

    const item: QueuedSend = {
      tempId,
      trimmed,
      uploadedAttachmentUrls,
      uploadedPdfs,
      uploadedDocs,
    };

    if (willQueue) {
      queueRef.current.push(item);
      return;
    }

    await runSend(item);
  }

  function handleConfirmNavigate(onAfter?: () => void) {
    if (!pendingNavigate) return;
    const path = pendingNavigate.path;
    setPendingNavigate(null);
    // Cross-SPA paths (start with /pottery, /quilting, /travels, /magnets,
    // /elaine) need
    // a full page load because they belong to a different React bundle.
    // Using wouter's navigate() for these would just render a 404 within the
    // current SPA instead of loading the correct app.
    const CROSS_SPA_PREFIXES = [
      "/pottery",
      "/quilting",
      "/ornaments",
      "/magnets",
      "/travels",
      "/elaine",
    ];
    const isCrossSpa = CROSS_SPA_PREFIXES.some(
      (prefix) =>
        path === prefix ||
        path.startsWith(prefix + "/") ||
        path.startsWith(prefix + "?"),
    );
    // Pottery/quilting/travels/ornaments/magnets are now merged under the "modules"
    // artifact, which mounts a single wouter Router at base "/modules" and
    // routes every merged app under its own literal "/pottery", "/quilting",
    // etc. prefix (e.g. "/travels/wishlist"). Elaine's tool contract still
    // emits paths relative to the requesting app's own "home" (e.g. "/wishlist"
    // for a same-app suggestion), since that contract predates the merge and
    // still matches how each app runs standalone. When this bundle IS the
    // modules host, same-app relative paths and old-style cross-app prefixes
    // both need the "/modules" segment (and same-app paths also need their
    // own app prefix) added before handing off to wouter/window.location.
    const MERGED_APP_IDS = [
      "pottery",
      "quilting",
      "travels",
      "ornaments",
      "magnets",
    ];
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

  /** Called by the widget's maximize button right before navigating to the
   *  full Elaine app. When a turn is mid-flight it signals the server to keep
   *  generating despite the imminent disconnect — the promise resolves only
   *  after the server has acknowledged, so navigating on resolution can't
   *  race the socket close — and returns the minimal state the full app
   *  needs to hydrate seamlessly. If the user maximizes in the instant
   *  between pressing Send and the server's `turn` event arriving, this
   *  waits (bounded) for the turn id rather than navigating as an
   *  unsignaled in-flight turn. When idle, only the conversation id is
   *  returned so the full app opens the same conversation. */
  async function beginHandoff(): Promise<{
    conversationId: number | null;
    turnId: string | null;
    userMessage: string | null;
  }> {
    if (!isSendingRef.current) {
      return { conversationId, turnId: null, userMessage: null };
    }
    let turnId = currentTurnIdRef.current;
    let turnConvId = currentTurnConversationIdRef.current;
    if (turnId === null) {
      // Send already started but the `turn` SSE event hasn't reached us yet
      // — wait for it (bounded) so the handoff can still be signaled. The
      // waiter is also flushed (with null) if the turn ends/errors first.
      const info = await new Promise<{
        turnId: string;
        conversationId: number | null;
      } | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 5000);
        turnIdWaitersRef.current.push((i) => {
          clearTimeout(timer);
          resolve(i);
        });
      });
      turnId = info?.turnId ?? currentTurnIdRef.current;
      turnConvId = info?.conversationId ?? currentTurnConversationIdRef.current;
    }
    if (turnId === null) {
      // Timed out / turn ended without an id — nothing to hand off; treat as
      // an idle maximize so the full app at least opens the conversation.
      return { conversationId, turnId: null, userMessage: null };
    }
    let userMessage: string | null = null;
    for (let i = messagesRef.current.length - 1; i >= 0; i--) {
      const m = messagesRef.current[i];
      if (m && m.role === "user") {
        userMessage = m.content;
        break;
      }
    }
    // Await the server's acknowledgement BEFORE the caller navigates —
    // otherwise the disconnect could win the race and abort the turn.
    await signalElaineTurnHandoff(turnId);
    // Prefer the streaming turn's authoritative conversation id (from the
    // `turn` SSE event) — for a turn that started a brand-new conversation,
    // the hook's `conversationId` state is still null until `done`.
    return {
      conversationId: turnConvId ?? conversationId,
      turnId,
      userMessage,
    };
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
    reasoningActive,
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
    handleStop,
    retrySend,
    handleConfirmNavigate,
    handleConfirmAction,
    handleSkipAction,
    handleConfirmAll,
    handleCancelAll,
    beginHandoff,
  };
}

export type ElaineChat = ReturnType<typeof useElaineChat>;
