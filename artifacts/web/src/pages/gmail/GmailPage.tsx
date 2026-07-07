import { useState, useEffect, useCallback, useRef } from "react";
import { useSearch } from "wouter";
import { LogOut, Sun, Moon, Menu, X, Search, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@workspace/elaine-ui";
import { AppSwitcher } from "@workspace/elaine-ui";
import {
  useLogout,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
} from "@/hooks/use-gmail";
import { GmailConnect } from "./GmailConnect";
import { GmailSidebar, type LabelId } from "@/components/gmail/GmailSidebar";
import { ThreadList, type LayoutMode } from "@/components/gmail/ThreadList";
import { ThreadView } from "@/components/gmail/ThreadView";
import { ComposeModal } from "@/components/gmail/ComposeModal";

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelToApi(id: LabelId): { labelIds?: string[] } {
  switch (id) {
    case "ALL": return {};
    case "STARRED": return { labelIds: ["STARRED"] };
    case "SENT": return { labelIds: ["SENT"] };
    case "DRAFTS": return { labelIds: ["DRAFT"] };
    case "SPAM": return { labelIds: ["SPAM"] };
    case "TRASH": return { labelIds: ["TRASH"] };
    case "INBOX":
    default:
      return { labelIds: id === "INBOX" ? ["INBOX"] : [id] };
  }
}

function labelDisplayName(id: LabelId): string {
  switch (id) {
    case "INBOX": return "Inbox";
    case "STARRED": return "Starred";
    case "SENT": return "Sent";
    case "DRAFTS": return "Drafts";
    case "SPAM": return "Spam";
    case "TRASH": return "Trash";
    case "ALL": return "All Mail";
    default: return id;
  }
}

// ── Resize divider ────────────────────────────────────────────────────────────

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

  const isVertical = direction === "vertical";

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        "flex-shrink-0 flex items-center justify-center select-none transition-colors group",
        "bg-border/50 hover:bg-primary/30",
        active && "bg-primary/50",
        isVertical ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize",
      )}
    >
      {/* grip dots */}
      <div
        className={cn(
          "flex gap-px opacity-0 group-hover:opacity-60 transition-opacity",
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

// ── Preview placeholder ───────────────────────────────────────────────────────

function PreviewPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
      <Mail className="w-10 h-10 opacity-20" />
      <p className="text-sm">Select a message to preview</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function GmailPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const { toast } = useToast();
  const { isDark, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Auth / logout ──────────────────────────────────────────────────────────
  const logout = useLogout({
    mutation: {
      onMutate: async () => { await queryClient.cancelQueries(); },
      onSuccess: () => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
        window.location.href = "/login";
      },
      onError: () => toast({ title: "Could not sign out. Please try again.", variant: "destructive" }),
    },
  });

  // ── Gmail status ───────────────────────────────────────────────────────────
  const { data: status, isLoading: statusLoading } = useGmailStatus();
  const connected = status?.connected ?? false;

  // ── OAuth callback toasts ──────────────────────────────────────────────────
  useEffect(() => {
    const gmailParam = params.get("gmail");
    if (gmailParam === "connected") {
      toast({ title: "Gmail connected", description: "Your inbox is ready." });
    } else if (gmailParam === "error") {
      toast({ title: "Connection failed", description: "Could not connect Gmail. Try again.", variant: "destructive" });
    } else if (gmailParam === "no_refresh_token") {
      toast({
        title: "Connection failed",
        description: "No refresh token was issued. Revoke access in your Google account settings and try again.",
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

  // ── Layout + split size (persisted) ───────────────────────────────────────
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    const saved = localStorage.getItem("gmail-layout-mode");
    return saved === "vertical" || saved === "horizontal" ? saved : "none";
  });

  const [splitSize, setSplitSize] = useState<{ vertical: number; horizontal: number }>(() => {
    try {
      const saved = localStorage.getItem("gmail-split-size");
      return saved ? JSON.parse(saved) : { vertical: 40, horizontal: 50 };
    } catch {
      return { vertical: 40, horizontal: 50 };
    }
  });

  function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
    localStorage.setItem("gmail-layout-mode", mode);
  }

  const handleVerticalResize = useCallback((delta: number) => {
    if (!contentRef.current) return;
    const pct = (delta / contentRef.current.offsetWidth) * 100;
    setSplitSize((prev) => {
      const next = { ...prev, vertical: Math.min(75, Math.max(20, prev.vertical + pct)) };
      localStorage.setItem("gmail-split-size", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleHorizontalResize = useCallback((delta: number) => {
    if (!contentRef.current) return;
    const pct = (delta / contentRef.current.offsetHeight) * 100;
    setSplitSize((prev) => {
      const next = { ...prev, horizontal: Math.min(75, Math.max(20, prev.horizontal + pct)) };
      localStorage.setItem("gmail-split-size", JSON.stringify(next));
      return next;
    });
  }, []);

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedLabel, setSelectedLabel] = useState<LabelId>("INBOX");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [pageHistory, setPageHistory] = useState<string[]>([]);
  const [currentPageToken, setCurrentPageToken] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compose, setCompose] = useState<{ open: boolean; initial?: Partial<ComposeParams> }>({ open: false });

  // ── Data ───────────────────────────────────────────────────────────────────
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

  const { data: threadData, isLoading: threadLoading } = useThread(selectedThreadId);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const modify = useGmailModify();
  const trash = useGmailTrash();
  const bulkModify = useBulkModify();
  const bulkTrash = useBulkTrash();
  const disconnect = useGmailDisconnect();
  const markThreadRead = useMarkThreadRead();

  // Auto-mark thread as read when it loads
  useEffect(() => {
    if (!threadData || !selectedThreadId) return;
    const unreadIds = threadData.messages.filter((m) => m.isUnread).map((m) => m.id);
    if (unreadIds.length === 0) return;
    markThreadRead(selectedThreadId, unreadIds);
  }, [threadData?.id, selectedThreadId, markThreadRead]);

  // ── Handlers ───────────────────────────────────────────────────────────────

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

  const handleStar = useCallback((thread: ThreadSummary) => {
    modify.mutate({
      messageId: thread.id,
      addLabelIds: thread.isStarred ? [] : ["STARRED"],
      removeLabelIds: thread.isStarred ? ["STARRED"] : [],
    });
  }, [modify]);

  const handleMsgStar = useCallback((msg: ThreadMessage) => {
    modify.mutate({
      messageId: msg.id,
      addLabelIds: msg.isStarred ? [] : ["STARRED"],
      removeLabelIds: msg.isStarred ? ["STARRED"] : [],
    });
  }, [modify]);

  const handleMsgToggleRead = useCallback((msg: ThreadMessage) => {
    modify.mutate({
      messageId: msg.id,
      addLabelIds: msg.isUnread ? [] : ["UNREAD"],
      removeLabelIds: msg.isUnread ? ["UNREAD"] : [],
    });
  }, [modify]);

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

  // In "no split" mode, hasThread switches between list and detail views.
  // In split modes both panes are always visible.
  const hasThread = !!selectedThreadId;
  const isSplit = layoutMode !== "none";
  const showSearch = isSplit || !hasThread;

  // ── Shared thread list props ───────────────────────────────────────────────
  const threadListSharedProps = {
    threads: threadListData?.threads ?? [],
    selectedId: selectedThreadId,
    onSelect: (id: string) => setSelectedThreadId(id),
    onStar: handleStar,
    onArchive: (t: ThreadSummary) => {
      modify.mutate({ messageId: t.id, addLabelIds: [], removeLabelIds: ["INBOX"] });
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
    // Bulk actions
    onBulkArchive: (ids: string[]) => {
      bulkModify.mutate({ messageIds: ids, addLabelIds: [], removeLabelIds: ["INBOX"] });
      toast({ title: `${ids.length} archived` });
    },
    onBulkTrash: (ids: string[]) => {
      bulkTrash.mutate(ids);
      toast({ title: `${ids.length} moved to Trash` });
    },
    onBulkMarkRead: (ids: string[]) => {
      bulkModify.mutate({ messageIds: ids, addLabelIds: [], removeLabelIds: ["UNREAD"] });
    },
    onBulkMarkUnread: (ids: string[]) => {
      bulkModify.mutate({ messageIds: ids, addLabelIds: ["UNREAD"], removeLabelIds: [] });
    },
    onBulkSpam: (ids: string[]) => {
      bulkModify.mutate({ messageIds: ids, addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] });
      toast({ title: `${ids.length} reported as spam` });
    },
    isLoading: threadsLoading,
    isError: threadsError,
    nextPageToken: threadListData?.nextPageToken ?? null,
    onNextPage: handleNextPage,
    onPrevPage: handlePrevPage,
    canPrevPage: pageHistory.length > 0,
    onRefresh: () => refetchThreads(),
    labelName: activeSearch ? `Search: "${activeSearch}"` : labelDisplayName(selectedLabel),
    layoutMode,
    onLayoutChange: handleLayoutChange,
    resultSizeEstimate: threadListData?.resultSizeEstimate ?? null,
    pageStart: pageHistory.length * 20 + 1,
  };

  // ── Shared thread view props ───────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen overflow-hidden bg-background text-foreground font-sans flex flex-col">

      {/* Standard Batchelor header */}
      <header className="sticky top-0 z-40 border-b border-card-border bg-background/85 backdrop-blur flex-shrink-0">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <AppSwitcher currentAppId="gmail" />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout.mutate(undefined)}
              disabled={logout.isPending}
              title="Sign out"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      {statusLoading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !connected ? (
        <div className="flex-1 overflow-y-auto">
          <GmailConnect />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Mobile sidebar overlay */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/30 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Nav sidebar */}
          <aside
            className={cn(
              "flex-shrink-0 w-56 bg-background border-r border-card-border overflow-y-auto transition-transform duration-200 z-50",
              "lg:relative lg:translate-x-0",
              sidebarOpen
                ? "fixed inset-y-0 left-0 translate-x-0 shadow-xl"
                : "fixed -translate-x-full lg:translate-x-0",
            )}
            style={{ top: "4rem" }}
          >
            <GmailSidebar
              selectedLabel={selectedLabel}
              onSelectLabel={handleSelectLabel}
              onCompose={() => openCompose()}
              labels={labelsData}
            />
          </aside>

          {/* Main column */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

            {/* Secondary toolbar: mobile menu toggle + search */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-background/60 flex-shrink-0">
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="lg:hidden p-1.5 rounded hover:bg-muted transition-colors"
              >
                {sidebarOpen
                  ? <X className="w-5 h-5 text-muted-foreground" />
                  : <Menu className="w-5 h-5 text-muted-foreground" />
                }
              </button>

              {showSearch && (
                <form onSubmit={handleSearch} className="flex-1 max-w-xl flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search mail..."
                      className="pl-9 h-8 text-sm bg-muted/50 border-border"
                    />
                  </div>
                  {activeSearch && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSearchQuery("");
                        setActiveSearch("");
                        setCurrentPageToken(undefined);
                        setPageHistory([]);
                        setSelectedThreadId(null);
                      }}
                      className="text-xs text-muted-foreground h-8 px-2"
                    >
                      Clear
                    </Button>
                  )}
                </form>
              )}

              <div className="ml-auto flex items-center gap-2">
                {status?.email && showSearch && (
                  <span className="text-xs text-muted-foreground hidden md:block truncate max-w-[160px]">
                    {status.email}
                  </span>
                )}
                {showSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground h-7"
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>

            {/* Content area */}
            <div ref={contentRef} className="flex-1 min-h-0 overflow-hidden">

              {/* ── No split ── */}
              {layoutMode === "none" && (
                <div className="relative h-full">
                  {hasThread ? (
                    <div className="absolute inset-0 overflow-y-auto">
                      <ThreadView {...threadViewSharedProps} />
                    </div>
                  ) : (
                    <div className="absolute inset-0">
                      <ThreadList {...threadListSharedProps} />
                    </div>
                  )}
                </div>
              )}

              {/* ── Vertical split (list left | preview right) ── */}
              {layoutMode === "vertical" && (
                <div className="flex h-full">
                  <div
                    style={{ width: `${splitSize.vertical}%` }}
                    className="flex-shrink-0 overflow-hidden min-w-0"
                  >
                    <ThreadList {...threadListSharedProps} />
                  </div>
                  <ResizeDivider direction="vertical" onResize={handleVerticalResize} />
                  <div className="flex-1 overflow-y-auto min-w-0">
                    {selectedThreadId
                      ? <ThreadView {...threadViewSharedProps} />
                      : <PreviewPlaceholder />
                    }
                  </div>
                </div>
              )}

              {/* ── Horizontal split (list top | preview bottom) ── */}
              {layoutMode === "horizontal" && (
                <div className="flex flex-col h-full">
                  <div
                    style={{ height: `${splitSize.horizontal}%` }}
                    className="flex-shrink-0 overflow-hidden min-h-0"
                  >
                    <ThreadList {...threadListSharedProps} />
                  </div>
                  <ResizeDivider direction="horizontal" onResize={handleHorizontalResize} />
                  <div className="flex-1 overflow-y-auto min-h-0">
                    {selectedThreadId
                      ? <ThreadView {...threadViewSharedProps} />
                      : <PreviewPlaceholder />
                    }
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Compose modal */}
          {compose.open && (
            <ComposeModal
              initial={compose.initial}
              onClose={() => setCompose({ open: false })}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default GmailPage;
