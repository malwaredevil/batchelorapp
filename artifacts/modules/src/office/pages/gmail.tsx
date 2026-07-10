import { useState, useEffect, useCallback, useRef } from "react";
import { useSearch } from "wouter";
import { Search, Mail, LogOut, X, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useGmailStatus,
  useGmailLabels,
  useThreadList,
  useThread,
  useGmailModify,
  useGmailTrash,
  useGmailDisconnect,
  useMarkThreadRead,
  useBulkModify,
  useBulkTrash,
  type ThreadSummary,
  type ThreadMessage,
  type ComposeParams,
} from "@workspace/gmail-ui";
import { GmailConnect } from "../components/gmail/GmailConnect";
import {
  GmailSidebar,
  type LabelId,
} from "../components/gmail/GmailSidebar";
import { ThreadList, type LayoutMode } from "../components/gmail/ThreadList";
import { ThreadView } from "../components/gmail/ThreadView";
import { ComposeModal } from "../components/gmail/ComposeModal";
import { usePageAssistantContext } from "../lib/assistant-context";

// This is a general-purpose email client for the household member's own
// connected Gmail account — distinct from the Travels app's Gmail auto-scan
// feature, which only reads booking-confirmation emails to suggest trip
// documents. Both features share the same underlying per-user OAuth grant
// (`app_gmail_connections`, `/api/gmail/*`) but serve unrelated purposes.

function ResizeDivider({
  direction,
  onResize,
}: {
  direction: "vertical" | "horizontal";
  onResize: (delta: number) => void;
}) {
  const [active, setActive] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setActive(true);
      let last = direction === "vertical" ? e.clientX : e.clientY;

      function onMove(ev: MouseEvent) {
        const pos = direction === "vertical" ? ev.clientX : ev.clientY;
        onResize(pos - last);
        last = pos;
      }
      function onUp() {
        setActive(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [direction, onResize],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setActive(true);
      const touch = e.touches[0];
      if (!touch) return;
      let last = direction === "vertical" ? touch.clientX : touch.clientY;

      function onMove(ev: TouchEvent) {
        const t = ev.touches[0];
        if (!t) return;
        ev.preventDefault();
        const pos = direction === "vertical" ? t.clientX : t.clientY;
        onResize(pos - last);
        last = pos;
      }
      function onEnd() {
        setActive(false);
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
        window.removeEventListener("touchcancel", onEnd);
      }
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onEnd);
      window.addEventListener("touchcancel", onEnd);
    },
    [direction, onResize],
  );

  const isVertical = direction === "vertical";

  return (
    <div
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      className={cn(
        "relative flex-shrink-0 flex items-center justify-center select-none transition-colors group touch-none",
        "bg-border/50 hover:bg-primary/30 active:bg-primary/50",
        active && "bg-primary/50",
        isVertical
          ? "w-3 sm:w-1.5 cursor-col-resize"
          : "h-3 sm:h-1.5 cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "bg-border/70 rounded-full",
          isVertical ? "w-0.5 h-8" : "h-0.5 w-8",
        )}
      />
      <div
        className={cn(
          "absolute flex gap-px opacity-0 group-hover:opacity-60 transition-opacity",
          isVertical ? "flex-col" : "flex-row",
        )}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-0.5 h-0.5 rounded-full bg-foreground" />
        ))}
      </div>
    </div>
  );
}

function PreviewPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
      <Mail className="w-10 h-10 opacity-20" />
      <p className="text-sm">Select a message to preview</p>
    </div>
  );
}

function labelToApi(id: LabelId): { labelIds?: string[] } {
  switch (id) {
    case "ALL":
      return {};
    case "STARRED":
      return { labelIds: ["STARRED"] };
    case "SENT":
      return { labelIds: ["SENT"] };
    case "DRAFTS":
      return { labelIds: ["DRAFT"] };
    case "SPAM":
      return { labelIds: ["SPAM"] };
    case "TRASH":
      return { labelIds: ["TRASH"] };
    case "INBOX":
    default:
      return { labelIds: id === "INBOX" ? ["INBOX"] : [id] };
  }
}

function labelDisplayName(id: LabelId): string {
  switch (id) {
    case "INBOX":
      return "Inbox";
    case "STARRED":
      return "Starred";
    case "SENT":
      return "Sent";
    case "DRAFTS":
      return "Drafts";
    case "SPAM":
      return "Spam";
    case "TRASH":
      return "Trash";
    case "ALL":
      return "All Mail";
    default:
      return id;
  }
}

export default function OfficeGmailPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: status, isLoading: statusLoading } = useGmailStatus();
  const connected = status?.connected ?? false;

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    const saved = localStorage.getItem("office-gmail-layout-mode");
    return saved === "vertical" || saved === "horizontal" ? saved : "none";
  });

  const [splitSize, setSplitSize] = useState<{
    vertical: number;
    horizontal: number;
  }>(() => {
    try {
      const saved = localStorage.getItem("office-gmail-split-size");
      return saved ? JSON.parse(saved) : { vertical: 40, horizontal: 50 };
    } catch {
      return { vertical: 40, horizontal: 50 };
    }
  });

  function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
    localStorage.setItem("office-gmail-layout-mode", mode);
  }

  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const splitMin = isMobile ? 45 : 20;
  const splitMax = isMobile ? 65 : 75;

  const handleVerticalResize = useCallback(
    (delta: number) => {
      if (!contentRef.current) return;
      const pct = (delta / contentRef.current.offsetWidth) * 100;
      setSplitSize((prev) => {
        const next = {
          ...prev,
          vertical: Math.min(splitMax, Math.max(splitMin, prev.vertical + pct)),
        };
        localStorage.setItem("office-gmail-split-size", JSON.stringify(next));
        return next;
      });
    },
    [splitMin, splitMax],
  );

  const handleHorizontalResize = useCallback(
    (delta: number) => {
      if (!contentRef.current) return;
      const pct = (delta / contentRef.current.offsetHeight) * 100;
      setSplitSize((prev) => {
        const next = {
          ...prev,
          horizontal: Math.min(
            splitMax,
            Math.max(splitMin, prev.horizontal + pct),
          ),
        };
        localStorage.setItem("office-gmail-split-size", JSON.stringify(next));
        return next;
      });
    },
    [splitMin, splitMax],
  );

  useEffect(() => {
    const gmailParam = params.get("gmail");
    if (gmailParam === "connected") {
      toast({ title: "Gmail connected", description: "Your inbox is ready." });
    } else if (gmailParam === "error") {
      toast({
        title: "Connection failed",
        description: "Could not connect Gmail. Try again.",
        variant: "destructive",
      });
    } else if (gmailParam === "no_refresh_token") {
      toast({
        title: "Connection failed",
        description:
          "No refresh token was issued. Revoke access in your Google account settings and try again.",
        variant: "destructive",
      });
    }
    if (gmailParam && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete("gmail");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedLabel, setSelectedLabel] = useState<LabelId>("INBOX");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [pageHistory, setPageHistory] = useState<string[]>([]);
  const [currentPageToken, setCurrentPageToken] = useState<
    string | undefined
  >();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compose, setCompose] = useState<{
    open: boolean;
    initial?: Partial<ComposeParams>;
  }>({ open: false });

  const { data: labelsData } = useGmailLabels(connected);
  const threadListParams = {
    ...labelToApi(selectedLabel),
    q: activeSearch || undefined,
    pageToken: currentPageToken,
    maxResults: 20,
  };
  const {
    data: threadListData,
    isLoading: threadsLoading,
    isError: threadsError,
    refetch: refetchThreads,
  } = useThreadList(threadListParams, connected);

  const { data: threadData, isLoading: threadLoading } =
    useThread(selectedThreadId);

  usePageAssistantContext(
    "office-gmail",
    connected
      ? `On the Office Gmail page (a full webmail client for the user's own connected Gmail account, separate from the Travels app's Gmail auto-scan feature). Viewing the "${labelDisplayName(selectedLabel)}" label.` +
          (activeSearch ? ` Search filter applied: "${activeSearch}".` : "") +
          (threadListData?.threads
            ? ` ${threadListData.threads.length} thread(s) loaded in the current page.`
            : "") +
          (selectedThreadId && threadData
            ? ` A thread is open: "${threadData.messages[0]?.subject ?? "(no subject)"}" with ${threadData.messages.length} message(s). threadId: ${selectedThreadId}`
            : "")
      : `On the Office Gmail page. The user's Gmail account is not connected yet.`,
  );

  const modify = useGmailModify();
  const trash = useGmailTrash();
  const bulkModify = useBulkModify();
  const bulkTrash = useBulkTrash();
  const disconnect = useGmailDisconnect();
  const markThreadRead = useMarkThreadRead();

  useEffect(() => {
    if (!threadData || !selectedThreadId) return;
    const unreadIds = threadData.messages
      .filter((m) => m.isUnread)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    markThreadRead(selectedThreadId, unreadIds);
  }, [threadData?.id, selectedThreadId, markThreadRead]);

  function handleSelectLabel(id: LabelId) {
    setSelectedLabel(id);
    setSelectedThreadId(null);
    setCurrentPageToken(undefined);
    setPageHistory([]);
    setSearchQuery("");
    setActiveSearch("");
    setSidebarOpen(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setActiveSearch(searchQuery);
    setSelectedThreadId(null);
    setCurrentPageToken(undefined);
    setPageHistory([]);
  }

  function handleNextPage() {
    const token = threadListData?.nextPageToken;
    if (!token) return;
    setPageHistory((h) => [...h, currentPageToken ?? ""]);
    setCurrentPageToken(token);
    setSelectedThreadId(null);
  }

  function handlePrevPage() {
    setPageHistory((h) => {
      const next = [...h];
      const prev = next.pop();
      setCurrentPageToken(prev === "" ? undefined : prev);
      return next;
    });
    setSelectedThreadId(null);
  }

  const handleStar = useCallback(
    (thread: ThreadSummary) => {
      modify.mutate({
        messageId: thread.id,
        addLabelIds: thread.isStarred ? [] : ["STARRED"],
        removeLabelIds: thread.isStarred ? ["STARRED"] : [],
      });
    },
    [modify],
  );

  const handleMsgStar = useCallback(
    (msg: ThreadMessage) => {
      modify.mutate({
        messageId: msg.id,
        addLabelIds: msg.isStarred ? [] : ["STARRED"],
        removeLabelIds: msg.isStarred ? ["STARRED"] : [],
      });
    },
    [modify],
  );

  const handleMsgToggleRead = useCallback(
    (msg: ThreadMessage) => {
      modify.mutate({
        messageId: msg.id,
        addLabelIds: msg.isUnread ? [] : ["UNREAD"],
        removeLabelIds: msg.isUnread ? ["UNREAD"] : [],
      });
    },
    [modify],
  );

  function handleArchive(messageId: string) {
    modify.mutate({ messageId, addLabelIds: [], removeLabelIds: ["INBOX"] });
    setSelectedThreadId(null);
    toast({ title: "Archived" });
  }

  function handleTrash(messageId: string) {
    trash.mutate(messageId);
    setSelectedThreadId(null);
    toast({ title: "Moved to Trash" });
  }

  function openCompose(initial?: Partial<ComposeParams>) {
    setCompose({ open: true, initial });
  }

  function handleReply(p: Partial<ComposeParams>) {
    openCompose(p);
  }

  async function handleDisconnect() {
    await disconnect.mutateAsync();
    toast({ title: "Gmail disconnected" });
  }

  const hasThread = !!selectedThreadId;

  const threadListSharedProps = {
    threads: threadListData?.threads ?? [],
    selectedId: selectedThreadId,
    onSelect: (id: string) => setSelectedThreadId(id),
    onStar: handleStar,
    onArchive: (t: ThreadSummary) => {
      modify.mutate({
        messageId: t.id,
        addLabelIds: [],
        removeLabelIds: ["INBOX"],
      });
      toast({ title: "Archived" });
    },
    onTrash: (t: ThreadSummary) => {
      trash.mutate(t.id);
      toast({ title: "Moved to Trash" });
    },
    onToggleRead: (t: ThreadSummary) => {
      modify.mutate({
        messageId: t.id,
        addLabelIds: t.isUnread ? [] : ["UNREAD"],
        removeLabelIds: t.isUnread ? ["UNREAD"] : [],
      });
    },
    onBulkArchive: (ids: string[]) => {
      bulkModify.mutate({
        messageIds: ids,
        addLabelIds: [],
        removeLabelIds: ["INBOX"],
      });
      toast({ title: `${ids.length} archived` });
    },
    onBulkTrash: (ids: string[]) => {
      bulkTrash.mutate(ids);
      toast({ title: `${ids.length} moved to Trash` });
    },
    onBulkMarkRead: (ids: string[]) => {
      bulkModify.mutate({
        messageIds: ids,
        addLabelIds: [],
        removeLabelIds: ["UNREAD"],
      });
    },
    onBulkMarkUnread: (ids: string[]) => {
      bulkModify.mutate({
        messageIds: ids,
        addLabelIds: ["UNREAD"],
        removeLabelIds: [],
      });
    },
    onBulkSpam: (ids: string[]) => {
      bulkModify.mutate({
        messageIds: ids,
        addLabelIds: ["SPAM"],
        removeLabelIds: ["INBOX"],
      });
      toast({ title: `${ids.length} reported as spam` });
    },
    isLoading: threadsLoading,
    isError: threadsError,
    nextPageToken: threadListData?.nextPageToken ?? null,
    onNextPage: handleNextPage,
    onPrevPage: handlePrevPage,
    canPrevPage: pageHistory.length > 0,
    onRefresh: () => refetchThreads(),
    labelName: activeSearch
      ? `Search: "${activeSearch}"`
      : labelDisplayName(selectedLabel),
    layoutMode,
    onLayoutChange: handleLayoutChange,
    resultSizeEstimate: threadListData?.resultSizeEstimate ?? null,
    pageStart: pageHistory.length * 20 + 1,
  };

  const threadViewSharedProps = {
    thread: threadData,
    isLoading: threadLoading,
    onBack: () => setSelectedThreadId(null),
    onReply: handleReply,
    onArchive: handleArchive,
    onTrash: handleTrash,
    onToggleStar: handleMsgStar,
    onToggleRead: handleMsgToggleRead,
  };

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!connected) {
    return <GmailConnect />;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[500px] rounded-lg border border-card-border overflow-hidden bg-background">
      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            "flex-shrink-0 w-56 bg-background border-r border-card-border overflow-y-auto transition-transform duration-200 z-50",
            "lg:relative lg:translate-x-0",
            sidebarOpen
              ? "fixed inset-y-0 left-0 translate-x-0"
              : "fixed inset-y-0 left-0 -translate-x-full lg:static",
          )}
        >
          <GmailSidebar
            selectedLabel={selectedLabel}
            onSelectLabel={handleSelectLabel}
            labels={labelsData ?? []}
            onCompose={() => openCompose()}
          />
        </aside>

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2 border-b border-card-border p-2 flex-shrink-0">
            <button
              type="button"
              className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover-elevate"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open folders"
            >
              <Mail className="h-4 w-4" />
            </button>
            <form
              onSubmit={handleSearch}
              className="flex-1 flex items-center gap-2"
            >
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search mail"
                  className="h-8 pl-8 text-sm"
                />
              </div>
            </form>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
              className="text-muted-foreground hover:text-foreground gap-1.5"
              title="Disconnect Gmail"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Disconnect</span>
            </Button>
          </div>

          <div ref={contentRef} className="relative flex flex-1 min-h-0">
            {layoutMode !== "none" && (
              <button
                onClick={() => handleLayoutChange("none")}
                title="Close split view"
                aria-label="Close split view"
                className="absolute top-2 right-2 z-20 p-2 rounded-full bg-background/95 border border-border shadow-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {layoutMode === "none" && (
              <>
                <div
                  className={cn(
                    "flex-shrink-0 border-r border-card-border overflow-y-auto",
                    hasThread ? "hidden lg:block lg:w-[380px]" : "w-full",
                  )}
                >
                  <ThreadList {...threadListSharedProps} />
                </div>
                <div
                  className={cn(
                    "flex-1 min-w-0 overflow-y-auto",
                    hasThread ? "block" : "hidden lg:block",
                  )}
                >
                  {hasThread ? (
                    <ThreadView {...threadViewSharedProps} />
                  ) : (
                    <PreviewPlaceholder />
                  )}
                </div>
              </>
            )}

            {layoutMode === "vertical" && (
              <div className="flex flex-1 min-w-0 min-h-0">
                <div
                  style={{ width: `${splitSize.vertical}%` }}
                  className="flex-shrink-0 overflow-y-auto min-w-0 border-r border-card-border"
                >
                  <ThreadList {...threadListSharedProps} compact={isMobile} />
                </div>
                <ResizeDivider
                  direction="vertical"
                  onResize={handleVerticalResize}
                />
                <div className="flex-1 overflow-y-auto min-w-0">
                  {selectedThreadId ? (
                    <ThreadView {...threadViewSharedProps} />
                  ) : (
                    <PreviewPlaceholder />
                  )}
                </div>
              </div>
            )}

            {layoutMode === "horizontal" && (
              <div className="flex flex-col flex-1 min-h-0 w-full">
                <div
                  style={{ height: `${splitSize.horizontal}%` }}
                  className="flex-shrink-0 overflow-y-auto min-h-0 border-b border-card-border"
                >
                  <ThreadList {...threadListSharedProps} compact={isMobile} />
                </div>
                <ResizeDivider
                  direction="horizontal"
                  onResize={handleHorizontalResize}
                />
                <div className="flex-1 overflow-y-auto min-h-0">
                  {selectedThreadId ? (
                    <ThreadView {...threadViewSharedProps} />
                  ) : (
                    <PreviewPlaceholder />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {compose.open && (
        <ComposeModal
          initial={compose.initial}
          onClose={() => setCompose({ open: false })}
        />
      )}
    </div>
  );
}
