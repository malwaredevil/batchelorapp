import { useState, useEffect, useMemo, useRef } from "react";
import {
  Star,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Archive,
  Trash2,
  MailOpen,
  Mail,
  Columns2,
  PanelBottom,
  Square,
  AlertCircle,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@workspace/gmail-ui";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type LayoutMode = "none" | "vertical" | "horizontal";

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
  if (isToday)
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function displayFrom(from: string): string {
  if (!from) return "(unknown)";
  const match = from.match(/^"?(.+?)"?\s*<.+>$/);
  if (match) return match[1].trim();
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
}

// ── Shared UI pieces ──────────────────────────────────────────────────────────

function Sep() {
  return <div className="h-5 w-px bg-border/70 mx-1 flex-shrink-0" />;
}

function LayoutIcon({ mode }: { mode: LayoutMode }) {
  if (mode === "vertical") return <Columns2 className="w-4 h-4" />;
  if (mode === "horizontal") return <PanelBottom className="w-4 h-4" />;
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
      <rect x="1" y="3" width="14" height="2" rx="1" />
      <rect x="1" y="7" width="14" height="2" rx="1" />
      <rect x="1" y="11" width="14" height="2" rx="1" />
    </svg>
  );
}

function LayoutToggle({
  layoutMode,
  onLayoutChange,
}: {
  layoutMode: LayoutMode;
  onLayoutChange: (m: LayoutMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "p-1.5 rounded transition-colors text-muted-foreground",
            layoutMode !== "none"
              ? "bg-primary/10 text-primary hover:bg-primary/20"
              : "hover:bg-muted",
          )}
          title="Reading pane"
        >
          <LayoutIcon mode={layoutMode} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() => onLayoutChange("none")}
          className={cn(
            "gap-2",
            layoutMode === "none" && "text-primary font-medium",
          )}
        >
          <Square className="w-4 h-4 flex-shrink-0" /> No split
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onLayoutChange("vertical")}
          className={cn(
            "gap-2",
            layoutMode === "vertical" && "text-primary font-medium",
          )}
        >
          <Columns2 className="w-4 h-4 flex-shrink-0" /> Vertical split
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onLayoutChange("horizontal")}
          className={cn(
            "gap-2",
            layoutMode === "horizontal" && "text-primary font-medium",
          )}
        >
          <PanelBottom className="w-4 h-4 flex-shrink-0" /> Horizontal split
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Master checkbox — supports indeterminate state
function MasterCheckbox({
  total,
  checkedCount,
  onChange,
}: {
  total: number;
  checkedCount: number;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const isAll = total > 0 && checkedCount === total;
  const isPartial = checkedCount > 0 && checkedCount < total;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = isPartial;
  }, [isPartial]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={isAll}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="w-4 h-4 cursor-pointer accent-primary"
      aria-label="Select all visible threads"
    />
  );
}

// Selection scope dropdown — All / None / Read / Unread / Starred / Unstarred
type SelectScope = "all" | "none" | "read" | "unread" | "starred" | "unstarred";

function SelectionDropdown({
  onSelect,
}: {
  onSelect: (s: SelectScope) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
          aria-label="Selection options"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        <DropdownMenuItem onClick={() => onSelect("all")}>All</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("none")}>
          None
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("read")}>
          Read
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("unread")}>
          Unread
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("starred")}>
          Starred
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("unstarred")}>
          Unstarred
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface ThreadRowProps {
  thread: ThreadSummary;
  selected: boolean;
  isChecked: boolean;
  anyChecked: boolean;
  isEven: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  onStar: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onToggleRead: () => void;
}

function ThreadRow({
  thread,
  selected,
  isChecked,
  anyChecked,
  isEven,
  onSelect,
  onToggleCheck,
  onStar,
  onArchive,
  onTrash,
  onToggleRead,
}: ThreadRowProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 px-3 sm:px-4 py-2.5 cursor-pointer border-b border-border/40 transition-colors group relative",
        selected
          ? "bg-blue-50 dark:bg-blue-950/30"
          : thread.isUnread
            ? [
                isEven ? "bg-card" : "bg-sky-50/80 dark:bg-sky-950/25",
                "hover:bg-muted/50",
              ]
            : [
                isEven ? "" : "bg-sky-50/50 dark:bg-sky-950/15",
                "hover:bg-muted/40",
              ],
      )}
    >
      {/* Unread indicator bar */}
      {thread.isUnread && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 rounded-r" />
      )}

      {/* Checkbox — always shown when anything is selected; otherwise reveal on hover */}
      <div
        className={cn(
          "flex-shrink-0 w-5 flex items-center",
          !anyChecked && "opacity-0 group-hover:opacity-100 transition-opacity",
        )}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onToggleCheck}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 cursor-pointer accent-primary"
          aria-label="Select thread"
        />
      </div>

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
          "w-24 sm:w-32 flex-shrink-0 text-sm truncate",
          thread.isUnread
            ? "font-semibold text-foreground"
            : "text-foreground/80",
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
            thread.isUnread
              ? "font-semibold text-foreground"
              : "text-foreground/80",
          )}
        >
          {thread.subject}
        </span>
        <span className="text-sm text-muted-foreground truncate hidden sm:block">
          &mdash; {thread.snippet}
        </span>
      </div>

      {/* Right: date hidden on hover, actions revealed */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {thread.hasAttachment && (
          <Paperclip className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:hidden" />
        )}
        <span
          className={cn(
            "text-xs whitespace-nowrap group-hover:hidden",
            thread.isUnread
              ? "font-semibold text-foreground"
              : "text-muted-foreground",
          )}
        >
          {formatDate(thread.date)}
        </span>

        <div className="hidden group-hover:flex items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title="Archive"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTrash();
            }}
            title="Delete"
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleRead();
            }}
            title={thread.isUnread ? "Mark as read" : "Mark as unread"}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {thread.isUnread ? (
              <MailOpen className="w-4 h-4" />
            ) : (
              <Mail className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ThreadSkeleton() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
      <Skeleton className="w-4 h-4 rounded flex-shrink-0" />
      <Skeleton className="w-4 h-4 rounded flex-shrink-0" />
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
  onArchive: (thread: ThreadSummary) => void;
  onTrash: (thread: ThreadSummary) => void;
  onToggleRead: (thread: ThreadSummary) => void;
  onBulkArchive: (ids: string[]) => void;
  onBulkTrash: (ids: string[]) => void;
  onBulkMarkRead: (ids: string[]) => void;
  onBulkMarkUnread: (ids: string[]) => void;
  onBulkSpam: (ids: string[]) => void;
  isLoading: boolean;
  isRefetching?: boolean;
  isError: boolean;
  nextPageToken: string | null;
  onNextPage: () => void;
  onPrevPage: () => void;
  canPrevPage: boolean;
  onRefresh: () => void;
  labelName: string;
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  resultSizeEstimate: number | null;
  pageStart: number;
  /** Collapses non-essential toolbar controls into an overflow menu so icons
   * don't jumble when this list is squeezed into a narrow/short split pane
   * on mobile. */
  compact?: boolean;
}

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  onStar,
  onArchive,
  onTrash,
  onToggleRead,
  onBulkArchive,
  onBulkTrash,
  onBulkMarkRead,
  onBulkMarkUnread,
  onBulkSpam,
  isLoading,
  isRefetching = false,
  isError,
  nextPageToken,
  onNextPage,
  onPrevPage,
  canPrevPage,
  onRefresh,
  labelName,
  layoutMode,
  onLayoutChange,
  resultSizeEstimate,
  pageStart,
  compact = false,
}: ThreadListProps) {
  // ── Selection state ──────────────────────────────────────────────────────
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Clear selection when the thread list changes (page nav / label switch)
  useEffect(() => {
    setCheckedIds(new Set());
  }, [threads]);

  // ── Sort order (persisted) ───────────────────────────────────────────────
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">(() => {
    const saved = localStorage.getItem("gmail-sort-order");
    return saved === "oldest" ? "oldest" : "newest";
  });

  function handleSortChange(order: "newest" | "oldest") {
    setSortOrder(order);
    localStorage.setItem("gmail-sort-order", order);
  }

  // Sorted display list
  const displayThreads = useMemo(
    () => (sortOrder === "oldest" ? [...threads].reverse() : threads),
    [threads, sortOrder],
  );

  // ── Derived selection values ─────────────────────────────────────────────
  const checkedCount = checkedIds.size;
  const anyChecked = checkedCount > 0;

  function applyScope(scope: SelectScope) {
    switch (scope) {
      case "all":
        setCheckedIds(new Set(threads.map((t) => t.id)));
        break;
      case "none":
        setCheckedIds(new Set());
        break;
      case "read":
        setCheckedIds(
          new Set(threads.filter((t) => !t.isUnread).map((t) => t.id)),
        );
        break;
      case "unread":
        setCheckedIds(
          new Set(threads.filter((t) => t.isUnread).map((t) => t.id)),
        );
        break;
      case "starred":
        setCheckedIds(
          new Set(threads.filter((t) => t.isStarred).map((t) => t.id)),
        );
        break;
      case "unstarred":
        setCheckedIds(
          new Set(threads.filter((t) => !t.isStarred).map((t) => t.id)),
        );
        break;
    }
  }

  function toggleThread(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Bulk action handlers (clear selection after action) ──────────────────
  function doBulkArchive() {
    onBulkArchive(Array.from(checkedIds));
    setCheckedIds(new Set());
  }
  function doBulkTrash() {
    onBulkTrash(Array.from(checkedIds));
    setCheckedIds(new Set());
  }
  function doBulkMarkRead() {
    onBulkMarkRead(Array.from(checkedIds));
    setCheckedIds(new Set());
  }
  function doBulkMarkUnread() {
    onBulkMarkUnread(Array.from(checkedIds));
    setCheckedIds(new Set());
  }
  function doBulkSpam() {
    onBulkSpam(Array.from(checkedIds));
    setCheckedIds(new Set());
  }

  // ── Count label ──────────────────────────────────────────────────────────
  const pageEnd = pageStart + displayThreads.length - 1;
  const countLabel =
    resultSizeEstimate != null
      ? `${pageStart}–${pageEnd} of ~${resultSizeEstimate.toLocaleString()}`
      : `${pageStart}–${pageEnd}`;

  // ── Icon button helper ────────────────────────────────────────────────────
  const IconBtn = ({
    onClick,
    title,
    children,
    danger,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    danger?: boolean;
  }) => (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "p-1.5 rounded transition-colors text-muted-foreground",
        danger
          ? "hover:text-red-500 hover:bg-muted"
          : "hover:text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <p>Failed to load messages</p>
        <button
          onClick={onRefresh}
          className="text-sm text-blue-500 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10 gap-2">
        {/* Left side — changes based on selection */}
        <div className="flex items-center gap-1 min-w-0">
          {/* Master checkbox + scope dropdown */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <MasterCheckbox
              total={threads.length}
              checkedCount={checkedCount}
              onChange={(checked) => applyScope(checked ? "all" : "none")}
            />
            <SelectionDropdown onSelect={applyScope} />
          </div>

          {anyChecked ? (
            /* ── Bulk action buttons ── */
            <>
              <Sep />
              <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                {checkedCount} selected
              </span>
              <Sep />
              {compact ? (
                /* Mobile: collapse all bulk actions into one dropdown */
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                      aria-label="Bulk actions"
                      title="Actions"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuItem onClick={doBulkArchive} className="gap-2">
                      <Archive className="w-4 h-4 flex-shrink-0" /> Archive
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={doBulkSpam} className="gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" /> Report
                      spam
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={doBulkTrash}
                      className="gap-2 text-red-500 focus:text-red-500"
                    >
                      <Trash2 className="w-4 h-4 flex-shrink-0" /> Delete
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={doBulkMarkRead}
                      className="gap-2"
                    >
                      <MailOpen className="w-4 h-4 flex-shrink-0" /> Mark as
                      read
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={doBulkMarkUnread}
                      className="gap-2"
                    >
                      <Mail className="w-4 h-4 flex-shrink-0" /> Mark as unread
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                /* Desktop: show all action icon buttons inline */
                <>
                  <IconBtn onClick={doBulkArchive} title="Archive">
                    <Archive className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn onClick={doBulkSpam} title="Report spam">
                    <AlertCircle className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn onClick={doBulkTrash} title="Delete" danger>
                    <Trash2 className="w-4 h-4" />
                  </IconBtn>
                  <Sep />
                  <IconBtn onClick={doBulkMarkRead} title="Mark as read">
                    <MailOpen className="w-4 h-4" />
                  </IconBtn>
                  <IconBtn onClick={doBulkMarkUnread} title="Mark as unread">
                    <Mail className="w-4 h-4" />
                  </IconBtn>
                </>
              )}
            </>
          ) : (
            /* ── Normal label + refresh ── */
            <>
              <IconBtn onClick={onRefresh} title="Refresh">
                <RefreshCw
                  className={cn("w-4 h-4", isRefetching && "animate-spin")}
                />
              </IconBtn>
              <span className="text-sm font-semibold text-foreground capitalize truncate hidden sm:block ml-1">
                {labelName}
              </span>
            </>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {anyChecked ? null : compact ? (
            /* Compact mode (narrow split pane on mobile): collapse count/sort
             * and pagination into a single overflow menu so the row never
             * has to fit more than a couple of icon buttons side by side. */
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                  aria-label="More options"
                  title="More options"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {countLabel}
                </div>
                <DropdownMenuItem
                  onClick={() => handleSortChange("newest")}
                  className={cn(
                    "gap-2",
                    sortOrder === "newest" && "text-primary font-medium",
                  )}
                >
                  Newest to oldest
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSortChange("oldest")}
                  className={cn(
                    "gap-2",
                    sortOrder === "oldest" && "text-primary font-medium",
                  )}
                >
                  Oldest to newest
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canPrevPage}
                  onClick={onPrevPage}
                  className="gap-2"
                >
                  <ChevronLeft className="w-4 h-4 flex-shrink-0" /> Previous
                  page
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!nextPageToken}
                  onClick={onNextPage}
                  className="gap-2"
                >
                  <ChevronRight className="w-4 h-4 flex-shrink-0" /> Next page
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            /* Count with sort dropdown */
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1 rounded hover:bg-muted transition-colors whitespace-nowrap">
                  {countLabel}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => handleSortChange("newest")}
                  className={cn(
                    "gap-2",
                    sortOrder === "newest" && "text-primary font-medium",
                  )}
                >
                  Newest to oldest
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSortChange("oldest")}
                  className={cn(
                    "gap-2",
                    sortOrder === "oldest" && "text-primary font-medium",
                  )}
                >
                  Oldest to newest
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {!compact && (
            <>
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
            </>
          )}

          <LayoutToggle
            layoutMode={layoutMode}
            onLayoutChange={onLayoutChange}
          />
        </div>
      </div>

      {/* ── Thread rows ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          Array.from({ length: 12 }).map((_, i) => <ThreadSkeleton key={i} />)
        ) : displayThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-sm">No messages here</p>
          </div>
        ) : (
          displayThreads.map((t, i) => (
            <ThreadRow
              key={t.id}
              thread={t}
              selected={t.id === selectedId}
              isChecked={checkedIds.has(t.id)}
              anyChecked={anyChecked}
              isEven={i % 2 === 0}
              onSelect={() => onSelect(t.id)}
              onToggleCheck={() => toggleThread(t.id)}
              onStar={() => onStar(t)}
              onArchive={() => onArchive(t)}
              onTrash={() => onTrash(t)}
              onToggleRead={() => onToggleRead(t)}
            />
          ))
        )}
      </div>
    </div>
  );
}
