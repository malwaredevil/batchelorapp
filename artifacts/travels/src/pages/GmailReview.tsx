import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Mail,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  Paperclip,
  RefreshCw,
  Eye,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useGetGmailStatus,
  useScanGmail,
  useGetGmailSuggestions,
  useDismissGmailSuggestion,
  useGetGmailInbox,
  useLinkGmailMessage,
  useIgnoreGmailMessage,
  useReconsiderGmailMessage,
  useGetGmailMessage,
  useBulkLinkGmailMessages,
  useListTrips,
  getGetGmailSuggestionsQueryKey,
  getGetGmailInboxQueryKey,
  getGetGmailMessageQueryKey,
  type GmailScanDecision,
  type GmailInboxMessage,
  type Trip,
} from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { cn } from "@/lib/utils";

function formatDate(value: string | null): string {
  if (!value) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const AVATAR_PALETTE = [
  "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
];

function getDisplayName(from: string | null | undefined): string {
  if (!from) return "Unknown sender";
  const match = from.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  return match ? match[1].trim() : from.replace(/<[^>]+>/, "").trim() || from;
}

function getInitials(from: string | null | undefined): string {
  const name = getDisplayName(from);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(from: string | null | undefined): string {
  const name = getDisplayName(from);
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function SenderAvatar({ from, className }: { from: string | null | undefined; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        getAvatarColor(from),
        className,
      )}
    >
      {getInitials(from)}
    </div>
  );
}

function TripPicker({
  trips,
  value,
  onChange,
  disabled,
}: {
  trips: Trip[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full sm:w-56">
        <SelectValue placeholder="Choose a trip…" />
      </SelectTrigger>
      <SelectContent>
        {trips.map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>
            {t.title} — {t.destination}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ViewMessageDialog({
  messageId,
  onOpenChange,
}: {
  messageId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useGetGmailMessage(messageId ?? "", {
    query: { enabled: !!messageId, queryKey: getGetGmailMessageQueryKey(messageId ?? "") },
  });

  return (
    <Dialog open={!!messageId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {isLoading || !data ? (
          <div className="p-8">
            <p className="text-sm text-muted-foreground py-6 text-center">Loading email…</p>
          </div>
        ) : isError ? (
          <div className="p-8">
            <p className="text-sm text-destructive py-6 text-center">Could not load this email.</p>
          </div>
        ) : (
          <>
            <DialogHeader className="border-b border-card-border px-6 py-5">
              <DialogTitle className="font-serif text-xl text-foreground leading-snug pr-6">
                {data.subject || "(no subject)"}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex items-center gap-3 pt-2">
                  <SenderAvatar from={data.from} className="h-9 w-9 text-sm" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-medium text-foreground truncate">
                      {getDisplayName(data.from)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {data.from} · {formatDate(data.date)}
                    </p>
                  </div>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-5 space-y-4">
              {data.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {data.attachments.map((a, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-muted/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground"
                    >
                      <Paperclip className="h-3 w-3" />
                      {a.filename}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {data.textBody || "(no body content)"}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuggestionsTab({
  trips,
  onView,
}: {
  trips: Trip[];
  onView: (messageId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: suggestions = [], isLoading } = useGetGmailSuggestions();
  const dismiss = useDismissGmailSuggestion();
  const link = useLinkGmailMessage();
  const [selectedTrip, setSelectedTrip] = useState<Record<number, string>>({});

  function handleDismiss(s: GmailScanDecision) {
    dismiss.mutate(s.id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGmailSuggestionsQueryKey() });
        toast.success("Dismissed — won't be suggested again");
      },
      onError: () => toast.error("Could not dismiss. Please try again."),
    });
  }

  function handleLink(s: GmailScanDecision) {
    const tripId = Number(selectedTrip[s.id]);
    if (!tripId) {
      toast.error("Pick a trip first");
      return;
    }
    link.mutate(
      { messageId: s.gmailMessageId, tripId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGmailSuggestionsQueryKey() });
          toast.success("Added as trip document(s)");
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not link this email"),
      },
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading suggestions…</p>;
  }

  if (suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-card-border p-8 text-center space-y-1">
        <Mail className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No pending suggestions</p>
        <p className="text-xs text-muted-foreground">
          Run a scan or check back after your next automatic scan (every 6 hours).
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card overflow-hidden">
      {suggestions.map((s) => {
        const extracted = (s.extractedData ?? {}) as Record<string, unknown>;
        return (
          <li key={s.id} className="p-4 space-y-3 transition-colors hover:bg-muted/30">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <SenderAvatar from={s.fromAddress} className="h-9 w-9 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {s.subject || "(no subject)"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {getDisplayName(s.fromAddress)} · {formatDate(s.receivedAt)}
                  </p>
                </div>
              </div>
              {typeof extracted.documentType === "string" && (
                <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium capitalize text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                  {extracted.documentType.replace(/_/g, " ")}
                </span>
              )}
            </div>

            {(typeof extracted.providerName === "string" || typeof extracted.referenceNumber === "string") && (
              <p className="text-xs text-muted-foreground pl-12">
                {[extracted.providerName, extracted.referenceNumber]
                  .filter((v): v is string => typeof v === "string" && v.length > 0)
                  .join(" · ")}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center pl-12">
              <TripPicker
                trips={trips}
                value={selectedTrip[s.id] ?? ""}
                onChange={(v) => setSelectedTrip((prev) => ({ ...prev, [s.id]: v }))}
                disabled={link.isPending}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleLink(s)}
                  disabled={link.isPending || !selectedTrip[s.id]}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Add to trip
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onView(s.gmailMessageId)}>
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                  View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDismiss(s)}
                  disabled={dismiss.isPending}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                  Dismiss
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function InboxBrowserTab({
  trips,
  onView,
}: {
  trips: Trip[];
  onView: (messageId: string) => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [showIgnored, setShowIgnored] = useState(false);
  const [autoPageCount, setAutoPageCount] = useState(0);
  const isDefaultQuery = committedQuery === "";
  const MAX_AUTO_PAGES = 4;
  const { data, isLoading, isFetching } = useGetGmailInbox({ q: committedQuery || undefined, pageToken });
  const link = useLinkGmailMessage();
  const ignore = useIgnoreGmailMessage();
  const reconsider = useReconsiderGmailMessage();
  const bulkLink = useBulkLinkGmailMessages();
  const [selectedTrip, setSelectedTrip] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [bulkTripId, setBulkTripId] = useState("");

  const inboxQueryKey = getGetGmailInboxQueryKey({ q: committedQuery || undefined, pageToken });

  // The default (unsearched) inbox query is a narrow travel-keyword filter. It's common for
  // the first page (or several) to have zero matches even though later pages do. Rather than
  // dead-ending the user on an empty state with a lone "Load more" button, keep paging
  // automatically (bounded) until we find something or exhaust a reasonable number of pages.
  useEffect(() => {
    if (
      isDefaultQuery &&
      !isFetching &&
      data &&
      data.messages.length === 0 &&
      data.nextPageToken &&
      autoPageCount < MAX_AUTO_PAGES
    ) {
      setAutoPageCount((c) => c + 1);
      setPageToken(data.nextPageToken ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDefaultQuery, isFetching, data, autoPageCount]);

  function handleSearch() {
    setPageToken(undefined);
    setAutoPageCount(0);
    setCommittedQuery(query.trim());
    setChecked({});
  }

  function handleLink(m: GmailInboxMessage) {
    const tripId = Number(selectedTrip[m.id]);
    if (!tripId) {
      toast.error("Pick a trip first");
      return;
    }
    link.mutate(
      { messageId: m.id, tripId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: inboxQueryKey });
          toast.success("Added as trip document(s)");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not link this email"),
      },
    );
  }

  function handleIgnore(m: GmailInboxMessage) {
    ignore.mutate(m.id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: inboxQueryKey });
        toast.success("Marked as not travel-related");
      },
      onError: () => toast.error("Could not update this email"),
    });
  }

  function handleReconsider(m: GmailInboxMessage) {
    reconsider.mutate(m.id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: inboxQueryKey });
        toast.success("Moved back to unhandled");
      },
      onError: () => toast.error("Could not update this email"),
    });
  }

  const selectableMessages = (data?.messages ?? []).filter((m) => !m.alreadyLinked);
  const selectedIds = Object.keys(checked).filter((id) => checked[id]);

  function toggleChecked(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleBulkLink() {
    const tripId = Number(bulkTripId);
    if (!tripId) {
      toast.error("Pick a trip first");
      return;
    }
    if (selectedIds.length === 0) return;
    bulkLink.mutate(
      { messageIds: selectedIds, tripId },
      {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: inboxQueryKey });
          setChecked({});
          const failed = result.results.filter((r) => r.status === "failed").length;
          const linked = result.results.filter((r) => r.status === "linked").length;
          if (failed > 0) {
            toast.error(`Added ${linked} email(s); ${failed} could not be imported.`);
          } else {
            toast.success(`Added ${linked} email(s) as trip document(s)`);
          }
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Bulk import failed"),
      },
    );
  }

  const visibleMessages = (data?.messages ?? []).filter((m) => showIgnored || !m.alreadyIgnored);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder='Gmail search, e.g. from:delta.com'
            className="pl-8"
          />
        </div>
        <Button variant="outline" onClick={handleSearch} disabled={isFetching}>
          Search
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="show-ignored"
          checked={showIgnored}
          onCheckedChange={(v) => setShowIgnored(v === true)}
        />
        <label htmlFor="show-ignored" className="text-xs text-muted-foreground cursor-pointer select-none">
          Show ignored emails
        </label>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center rounded-xl border border-card-border bg-muted/50 p-3">
          <p className="text-sm font-medium text-foreground">{selectedIds.length} selected</p>
          <TripPicker trips={trips} value={bulkTripId} onChange={setBulkTripId} disabled={bulkLink.isPending} />
          <Button size="sm" onClick={handleBulkLink} disabled={bulkLink.isPending || !bulkTripId}>
            {bulkLink.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Paperclip className="h-3.5 w-3.5 mr-1.5" />
            )}
            Add {selectedIds.length} to trip
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChecked({})} disabled={bulkLink.isPending}>
            Clear
          </Button>
        </div>
      )}

      {isLoading || (isFetching && isDefaultQuery && (data?.messages.length ?? 0) === 0) ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {isDefaultQuery && autoPageCount > 0
            ? "Still searching your inbox for travel-related emails…"
            : "Searching your inbox…"}
        </p>
      ) : visibleMessages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border p-8 text-center space-y-1">
          <Mail className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No matching emails found.</p>
          {isDefaultQuery ? (
            data?.nextPageToken ? (
              <p className="text-xs text-muted-foreground">
                We searched several pages of your inbox for travel-related emails without a match.
                Keep looking, or try a custom search above (e.g. <code>from:delta.com</code>).
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                We searched your whole inbox for travel-related emails and found no matches. Try a
                custom search above (e.g. <code>from:delta.com</code>).
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Try a different search term.</p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card overflow-hidden">
          {visibleMessages.map((m) => (
            <li key={m.id} className="p-4 space-y-3 transition-colors hover:bg-muted/30">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {selectableMessages.some((s) => s.id === m.id) && (
                    <Checkbox
                      className="mt-2.5"
                      checked={!!checked[m.id]}
                      onCheckedChange={() => toggleChecked(m.id)}
                      aria-label="Select email"
                    />
                  )}
                  <SenderAvatar from={m.from} className="h-9 w-9 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{m.subject || "(no subject)"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {getDisplayName(m.from)} · {formatDate(m.date)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1">{m.snippet}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.alreadyLinked && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      Linked
                    </span>
                  )}
                  {m.alreadyIgnored && !m.alreadyLinked && (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      Ignored
                    </span>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onView(m.id)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {!m.alreadyLinked && !m.alreadyIgnored && (
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center pl-12">
                  <TripPicker
                    trips={trips}
                    value={selectedTrip[m.id] ?? ""}
                    onChange={(v) => setSelectedTrip((prev) => ({ ...prev, [m.id]: v }))}
                    disabled={link.isPending}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleLink(m)} disabled={link.isPending || !selectedTrip[m.id]}>
                      <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                      Add to trip
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleIgnore(m)} disabled={ignore.isPending}>
                      Not travel
                    </Button>
                  </div>
                </div>
              )}

              {m.alreadyIgnored && !m.alreadyLinked && (
                <div className="pl-12">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReconsider(m)}
                    disabled={reconsider.isPending}
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                    Reconsider
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {data?.nextPageToken && visibleMessages.length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAutoPageCount(0);
              setPageToken(data.nextPageToken ?? undefined);
            }}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

export default function GmailReview() {
  const { data: status, isLoading: statusLoading } = useGetGmailStatus();
  const scan = useScanGmail();
  const qc = useQueryClient();
  const { data: trips = [] } = useListTrips();
  const [viewingMessageId, setViewingMessageId] = useState<string | null>(null);

  const context = useMemo(() => {
    if (statusLoading) return undefined;
    if (!status?.connected) {
      return "Gmail page: Gmail is not connected for this user. Connecting requires an OAuth redirect elAIne cannot trigger — direct them to Settings to connect.";
    }
    return `Gmail page: connected as ${status.googleEmail}. Users can review AI-found travel email suggestions, manually browse their inbox to attach any email (or multiple selected emails at once) to a trip as document(s), view full email content, and reconsider previously ignored emails.`;
  }, [statusLoading, status]);
  usePageAssistantContext("gmail", context);

  function handleScan() {
    scan.mutate(undefined, {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getGetGmailSuggestionsQueryKey() });
        toast.success(`Scanned ${result.scanned} emails — ${result.suggested} new suggestion(s)`);
      },
      onError: () => toast.error("Could not scan Gmail right now. Please try again."),
    });
  }

  if (statusLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>;
  }

  if (!status?.connected) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Gmail</h1>
          <p className="text-muted-foreground mt-1">
            Connect your Gmail account from Settings to scan for travel confirmations.
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-card-border p-8 text-center space-y-2">
          <Mail className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Not connected yet.</p>
          <Button asChild>
            <a href="/settings">Go to Settings</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Gmail</h1>
          <p className="text-muted-foreground mt-1">
            Connected as {status.googleEmail}
            {status.lastScanAt ? ` · last scanned ${formatDate(status.lastScanAt)}` : ""}
          </p>
        </div>
        <Button variant="outline" onClick={handleScan} disabled={scan.isPending}>
          {scan.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Scan now
        </Button>
      </div>

      <Tabs defaultValue="suggestions">
        <TabsList>
          <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
          <TabsTrigger value="browse">Browse inbox</TabsTrigger>
        </TabsList>
        <TabsContent value="suggestions" className="pt-4">
          <SuggestionsTab trips={trips} onView={setViewingMessageId} />
        </TabsContent>
        <TabsContent value="browse" className="pt-4">
          <InboxBrowserTab trips={trips} onView={setViewingMessageId} />
        </TabsContent>
      </Tabs>

      <ViewMessageDialog
        messageId={viewingMessageId}
        onOpenChange={(open) => !open && setViewingMessageId(null)}
      />
    </div>
  );
}
