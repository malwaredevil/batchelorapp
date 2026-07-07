import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { Menu, X, Search, ArrowLeft, Sun, Moon, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@workspace/elaine-ui";
import {
  useGmailStatus,
  useGmailLabels,
  useThreadList,
  useThread,
  useGmailModify,
  useGmailTrash,
  useGmailDisconnect,
  useMarkThreadRead,
  type ThreadSummary,
  type ThreadMessage,
  type ComposeParams,
} from "@/hooks/use-gmail";
import { GmailConnect } from "./GmailConnect";
import { GmailSidebar, type LabelId } from "@/components/gmail/GmailSidebar";
import { ThreadList } from "@/components/gmail/ThreadList";
import { ThreadView } from "@/components/gmail/ThreadView";
import { ComposeModal } from "@/components/gmail/ComposeModal";

const base = import.meta.env.BASE_URL;

// Map our label IDs to Gmail API label IDs for the threads list query
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

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function GmailPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const { toast } = useToast();
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  // ── Auth status ─────────────────────────────────────────────────────────────
  const { data: status, isLoading: statusLoading } = useGmailStatus();
  const connected = status?.connected ?? false;

  // ── OAuth callback toasts ────────────────────────────────────────────────────
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

  // ── State ───────────────────────────────────────────────────────────────────
  const [selectedLabel, setSelectedLabel] = useState<LabelId>("INBOX");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [pageHistory, setPageHistory] = useState<string[]>([]);
  const [currentPageToken, setCurrentPageToken] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compose, setCompose] = useState<{ open: boolean; initial?: Partial<ComposeParams> }>({
    open: false,
  });

  // ── Data ────────────────────────────────────────────────────────────────────
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

  // ── Mutations ─────────────────────────────────────────────────────────────
  const modify = useGmailModify();
  const trash = useGmailTrash();
  const disconnect = useGmailDisconnect();
  const markThreadRead = useMarkThreadRead();

  // Auto-mark thread as read when it loads
  useEffect(() => {
    if (!threadData || !selectedThreadId) return;
    const unreadIds = threadData.messages
      .filter((m) => m.isUnread)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    markThreadRead(selectedThreadId, unreadIds);
  }, [threadData?.id, selectedThreadId, markThreadRead]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

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

  // ── User display ─────────────────────────────────────────────────────────────
  const displayName = user?.displayName?.trim() || user?.email || "";
  const initials = initialsFrom(displayName || "?");
  const hasThread = !!selectedThreadId;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen overflow-hidden bg-background text-foreground font-sans flex flex-col">
      {/* Nav bar */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border flex-shrink-0">
        <div className="flex h-14 items-center gap-3 px-4">
          {/* Back to hub */}
          <a
            href={base}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to hub"
          >
            <ArrowLeft className="w-4 h-4" />
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
                <Mail className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold hidden sm:block">Gmail</span>
            </div>
          </a>

          <div className="flex-1" />

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>

          {/* User avatar */}
          {user && (
            <div className="flex items-center gap-2 border-l border-border pl-3">
              <span className="text-xs text-muted-foreground hidden sm:block">
                {user.email}
              </span>
              <Avatar className="h-7 w-7 border border-border">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </div>
          )}
        </div>
      </header>

      {/* Body */}
      {statusLoading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
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

          {/* Sidebar */}
          <aside
            className={cn(
              "flex-shrink-0 w-56 bg-background border-r border-border overflow-y-auto transition-transform duration-200 z-50",
              "lg:relative lg:translate-x-0",
              sidebarOpen
                ? "fixed inset-y-0 left-0 translate-x-0 shadow-xl"
                : "fixed -translate-x-full lg:translate-x-0",
            )}
            style={{ top: "3.5rem" }}
          >
            <GmailSidebar
              selectedLabel={selectedLabel}
              onSelectLabel={handleSelectLabel}
              onCompose={() => openCompose()}
              labels={labelsData}
            />
          </aside>

          {/* Main */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Secondary toolbar: mobile menu + search */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-background/60">
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="lg:hidden p-1.5 rounded hover:bg-muted transition-colors"
              >
                {sidebarOpen ? (
                  <X className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <Menu className="w-5 h-5 text-muted-foreground" />
                )}
              </button>

              {!hasThread && (
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
                {status?.email && !hasThread && (
                  <span className="text-xs text-muted-foreground hidden md:block truncate max-w-[160px]">
                    {status.email}
                  </span>
                )}
                {!hasThread && (
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

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
              {hasThread ? (
                <div className="absolute inset-0 overflow-y-auto">
                  <ThreadView
                    thread={threadData}
                    isLoading={threadLoading}
                    onBack={() => setSelectedThreadId(null)}
                    onReply={handleReply}
                    onArchive={handleArchive}
                    onTrash={handleTrash}
                    onToggleStar={handleMsgStar}
                    onToggleRead={handleMsgToggleRead}
                  />
                </div>
              ) : (
                <div className="absolute inset-0">
                  <ThreadList
                    threads={threadListData?.threads ?? []}
                    selectedId={selectedThreadId}
                    onSelect={(id) => setSelectedThreadId(id)}
                    onStar={handleStar}
                    isLoading={threadsLoading}
                    isError={threadsError}
                    nextPageToken={threadListData?.nextPageToken ?? null}
                    onNextPage={handleNextPage}
                    onPrevPage={handlePrevPage}
                    canPrevPage={pageHistory.length > 0}
                    onRefresh={() => refetchThreads()}
                    labelName={activeSearch ? `Search: "${activeSearch}"` : labelDisplayName(selectedLabel)}
                  />
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
