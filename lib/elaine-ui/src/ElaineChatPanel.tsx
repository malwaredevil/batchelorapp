import {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { BarcodeScanButton } from "./BarcodeScanButton";
import {
  Send,
  ArrowRight,
  Check,
  X,
  Paperclip,
  Loader2,
  FileText,
  Mic,
  Volume2,
  VolumeX,
  Settings2,
  Play,
  Square,
  Sun,
  Radio,
  Phone,
  Mail,
  MessageSquare,
  Hash,
  AlertCircle,
  Users,
} from "lucide-react";
import {
  useGetElaineDailyBrief,
  useDismissElaineDailyBrief,
  useGetElaineCrossChannelContext,
  useClearElaineCrossChannelContext,
  type CrossChannelEntry,
  type AssistantMessage,
} from "@workspace/api-client-react";
import { crossAppUrl } from "@workspace/web-core/cross-app";
import { useVoiceInput } from "./useVoiceInput";
import { useTTS, DEFAULT_VOICE_PREVIEW_KEY } from "./useTTS";
import { Button } from "@workspace/ui";
import { Textarea } from "@workspace/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@workspace/ui";
import { ElaineAvatar, ElaineName } from "./ElaineAvatar";
import type { ElaineChat } from "./useElaineChat";
import { MarkdownMessage } from "./MarkdownMessage";
import { ChatWidget } from "./ChatWidgets";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { ElainePlanProgress } from "./ElainePlanProgress";

// ─── Communication action result helpers ─────────────────────────────────────

type DeliveryChannel = "sms" | "voice" | "email" | "slack" | "elaine_chat";

function ChannelIcon({
  channel,
  className,
}: {
  channel: string;
  className?: string;
}) {
  switch (channel as DeliveryChannel) {
    case "sms":
    case "voice":
      return <Phone className={className} />;
    case "email":
      return <Mail className={className} />;
    case "slack":
      return <Hash className={className} />;
    case "elaine_chat":
      return <MessageSquare className={className} />;
    default:
      return <MessageSquare className={className} />;
  }
}

function channelDisplayLabel(channel: string): string {
  switch (channel as DeliveryChannel) {
    case "sms":
      return "SMS";
    case "voice":
      return "Phone call";
    case "email":
      return "Email";
    case "slack":
      return "Slack DM";
    case "elaine_chat":
      return "Elaine chat";
    default:
      return channel;
  }
}

/**
 * Extracts the communication result payload from an executed action's result
 * body. The server wraps successful results as `{ type, result: { ... } }` and
 * errors as `{ error: string }`.
 */
function parseCommunicationResult(result: unknown): {
  channel?: string;
  contactName?: string;
  callId?: string;
  recipients?: Array<{
    name: string;
    channel: string | null;
    ok: boolean;
    error: string | null;
  }>;
  error?: string;
} {
  if (!result || typeof result !== "object") return {};
  const body = result as Record<string, unknown>;
  if (typeof body.error === "string") return { error: body.error };
  const inner = body.result as Record<string, unknown> | undefined;
  if (!inner) return {};
  return {
    channel: typeof inner.channel === "string" ? inner.channel : undefined,
    contactName:
      typeof inner.contactName === "string" ? inner.contactName : undefined,
    callId: typeof inner.callId === "string" ? inner.callId : undefined,
    recipients: Array.isArray(inner.recipients)
      ? (inner.recipients as Array<{
          name: string;
          channel: string | null;
          ok: boolean;
          error: string | null;
        }>)
      : undefined,
  };
}

// ─── Response-complete chime ──────────────────────────────────────────────────
function playResponseChime(): void {
  try {
    new Audio("https://replit.com/public/sounds/Achievement_Bell_Replit.wav")
      .play()
      .catch(() => {});
  } catch {
    // Audio not available
  }
}

const URL_RE = /https?:\/\/[^\s)>"]+/;
function extractFirstUrl(text: string | undefined | null): string | null {
  if (!text) return null;
  return text.match(URL_RE)?.[0] ?? null;
}

/** Splits a stored message content into display text + citation URL list.
 *  \x1f (ASCII unit separator) is the delimiter — safe in PostgreSQL JSONB
 *  (unlike \x00) and never emitted by the model. */
function parseMessageCitations(content: string): {
  text: string;
  citations: string[];
} {
  const nullIdx = content.indexOf("\x1f");
  if (nullIdx === -1) return { text: content, citations: [] };
  const suffix = content.slice(nullIdx + 1);
  let citations: string[] = [];
  try {
    citations = JSON.parse(suffix);
    if (!Array.isArray(citations)) citations = [];
  } catch {
    citations = [];
  }
  return { text: content.slice(0, nullIdx), citations };
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

/** Local calendar date string "YYYY-MM-DD" for an ISO timestamp. */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", "Mon", "Aug 1" label for a date separator. */
function formatSeparatorLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (localDateStr(iso) === localDateStr(now.toISOString())) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return d.toLocaleDateString(undefined, { weekday: "short" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "2:34 PM" time string for an inline run-end timestamp. */
function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Chat item model ──────────────────────────────────────────────────────────

/** Pre-processed flat list of things to render in the chat panel. */
type ChatItem =
  | { kind: "separator"; label: string; key: string }
  | {
      kind: "message";
      msg: AssistantMessage;
      index: number;
      /** Show an inline time string below this message (end of a sender run). */
      showTimestamp: boolean;
    };

function buildChatItems(messages: AssistantMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let lastDateStr = "";

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // Date separator when the calendar date changes between messages.
    if (msg.createdAt) {
      const dateStr = localDateStr(msg.createdAt);
      if (dateStr !== lastDateStr) {
        items.push({
          kind: "separator",
          label: formatSeparatorLabel(msg.createdAt),
          key: `sep-${dateStr}`,
        });
        lastDateStr = dateStr;
      }
    }

    // Show a timestamp on this message if it is the last in its sender run:
    //   • next message has a different role, OR
    //   • next message falls on a different calendar day, OR
    //   • this is the last message in the list.
    const next = messages[i + 1];
    const runEnds =
      msg.createdAt != null &&
      (!next ||
        next.role !== msg.role ||
        !next.createdAt ||
        localDateStr(next.createdAt) !== localDateStr(msg.createdAt));

    items.push({ kind: "message", msg, index: i, showTimestamp: runEnds });
  }

  return items;
}

/** Renders message text with markdown + [N] citation markers turned into clickable links. */
function MessageText({
  text,
  citations,
}: {
  text: string;
  citations: string[];
}) {
  if (citations.length === 0) return <MarkdownMessage text={text} />;

  // Inject citation links as inline [N] markers inside the final text block
  // by replacing [N] references with anchor elements after markdown rendering.
  // For simplicity: split on [N] markers, render text blocks as markdown, links inline.
  const parts = text.split(/(\[\d+\])/g);
  return (
    <div className="space-y-0.5">
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (m) {
          const idx = parseInt(m[1]!, 10) - 1;
          const url = citations[idx];
          if (url) {
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded bg-primary/10 px-0.5 text-xs font-semibold text-primary hover:bg-primary/20"
                onClick={(e) => e.stopPropagation()}
              >
                {part}
              </a>
            );
          }
        }
        return part ? <MarkdownMessage key={i} text={part} /> : null;
      })}
    </div>
  );
}

function formatThinkingDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/**
 * Collapsible "Thinking…" disclosure shown above an assistant reply when the
 * model produced a reasoning summary, mirroring ChatGPT's "Thought for Xs"
 * pattern. `streaming` keeps it open while the summary is still arriving;
 * when it flips back to false (turn finished) it auto-collapses on its own,
 * unless the user already manually toggled it during this turn — after
 * that, or once collapsed, the user is back in full control of expansion.
 */
function ThinkingDisclosure({
  summary,
  streaming = false,
  durationMs,
}: {
  summary: string;
  streaming?: boolean;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(streaming);
  const userToggledRef = useRef(false);
  const wasStreamingRef = useRef(streaming);

  useEffect(() => {
    if (streaming) {
      setOpen(true);
    } else if (wasStreamingRef.current && !userToggledRef.current) {
      // Just finished this turn and the user hasn't touched the toggle —
      // auto-collapse, same as ChatGPT does once the answer is ready.
      setOpen(false);
    }
    wasStreamingRef.current = streaming;
  }, [streaming]);

  const label = streaming
    ? "Thinking…"
    : durationMs !== undefined
      ? `Thought for ${formatThinkingDuration(durationMs)}`
      : "Thinking";

  return (
    <div className="rounded-xl border border-border/50 bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <span className="font-medium transition-opacity duration-150">
          {label}
        </span>
      </button>
      {/* Grid-row height animation: 0fr → 1fr slides the content open/closed
          without needing external keyframe CSS or JS measurement. The inner
          div must have overflow:hidden so the 0fr state truly clips content. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="px-3 pb-3 pt-0 text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {summary}
            {streaming && (
              <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-muted-foreground" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const TTS_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

interface ElaineChatPanelProps {
  chat: ElaineChat;
  onNavigated?: () => void;
  avatarSize?: number;
  bubbleWidthClass?: string;
  emptyState?: ReactNode;
  /** Rendered before the message textarea, e.g. an app-specific attachment
   *  button (travels uses this for its magnet-check camera button). */
  composerLeftSlot?: ReactNode;
  /** Rendered above the composer, below the message list — for app-specific
   *  in-progress cards (travels uses this for the magnet-check result). */
  belowMessagesSlot?: ReactNode;
  /** When true, suppresses the morning brief banner inside the panel. Use
   *  this on surfaces that already render the brief themselves (e.g. the
   *  full Elaine chat page renders it as a top-level banner above the panel). */
  hideBrief?: boolean;
}

/**
 * Renders the full conversation log, pending-action/confirmation cards, and
 * the message composer. Shared by every Elaine surface (floating widget,
 * full-screen chat) across every app so tool access and confirmation UX
 * stay identical everywhere.
 */
export function ElaineChatPanel({
  chat,
  onNavigated,
  avatarSize = 26,
  bubbleWidthClass = "max-w-[85%]",
  emptyState,
  composerLeftSlot,
  belowMessagesSlot,
  hideBrief = false,
}: ElaineChatPanelProps) {
  const {
    settings,
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
    hasOlderMessages,
    isLoadingOlder,
    loadOlderMessages,
    pendingAttachments,
    handleAddAttachment,
    handleRemoveAttachment,
    handleSend,
    handleConfirmNavigate,
    handleConfirmAction,
    handleSkipAction,
    handleConfirmAll,
    handleCancelAll,
  } = chat;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ── Infinite scroll-up (load older messages) ──────────────────────────────
  // Scrolling near the top of the message list fetches the previous page and
  // prepends it. Prepending grows the scrollable content above the viewport,
  // so without correction the browser would visually jump; we record the
  // scroll height right before the fetch and restore the same visual
  // position afterward once the new content has been laid out.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pendingScrollAdjustRef = useRef<number | null>(null);
  const SCROLL_TOP_LOAD_THRESHOLD = 80;

  const handleMessagesScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || isLoadingOlder || !hasOlderMessages) return;
    if (el.scrollTop < SCROLL_TOP_LOAD_THRESHOLD) {
      pendingScrollAdjustRef.current = el.scrollHeight;
      void loadOlderMessages();
    }
  }, [isLoadingOlder, hasOlderMessages, loadOlderMessages]);

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    const prevHeight = pendingScrollAdjustRef.current;
    if (el && prevHeight !== null) {
      el.scrollTop += el.scrollHeight - prevHeight;
      pendingScrollAdjustRef.current = null;
    }
  }, [messages]);

  // ── Fill-the-viewport backstop ────────────────────────────────────────────
  // Scroll-up-to-load only fires once the container is actually scrollable.
  // If a page of history (e.g. the initial 30, or a short subsequent page)
  // doesn't produce enough content to overflow the panel, the user can never
  // generate the scroll event that would load more — older history would be
  // silently stranded even though `hasOlderMessages` is true. Keep loading
  // more pages after every render until either the content overflows (normal
  // scroll-up takes over from here) or history is exhausted.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || isLoadingOlder || !hasOlderMessages) return;
    if (el.scrollHeight <= el.clientHeight) {
      void loadOlderMessages();
    }
  }, [messages, isLoadingOlder, hasOlderMessages, loadOlderMessages]);

  const hasUploadingAttachments = pendingAttachments.some((a) => a.uploading);

  // ── Voice input ─────────────────────────────────────────────────────────
  // Saves the input text at the moment recording starts so interim / final
  // results are appended rather than replacing what the user already typed.
  const voiceBaseRef = useRef("");

  const voice = useVoiceInput({
    onTranscript: useCallback(
      (text: string, isFinal: boolean) => {
        const base = voiceBaseRef.current;
        const sep = base.length > 0 ? " " : "";
        const next = base + sep + text;
        setInput(next);
        if (isFinal) {
          // Update base so a subsequent recording session appends to this.
          voiceBaseRef.current = next;
        }
      },
      [setInput],
    ),
  });

  const handleMicToggle = useCallback(() => {
    if (voice.isListening) {
      voice.stop();
    } else {
      voiceBaseRef.current = input;
      voice.start();
    }
  }, [voice, input]);

  // ── Text-to-speech ──────────────────────────────────────────────────────
  const tts = useTTS();

  // Stop reading the instant a new message starts streaming in.
  useEffect(() => {
    if (isStreaming) tts.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  // Speak the latest assistant reply once it finishes streaming.
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = isStreaming;
    if (!wasStreaming || isStreaming) return;
    // Play the completion chime every time Elaine finishes a response.
    playResponseChime();
    if (!tts.enabled) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      const { text } = parseMessageCitations(last.content);
      tts.speak(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, messages, tts.enabled]);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      if (tts.isSpeaking) tts.stop();
    },
    [setInput, tts],
  );

  // Morning brief — shown as dismissible banner when the widget opens
  const { data: brief, refetch: refetchBrief } = useGetElaineDailyBrief();
  const dismissBrief = useDismissElaineDailyBrief({
    mutation: { onSuccess: () => void refetchBrief() },
  });
  const showBrief =
    !hideBrief && brief != null && !brief.dismissed && brief.content.length > 0;

  // Cross-channel activity — compact summary of recent SMS/email/Slack turns
  const { data: crossChannel, refetch: refetchCrossChannel } =
    useGetElaineCrossChannelContext();
  const clearCrossChannel = useClearElaineCrossChannelContext({
    mutation: { onSuccess: () => void refetchCrossChannel() },
  });
  const crossChannelEntries: CrossChannelEntry[] = crossChannel?.entries ?? [];
  // Show at most 2 most-recent entries, but only those within the last 7 days.
  // Uses the ISO timestamp added to new entries; entries that predate the field
  // (no `iso`) are treated as too old and silently excluded.
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const recentEntries = crossChannelEntries
    .filter(
      (e) => e.iso != null && now - new Date(e.iso).getTime() <= SEVEN_DAYS_MS,
    )
    .slice(0, 2);
  const showCrossChannel = !hideBrief && recentEntries.length > 0;

  return (
    <>
      <div
        ref={scrollContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {isLoadingOlder && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading earlier messages…
          </div>
        )}
        {showBrief && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3.5 py-3 text-sm text-foreground leading-relaxed relative">
            <div className="flex items-start gap-2">
              <Sun className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="flex-1 whitespace-pre-wrap">{brief.content}</p>
              <button
                onClick={() => dismissBrief.mutate()}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {showCrossChannel && (
          <div className="rounded-xl border border-border/60 bg-muted/40 px-3.5 py-3 text-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <Radio className="w-3 h-3" />
                Recent on other channels
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={crossAppUrl("/elaine/memory")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                >
                  See all
                </a>
                <button
                  onClick={() => clearCrossChannel.mutate()}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <ul className="space-y-1.5">
              {recentEntries.map((entry: CrossChannelEntry, i: number) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs text-foreground/80 leading-relaxed"
                >
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground leading-none mt-0.5">
                    {entry.channel}
                  </span>
                  <span className="flex-1 line-clamp-2">{entry.gist}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.length === 0 &&
          !isStreaming &&
          (emptyState ?? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ElaineAvatar size={48} />
              <p className="text-sm text-muted-foreground">
                Hi, I'm <ElaineName />! Ask me anything, or whatever's on your
                screen.
              </p>
            </div>
          ))}

        {buildChatItems(messages).map((item) => {
          if (item.kind === "separator") {
            return (
              <div
                key={item.key}
                className="flex items-center gap-3 px-1 py-1"
                aria-hidden="true"
              >
                <div className="h-px flex-1 bg-border/50" />
                <span className="shrink-0 text-[11px] text-muted-foreground/60 font-normal select-none">
                  {item.label}
                </span>
                <div className="h-px flex-1 bg-border/50" />
              </div>
            );
          }

          const { msg, index: i, showTimestamp } = item;

          if (msg.role === "user") {
            const firstUserUrl = extractFirstUrl(msg.content);
            return (
              <div key={i} className="flex flex-col items-end gap-1">
                <div className="flex gap-2.5 justify-end w-full">
                  <div
                    className={`${bubbleWidthClass} rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground`}
                  >
                    {msg.attachmentUrls && msg.attachmentUrls.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {msg.attachmentUrls.map((ref, j) => {
                          // Older stored messages may still be plain URL strings —
                          // fall back to sniffing the URL when there's no `type`/`name`.
                          const url = typeof ref === "string" ? ref : ref.url;
                          const isPdf =
                            typeof ref === "string"
                              ? /\.pdf([?#]|$)/i.test(ref)
                              : ref.type === "pdf";
                          if (isPdf) {
                            const storedName =
                              typeof ref === "string" ? undefined : ref.name;
                            const match = url.match(/\/([^/?#]+\.pdf)/i);
                            const filename =
                              storedName ??
                              (match
                                ? decodeURIComponent(match[1])
                                : "document.pdf");
                            return (
                              <a
                                key={j}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 rounded-lg bg-primary-foreground/15 px-2 py-1 transition-colors hover:bg-primary-foreground/25"
                                title={`Open ${filename}`}
                              >
                                <FileText className="h-4 w-4 shrink-0" />
                                <span className="max-w-[140px] truncate text-xs">
                                  {filename}
                                </span>
                              </a>
                            );
                          }
                          return (
                            <button
                              key={j}
                              type="button"
                              onClick={() => setLightboxUrl(url)}
                              className="block cursor-zoom-in"
                              title="View image"
                            >
                              <img
                                src={url}
                                alt=""
                                className="h-20 w-20 rounded-lg object-cover"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {msg.content && (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                </div>
                {showTimestamp && msg.createdAt && (
                  <span className="mr-1 text-[11px] text-muted-foreground/50 select-none tabular-nums">
                    {formatMessageTime(msg.createdAt)}
                  </span>
                )}
                {firstUserUrl && <LinkPreviewCard url={firstUserUrl} />}
              </div>
            );
          }
          const { text, citations } = parseMessageCitations(msg.content);
          const firstAssistantUrl = extractFirstUrl(text);
          // Keyed by the message's own (stable) id, not its array position:
          // loadOlderMessages() prepends pages above the currently-rendered
          // messages, which would otherwise invalidate any index captured
          // when the widgets were originally attached.
          const widgets =
            msg.id !== undefined ? messageWidgets.get(msg.id) : undefined;
          return (
            <div key={i} className="flex gap-2.5 justify-start">
              <ElaineAvatar
                size={avatarSize}
                className="mt-0.5"
                animated={false}
              />
              <div className={`${bubbleWidthClass} flex flex-col gap-1.5`}>
                {msg.runtimeTrace && (
                  <ElainePlanProgress trace={msg.runtimeTrace} />
                )}
                {msg.reasoningSummary && (
                  <ThinkingDisclosure
                    summary={msg.reasoningSummary}
                    durationMs={msg.reasoningDurationMs}
                  />
                )}
                <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                  <MessageText text={text} citations={citations} />
                </div>
                {widgets && widgets.length > 0 && (
                  <div className="flex flex-col gap-2 pl-0.5">
                    {widgets.map((widget, wi) => (
                      <ChatWidget key={wi} widget={widget} />
                    ))}
                  </div>
                )}
                {citations.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
                    {citations.map((url, ci) => {
                      let host = url;
                      try {
                        host = new URL(url).hostname.replace(/^www\./, "");
                      } catch {
                        // keep raw url
                      }
                      return (
                        <a
                          key={ci}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <span className="font-semibold text-primary">
                            [{ci + 1}]
                          </span>
                          <span className="max-w-[180px] truncate">{host}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
                {firstAssistantUrl && (
                  <LinkPreviewCard url={firstAssistantUrl} />
                )}
                {showTimestamp && msg.createdAt && (
                  <span className="ml-1 text-[11px] text-muted-foreground/50 select-none tabular-nums">
                    {formatMessageTime(msg.createdAt)}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {isStreaming && (
          <div className="flex gap-2.5 justify-start">
            <ElaineAvatar
              size={avatarSize}
              className="mt-0.5"
              animated={false}
            />
            <div className={`${bubbleWidthClass} flex flex-col gap-1.5`}>
              {runtimeTrace && <ElainePlanProgress trace={runtimeTrace} live />}
              {streamingReasoningSummary && (
                <ThinkingDisclosure
                  summary={streamingReasoningSummary}
                  streaming={reasoningActive}
                />
              )}
              {streamingContent ? (
                <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                  <MarkdownMessage text={streamingContent} />
                </div>
              ) : statusMessage ? (
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
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
          </div>
        )}

        {pendingNavigate && (
          <div className="ml-8 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              Take you to{" "}
              <span className="font-medium text-foreground">
                {pendingNavigate.reason}
              </span>
              ?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => {
                  handleConfirmNavigate(onNavigated);
                }}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                Go
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setPendingNavigate(null)}
              >
                Stay here
              </Button>
            </div>
          </div>
        )}

        {pendingActions.length > 0 && !actionDone && (
          <div className="ml-8 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            {settings?.actionConfirmationMode === "one_by_one" ? (
              <>
                <p className="text-xs font-medium text-foreground">
                  {pendingActions[0]!.label}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    disabled={executeAction.isPending}
                    onClick={handleConfirmAction}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={handleSkipAction}
                  >
                    <X className="h-3.5 w-3.5" />
                    Skip
                  </Button>
                </div>
                {pendingActions.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    +{pendingActions.length - 1} more
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-foreground">
                  {pendingActions.length} action
                  {pendingActions.length > 1 ? "s" : ""} ready
                </p>
                <ul className="space-y-1">
                  {pendingActions.map((action, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      • {action.label}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    disabled={confirmingAll}
                    onClick={handleConfirmAll}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Confirm all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={handleCancelAll}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {actionDone &&
          executedActions.length > 0 &&
          (() => {
            // Separate communication actions from generic ones
            const commActions = executedActions.filter(
              (a) => a.type === "message_contact" || a.type === "call_contact",
            );
            const otherActions = executedActions.filter(
              (a) => a.type !== "message_contact" && a.type !== "call_contact",
            );

            return (
              <>
                {/* Generic "Done" for non-communication actions */}
                {otherActions.length > 0 && (
                  <div className="ml-8 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2 dark:border-green-800 dark:bg-green-950/30">
                    <p className="text-xs font-medium text-green-800 dark:text-green-300">
                      <Check className="mr-1 inline h-3.5 w-3.5" />
                      Done
                    </p>
                  </div>
                )}

                {/* Rich result cards for communication actions */}
                {commActions.map((action, idx) => {
                  const parsed = parseCommunicationResult(action.result);

                  // Error result
                  if (parsed.error) {
                    return (
                      <div
                        key={idx}
                        className="ml-8 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2 dark:border-red-800 dark:bg-red-950/30"
                      >
                        <p className="text-xs font-medium text-red-800 dark:text-red-300 flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          {parsed.error}
                        </p>
                      </div>
                    );
                  }

                  // call_contact result
                  if (action.type === "call_contact") {
                    return (
                      <div
                        key={idx}
                        className="ml-8 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2 dark:border-green-800 dark:bg-green-950/30"
                      >
                        <p className="text-xs font-medium text-green-800 dark:text-green-300 flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          Call initiated
                          {parsed.contactName
                            ? ` to ${parsed.contactName}`
                            : ""}
                        </p>
                      </div>
                    );
                  }

                  // message_contact multi-recipient
                  if (parsed.recipients && parsed.recipients.length > 0) {
                    const delivered = parsed.recipients.filter((r) => r.ok);
                    const failed = parsed.recipients.filter((r) => !r.ok);
                    return (
                      <div
                        key={idx}
                        className="ml-8 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2 dark:border-green-800 dark:bg-green-950/30"
                      >
                        <p className="text-xs font-medium text-green-800 dark:text-green-300 flex items-center gap-1 mb-1.5">
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          Message sent to {delivered.length}/
                          {parsed.recipients.length}
                        </p>
                        <ul className="space-y-0.5">
                          {parsed.recipients.map((r, ri) => (
                            <li
                              key={ri}
                              className="flex items-center gap-1.5 text-xs"
                            >
                              {r.ok && r.channel ? (
                                <>
                                  <ChannelIcon
                                    channel={r.channel}
                                    className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400"
                                  />
                                  <span className="text-green-800 dark:text-green-300">
                                    {r.name} — {channelDisplayLabel(r.channel)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
                                  <span className="text-red-700 dark:text-red-400">
                                    {r.name}: {r.error ?? "Failed"}
                                  </span>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                        {failed.length > 0 && delivered.length === 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Check each contact's profile to add a reachable
                            channel.
                          </p>
                        )}
                      </div>
                    );
                  }

                  // message_contact single recipient
                  return (
                    <div
                      key={idx}
                      className="ml-8 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2 dark:border-green-800 dark:bg-green-950/30"
                    >
                      <p className="text-xs font-medium text-green-800 dark:text-green-300 flex items-center gap-1">
                        {parsed.channel ? (
                          <ChannelIcon
                            channel={parsed.channel}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                        ) : (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {parsed.channel
                          ? `Sent via ${channelDisplayLabel(parsed.channel)}`
                          : "Sent"}
                        {parsed.contactName ? ` to ${parsed.contactName}` : ""}
                      </p>
                    </div>
                  );
                })}

                {/* If ALL executed actions were communication and all errored,
                  there may be nothing else shown — show a fallback Done for
                  any remaining non-error comm actions with no rich data */}
                {commActions.length === 0 && otherActions.length === 0 && (
                  <div className="ml-8 rounded-xl border border-green-200 bg-green-50/60 px-3 py-2 dark:border-green-800 dark:bg-green-950/30">
                    <p className="text-xs font-medium text-green-800 dark:text-green-300">
                      <Check className="mr-1 inline h-3.5 w-3.5" />
                      Done
                    </p>
                  </div>
                )}
              </>
            );
          })()}

        <div ref={endRef} />
      </div>

      {belowMessagesSlot}

      {/* Pending attachment previews */}
      {pendingAttachments.length > 0 && (
        <div className="shrink-0 flex gap-2 flex-wrap border-t border-border/40 bg-background/80 px-3 pt-2 pb-1 backdrop-blur-sm">
          {pendingAttachments.map((a) => (
            <div
              key={a.previewUrl}
              className="relative h-14 shrink-0 rounded-lg overflow-hidden border border-border/50"
              style={{
                width: a.fileType === "pdf" ? "auto" : "3.5rem",
                minWidth: "3.5rem",
              }}
            >
              {a.fileType === "pdf" ? (
                <div className="flex h-14 items-center gap-1.5 rounded-lg bg-muted px-2">
                  <FileText className="h-5 w-5 shrink-0 text-destructive" />
                  <span className="max-w-[120px] truncate text-xs text-foreground/80">
                    {a.fileName ?? "document.pdf"}
                  </span>
                </div>
              ) : (
                <img
                  src={a.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              {a.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                </div>
              )}
              {a.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
                  <X className="h-4 w-4 text-destructive" />
                </div>
              )}
              {!a.uploading && (
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(a.previewUrl)}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-background"
                  aria-label="Remove attachment"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 border-t border-border/60 bg-background/80 px-3 py-2 backdrop-blur-sm">
        {/* Hidden file input for paperclip */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleAddAttachment(file);
          }}
        />
        {/* Row 1: textarea + send */}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Message Elaine…"
            className="min-h-[38px] flex-1 resize-none rounded-xl border-border/50 bg-muted/50 py-2 text-sm shadow-none focus-visible:ring-1"
            rows={1}
            disabled={isStreaming}
          />
          <Button
            size="sm"
            className="h-[38px] w-[38px] shrink-0 rounded-xl p-0"
            onClick={() => void handleSend()}
            disabled={
              (!input.trim() &&
                pendingAttachments.every((a) => !a.uploadedUrl)) ||
              isStreaming ||
              hasUploadingAttachments
            }
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {/* Row 2: utility icons */}
        <div className="flex items-center gap-0.5 pt-1">
          {composerLeftSlot}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || pendingAttachments.length >= 5}
            title="Attach an image"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          <BarcodeScanButton
            onScanned={(code) => {
              void handleSend(
                `I scanned a barcode: ${code}. Can you tell me what this product is?`,
              );
            }}
            disabled={isStreaming}
          />
          <div className="flex-1" />
          {voice.isSupported && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={`relative h-8 w-8 shrink-0 rounded-lg transition-colors ${
                voice.isListening
                  ? "text-red-500 hover:text-red-600"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={handleMicToggle}
              disabled={isStreaming}
              title={voice.isListening ? "Stop recording" : "Voice input"}
            >
              {voice.isListening && (
                <span className="absolute inset-0 animate-ping rounded-lg bg-red-500/20" />
              )}
              <Mic className="h-3.5 w-3.5" />
            </Button>
          )}
          {tts.isSupported && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={`h-8 w-8 shrink-0 rounded-lg transition-colors ${
                tts.enabled
                  ? "text-primary hover:text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={tts.toggle}
              title={
                tts.enabled
                  ? "Turn off spoken replies"
                  : "Turn on spoken replies"
              }
            >
              {tts.enabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {tts.isSupported && tts.enabled && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                  title="Voice and speed"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Voice
                </div>
                <DropdownMenuItem
                  onSelect={() => tts.setSelectedVoiceURI(null)}
                  className="justify-between"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        tts.previewVoice(null);
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Preview this voice"
                    >
                      {tts.previewingVoiceURI === DEFAULT_VOICE_PREVIEW_KEY ? (
                        <Square className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
                    Default
                  </span>
                  {tts.selectedVoiceURI === null && (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  )}
                </DropdownMenuItem>
                {tts.voices.map((v) => (
                  <DropdownMenuItem
                    key={v.voiceURI}
                    onSelect={() => tts.setSelectedVoiceURI(v.voiceURI)}
                    className="justify-between"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          tts.previewVoice(v.voiceURI);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Preview this voice"
                      >
                        {tts.previewingVoiceURI === v.voiceURI ? (
                          <Square className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                      </button>
                      <span className="truncate">{v.name}</span>
                    </span>
                    {tts.selectedVoiceURI === v.voiceURI && (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Speed
                </div>
                {TTS_RATE_OPTIONS.map((r) => (
                  <DropdownMenuItem
                    key={r}
                    onSelect={() => tts.setRate(r)}
                    className="justify-between"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          tts.previewRate(r);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Preview this speed"
                      >
                        {tts.previewingRate === r ? (
                          <Square className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                      </button>
                      {r}x
                    </span>
                    {tts.rate === r && (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
          role="button"
          tabIndex={-1}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-background/20 text-white hover:bg-background/30"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
