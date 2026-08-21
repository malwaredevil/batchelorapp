import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useDeferredValue,
} from "react";
import { MessageSquare, Plus, Search, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getInfiniteElaineConversationsQueryKey,
  getListElaineConversationsQueryKey,
  useDeleteElaineConversation,
  useInfiniteElaineConversations,
  useListElaineConversations,
} from "@workspace/api-client-react";
import { Button } from "@workspace/ui";
import { Input } from "@workspace/ui";

export function formatConversationDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface ElaineHistoryPanelProps {
  /** Currently-loaded named conversation, if any — highlighted in the list. */
  activeConversationId: number | null;
  /** Starts a fresh conversation and closes the history panel. */
  onNewConversation: () => void;
  /** Loads the selected conversation's messages into the chat and closes the panel. */
  onSelectConversation: (id: number) => void | Promise<void>;
  /** Closes the panel without changing the active conversation. */
  onClose: () => void;
}

/**
 * Compact conversation-history list for the floating Elaine widget — a
 * smaller-footprint sibling of the full-page Elaine app's left sidebar
 * (`artifacts/elaine/src/pages/Chat.tsx`). Renders in place of
 * `ElaineChatPanel` inside the widget's fixed-size window when the user
 * taps the history button.
 *
 * When no search query is active the list uses cursor-based infinite scroll
 * (load more as the user scrolls to the bottom). Search mode returns all
 * matching conversations at once.
 */
export function ElaineHistoryPanel({
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onClose,
}: ElaineHistoryPanelProps) {
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery.trim() || undefined);
  const [loadingConvId, setLoadingConvId] = useState<number | null>(null);

  // ── Paginated list (no search) ──────────────────────────────────────────
  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteElaineConversations({
    query: { enabled: !deferredSearch, refetchOnWindowFocus: false },
  });

  // ── Search (any query present) ──────────────────────────────────────────
  const { data: searchRaw, isLoading: searchLoading } =
    useListElaineConversations({
      q: deferredSearch,
      query: {
        queryKey: getListElaineConversationsQueryKey(deferredSearch),
        enabled: !!deferredSearch,
        refetchOnWindowFocus: false,
      },
    });

  // Flatten whichever source is active into a single array.
  const conversations = deferredSearch
    ? Array.isArray(searchRaw)
      ? searchRaw
      : []
    : (infiniteData?.pages.flatMap((p) => p.conversations) ?? []);

  const isLoading = deferredSearch ? searchLoading : false;

  // ── Intersection observer sentinel for load-more ────────────────────────
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchNextPageStable = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPageStable();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPageStable]);

  // ── Delete ──────────────────────────────────────────────────────────────
  const deleteConversation = useDeleteElaineConversation({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getListElaineConversationsQueryKey(),
        });
        void qc.invalidateQueries({
          queryKey: getInfiniteElaineConversationsQueryKey(),
        });
      },
    },
  });

  async function handleSelect(id: number) {
    if (loadingConvId !== null) return;
    setLoadingConvId(id);
    try {
      await onSelectConversation(id);
    } finally {
      setLoadingConvId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2.5">
        <p className="text-sm font-medium text-foreground">History</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label="Close history"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border/50 p-2.5">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-xs"
          onClick={() => {
            onNewConversation();
            onClose();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </Button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="h-7 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {!isLoading && conversations.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {searchQuery ? "No results" : "No conversations yet"}
          </p>
        )}
        {conversations.map((conv) => {
          const isActive = activeConversationId === conv.id;
          const isLoadingThis = loadingConvId === conv.id;
          return (
            <div
              key={conv.id}
              className={`group relative flex cursor-pointer items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/60 ${
                isActive ? "bg-muted" : ""
              }`}
              onClick={() => void handleSelect(conv.id)}
            >
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-xs font-medium leading-snug ${
                    isActive ? "text-foreground" : "text-foreground/80"
                  }`}
                >
                  {isLoadingThis ? "Loading…" : conv.title}
                </p>
                {conv.preview && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70 leading-snug">
                    {conv.preview}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatConversationDate(conv.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                className="invisible ml-1 mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:visible group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation.mutate(conv.id, {
                    onSuccess: () => {
                      if (isActive) onNewConversation();
                    },
                  });
                }}
                title="Delete conversation"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {/* Sentinel for infinite scroll — triggers load-more when visible */}
        {!deferredSearch && (
          <div ref={sentinelRef} className="h-1" aria-hidden="true" />
        )}

        {isFetchingNextPage && (
          <p className="py-2 text-center text-[10px] text-muted-foreground">
            Loading more…
          </p>
        )}
      </div>
    </div>
  );
}
