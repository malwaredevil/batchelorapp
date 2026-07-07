import { Star, Paperclip, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@/hooks/use-gmail";
import { Skeleton } from "@/components/ui/skeleton";

// ── Formatters ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function displayFrom(from: string): string {
  if (!from) return "(unknown)";
  const match = from.match(/^"?(.+?)"?\s*<.+>$/);
  if (match) return match[1].trim();
  // bare email — shorten to local part
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface ThreadRowProps {
  thread: ThreadSummary;
  selected: boolean;
  onSelect: () => void;
  onStar: () => void;
}

function ThreadRow({ thread, selected, onSelect, onStar }: ThreadRowProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 px-3 sm:px-4 py-2.5 cursor-pointer border-b border-border/40 transition-colors group relative",
        selected
          ? "bg-blue-50 dark:bg-blue-950/30"
          : thread.isUnread
          ? "bg-card hover:bg-muted/50"
          : "hover:bg-muted/40",
      )}
    >
      {/* Unread bar */}
      {thread.isUnread && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 rounded-r" />
      )}

      {/* Star */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
        className="flex-shrink-0 p-0.5 rounded hover:scale-110 transition-transform"
        aria-label={thread.isStarred ? "Unstar" : "Star"}
      >
        <Star
          className={cn(
            "w-4 h-4",
            thread.isStarred
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground/40 group-hover:text-muted-foreground",
          )}
        />
      </button>

      {/* From */}
      <div
        className={cn(
          "w-28 sm:w-36 flex-shrink-0 text-sm truncate",
          thread.isUnread ? "font-semibold text-foreground" : "text-foreground/80",
        )}
      >
        {displayFrom(thread.from)}
        {thread.messageCount > 1 && (
          <span className="text-muted-foreground font-normal ml-1">
            ({thread.messageCount})
          </span>
        )}
      </div>

      {/* Subject + Snippet */}
      <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
        <span
          className={cn(
            "text-sm truncate",
            thread.isUnread ? "font-semibold text-foreground" : "text-foreground/80",
          )}
        >
          {thread.subject}
        </span>
        <span className="text-sm text-muted-foreground truncate hidden sm:block">
          &mdash; {thread.snippet}
        </span>
      </div>

      {/* Right: attachment + date */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {thread.hasAttachment && (
          <Paperclip className="w-3.5 h-3.5 text-muted-foreground/60" />
        )}
        <span
          className={cn(
            "text-xs whitespace-nowrap",
            thread.isUnread ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {formatDate(thread.date)}
        </span>
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ThreadSkeleton() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
      <Skeleton className="w-4 h-4 rounded-full flex-shrink-0" />
      <Skeleton className="w-28 h-4 flex-shrink-0" />
      <Skeleton className="flex-1 h-4" />
      <Skeleton className="w-12 h-3 flex-shrink-0" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ThreadListProps {
  threads: ThreadSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStar: (thread: ThreadSummary) => void;
  isLoading: boolean;
  isError: boolean;
  nextPageToken: string | null;
  onNextPage: () => void;
  onPrevPage: () => void;
  canPrevPage: boolean;
  onRefresh: () => void;
  labelName: string;
}

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  onStar,
  isLoading,
  isError,
  nextPageToken,
  onNextPage,
  onPrevPage,
  canPrevPage,
  onRefresh,
  labelName,
}: ThreadListProps) {
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <p>Failed to load messages</p>
        <button onClick={onRefresh} className="text-sm text-blue-500 hover:underline">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <h2 className="text-sm font-semibold text-foreground capitalize">{labelName}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            disabled={!canPrevPage}
            onClick={onPrevPage}
            className="p-1.5 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            disabled={!nextPageToken}
            onClick={onNextPage}
            className="p-1.5 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          Array.from({ length: 12 }).map((_, i) => <ThreadSkeleton key={i} />)
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-sm">No messages here</p>
          </div>
        ) : (
          threads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              selected={t.id === selectedId}
              onSelect={() => onSelect(t.id)}
              onStar={() => onStar(t)}
            />
          ))
        )}
      </div>
    </div>
  );
}
