import { useMemo, useState, useEffect } from "react";
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
  Undo2,
  Link2Off,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  useGetGmailStatus,
  useScanGmail,
  useGetGmailSuggestions,
  useDismissGmailSuggestion,
  useGetGmailInbox,
  useLinkGmailMessage,
  useIgnoreGmailMessage,
  useReconsiderGmailMessage,
  useUnlinkGmailMessage,
  useGetGmailMessage,
  useBulkLinkGmailMessages,
  useBulkUnlinkGmailMessages,
  relinkGmailMessagesAfterUndo,
  useListTrips,
  getGetGmailSuggestionsQueryKey,
  getGetGmailInboxQueryKey,
  getGetGmailMessageQueryKey,
  type GmailScanDecision,
  type GmailInboxMessage,
  type Trip,
  type GmailMessageAttachment,
} from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { cn } from "@/lib/utils";

function formatDate(value: string | null): string {
  if (!value) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function SenderAvatar({
  from,
  className,
}: {
  from: string | null | undefined;
  className?: string;
}) {
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
    query: {
      enabled: !!messageId,
      queryKey: getGetGmailMessageQueryKey(messageId ?? ""),
    },
  });

  return (
    <Dialog open={!!messageId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {isLoading || !data ? (
          <div className="p-8">
            <p className="text-sm text-muted-foreground py-6 text-center">
              Loading email…
            </p>
          </div>
        ) : isError ? (
          <div className="p-8">
            <p className="text-sm text-destructive py-6 text-center">
              Could not load this email.
            </p>
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

function formatAttachmentSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentTypeLabel(a: GmailMessageAttachment): string {
  if (a.mimeType === "application/pdf") return "PDF";
  const sub = a.mimeType.split("/")[1] ?? a.mimeType;
  return sub.toUpperCase();
}

function AttachmentPickerDialog({
  messageId,
  onClose,
  onConfirm,
  isLinking,
}: {
  messageId: string;
  onClose: () => void;
  onConfirm: (attachmentIds: string[], includeEmailBody: boolean) => void;
  isLinking: boolean;
}) {
  const { data, isLoading } = useGetGmailMessage(messageId, {
    query: { queryKey: getGetGmailMessageQueryKey(messageId) },
  });
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [includeBody, setIncludeBody] = useState(false);

  useEffect(() => {
    if (!data) return;
    setCheckedIds(new Set(data.attachments.map((a) => a.attachmentId)));
    setIncludeBody(data.attachments.length === 0);
  }, [data]);

  const hasAttachments = (data?.attachments.length ?? 0) > 0;
  const selectedCount = checkedIds.size + (includeBody ? 1 : 0);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isLinking) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose what to attach</DialogTitle>
          <DialogDescription>
            Select which parts of this email to save as trip documents.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {data.attachments.map((a) => (
              <label
                key={a.attachmentId}
                className="flex items-center gap-3 rounded-lg border border-card-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  checked={checkedIds.has(a.attachmentId)}
                  onCheckedChange={(v) =>
                    setCheckedIds((prev) => {
                      const next = new Set(prev);
                      v ? next.add(a.attachmentId) : next.delete(a.attachmentId);
                      return next;
                    })
                  }
                />
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.filename}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {attachmentTypeLabel(a)}
                    {a.size ? ` · ${formatAttachmentSize(a.size)}` : ""}
                  </p>
                </div>
              </label>
            ))}

            <label className="flex items-center gap-3 rounded-lg border border-card-border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <Checkbox
                checked={includeBody || !hasAttachments}
                disabled={!hasAttachments}
                onCheckedChange={(v) => setIncludeBody(!!v)}
              />
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Email body text</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasAttachments
                    ? "Also include the email's plain-text content"
                    : "The email text will be saved as a document"}
                </p>
              </div>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-card-border">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLinking}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() =>
              onConfirm(Array.from(checkedIds), includeBody || !hasAttachments)
            }
            disabled={isLoading || selectedCount === 0 || isLinking}
          >
            {isLinking ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                {selectedCount === 0
                  ? "Select at least one"
                  : selectedCount === 1
                    ? "Add to trip"
                    : `Add to trip (${selectedCount} items)`}
              </>
            )}
          </Button>
        </div>
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

  const [linkTarget, setLinkTarget] = useState<{
    messageId: string;
    tripId: number;
  } | null>(null);

  function handleLink(s: GmailScanDecision) {
    const tripId = Number(selectedTrip[s.id]);
    if (!tripId) {
      toast.error("Pick a trip first");
      return;
    }
    setLinkTarget({ messageId: s.gmailMessageId, tripId });
  }

  function handleConfirmLink(
    attachmentIds: string[],
    includeEmailBody: boolean,
  ) {
    if (!linkTarget) return;
    const { messageId, tripId } = linkTarget;
    link.mutate(
      { messageId, tripId, attachmentIds, includeEmailBody },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetGmailSuggestionsQueryKey() });
          setLinkTarget(null);
          toast.success("Added as trip document(s)");
        },
        onError: (err) => {
          setLinkTarget(null);
          toast.error(
            err instanceof Error ? err.message : "Could not link this email",
          );
        },
      },
    );
  }

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Loading suggestions…
      </p>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-card-border p-8 text-center space-y-1">
        <Mail className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          No pending suggestions
        </p>
        <p className="text-xs text-muted-foreground">
          Run a scan or check back after your next automatic scan (every 6
          hours).
        </p>
      </div>
    );
  }

  return (
    <>
    <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card overflow-hidden">
      {suggestions.map((s) => {
        const extracted = (s.extractedData ?? {}) as Record<string, unknown>;
        return (
          <li
            key={s.id}
            className="p-4 space-y-3 transition-colors hover:bg-muted/30 cursor-pointer"
            onClick={() => onView(s.gmailMessageId)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <SenderAvatar from={s.fromAddress} className="h-9 w-9 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate hover:underline">
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

            {(typeof extracted.providerName === "string" ||
              typeof extracted.referenceNumber === "string") && (
              <p className="text-xs text-muted-foreground pl-12">
                {[extracted.providerName, extracted.referenceNumber]
                  .filter(
                    (v): v is string => typeof v === "string" && v.length > 0,
                  )
                  .join(" · ")}
              </p>
            )}

            <div
              className="flex flex-col sm:flex-row gap-2 sm:items-center pl-12"
              onClick={(e) => e.stopPropagation()}
            >
              <TripPicker
                trips={trips}
                value={selectedTrip[s.id] ?? ""}
                onChange={(v) =>
                  setSelectedTrip((prev) => ({ ...prev, [s.id]: v }))
                }
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
    {linkTarget && (
      <AttachmentPickerDialog
        messageId={linkTarget.messageId}
        onClose={() => setLinkTarget(null)}
        onConfirm={handleConfirmLink}
        isLinking={link.isPending}
      />
    )}
    </>
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
  const [pageSize, setPageSize] = useState(20);
  // History of page tokens visited so far for the current query/page-size, so the user can
  // step back with "Previous" as well as forward with "Next" (Gmail's API only exposes a
  // forward cursor, so "Previous" replays the token we already fetched with).
  const [pageHistory, setPageHistory] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const pageToken = pageHistory[pageIndex];
  const [showIgnored, setShowIgnored] = useState(false);
  const { data, isLoading, isFetching } = useGetGmailInbox({
    q: committedQuery || undefined,
    pageToken,
    maxResults: pageSize,
  });
  const link = useLinkGmailMessage();
  const ignore = useIgnoreGmailMessage();
  const reconsider = useReconsiderGmailMessage();
  const unlink = useUnlinkGmailMessage();
  const bulkLink = useBulkLinkGmailMessages();
  const bulkUnlink = useBulkUnlinkGmailMessages();
  const [selectedTrip, setSelectedTrip] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [checkedLinked, setCheckedLinked] = useState<Record<string, boolean>>({});
  const [bulkTripId, setBulkTripId] = useState("");
  const [unlinkTarget, setUnlinkTarget] = useState<GmailInboxMessage | null>(
    null,
  );

  const inboxQueryKey = getGetGmailInboxQueryKey({
    q: committedQuery || undefined,
    pageToken,
    maxResults: pageSize,
  });

  function resetPaging() {
    setPageHistory([undefined]);
    setPageIndex(0);
  }

  function handleSearch() {
    resetPaging();
    setCommittedQuery(query.trim());
    setChecked({});
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    resetPaging();
  }

  function handleNextPage() {
    if (!data?.nextPageToken) return;
    setPageHistory((h) => [
      ...h.slice(0, pageIndex + 1),
      data.nextPageToken ?? undefined,
    ]);
    setPageIndex((i) => i + 1);
  }

  function handlePreviousPage() {
    setPageIndex((i) => Math.max(0, i - 1));
  }

  const [linkTarget, setLinkTarget] = useState<{
    messageId: string;
    tripId: number;
  } | null>(null);

  function handleLink(m: GmailInboxMessage) {
    const tripId = Number(selectedTrip[m.id]);
    if (!tripId) {
      toast.error("Pick a trip first");
      return;
    }
    setLinkTarget({ messageId: m.id, tripId });
  }

  function handleConfirmLink(
    attachmentIds: string[],
    includeEmailBody: boolean,
  ) {
    if (!linkTarget) return;
    const { messageId, tripId } = linkTarget;
    link.mutate(
      { messageId, tripId, attachmentIds, includeEmailBody },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: inboxQueryKey });
          setLinkTarget(null);
          toast.success("Added as trip document(s)");
        },
        onError: (err) => {
          setLinkTarget(null);
          toast.error(
            err instanceof Error ? err.message : "Could not link this email",
          );
        },
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

  function handleConfirmUnlink() {
    const m = unlinkTarget;
    if (!m) return;
    const savedId = m.id;
    const savedTripId = m.linkedTripId;
    const savedTripTitle = m.linkedTripTitle;
    const savedDocName = m.linkedDocumentName;
    unlink.mutate(savedId, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: inboxQueryKey });
        setUnlinkTarget(null);
        toast(
          savedDocName
            ? `"${savedDocName}" deleted`
            : "Trip document deleted",
          {
            description: savedTripTitle
              ? `Removed from ${savedTripTitle}`
              : "This email can be added to a trip again",
            duration: 6000,
            action:
              savedTripId != null
                ? {
                    label: "Undo",
                    onClick: () => {
                      link.mutate(
                        { messageId: savedId, tripId: savedTripId },
                        {
                          onSuccess: () => {
                            qc.invalidateQueries({ queryKey: inboxQueryKey });
                            toast.success("Re-linked successfully");
                          },
                          onError: () =>
                            toast.error("Could not re-link this email"),
                        },
                      );
                    },
                  }
                : undefined,
          },
        );
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Could not unlink this email",
        );
        setUnlinkTarget(null);
      },
    });
  }

  const selectableMessages = (data?.messages ?? []).filter(
    (m) => !m.alreadyLinked,
  );
  const selectedIds = Object.keys(checked).filter((id) => checked[id]);
  const selectedLinkedIds = Object.keys(checkedLinked).filter(
    (id) => checkedLinked[id],
  );

  function toggleChecked(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleCheckedLinked(id: string) {
    setCheckedLinked((prev) => ({ ...prev, [id]: !prev[id] }));
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
          const failed = result.results.filter(
            (r) => r.status === "failed",
          ).length;
          const linked = result.results.filter(
            (r) => r.status === "linked",
          ).length;
          if (failed > 0) {
            toast.error(
              `Added ${linked} email(s); ${failed} could not be imported.`,
            );
          } else {
            toast.success(`Added ${linked} email(s) as trip document(s)`);
          }
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Bulk import failed",
          ),
      },
    );
  }

  function handleBulkUnlink() {
    if (selectedLinkedIds.length === 0) return;
    // Snapshot the per-message trip IDs before the mutation clears the UI
    const pendingItems: { messageId: string; tripId: number }[] = selectedLinkedIds
      .map((id) => {
        const msg = (data?.messages ?? []).find((m) => m.id === id);
        return msg?.linkedTripId != null
          ? { messageId: id, tripId: msg.linkedTripId }
          : null;
      })
      .filter((x): x is { messageId: string; tripId: number } => x !== null);

    bulkUnlink.mutate(
      { messageIds: selectedLinkedIds },
      {
        onSuccess: (result) => {
          qc.invalidateQueries({ queryKey: inboxQueryKey });
          setCheckedLinked({});
          const unlinkedCount = result.results.filter(
            (r) => r.status === "unlinked",
          ).length;
          const failed = result.results.filter(
            (r) => r.status === "failed",
          ).length;
          const successItems = pendingItems.filter((p) =>
            result.results.some(
              (r) => r.messageId === p.messageId && r.status === "unlinked",
            ),
          );
          if (failed > 0) {
            toast.error(
              `Unlinked ${unlinkedCount} email(s); ${failed} could not be removed.`,
            );
          } else {
            toast(
              unlinkedCount === 1
                ? "1 email unlinked"
                : `${unlinkedCount} emails unlinked`,
              {
                description: "Documents deleted. Emails can be re-added.",
                duration: 6000,
                action:
                  successItems.length > 0
                    ? {
                        label: "Undo",
                        onClick: () => {
                          relinkGmailMessagesAfterUndo(successItems)
                            .then(() => {
                              qc.invalidateQueries({
                                queryKey: inboxQueryKey,
                              });
                              toast.success(
                                `Re-linked ${successItems.length} email(s)`,
                              );
                            })
                            .catch(() =>
                              toast.error("Could not re-link some emails"),
                            );
                        },
                      }
                    : undefined,
              },
            );
          }
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Bulk unlink failed",
          ),
      },
    );
  }

  const visibleMessages = (data?.messages ?? []).filter(
    (m) => showIgnored || !m.alreadyIgnored,
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Gmail search, e.g. from:delta.com"
            className="pl-8"
          />
        </div>
        <Button variant="outline" onClick={handleSearch} disabled={isFetching}>
          Search
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-ignored"
            checked={showIgnored}
            onCheckedChange={(v) => setShowIgnored(v === true)}
          />
          <label
            htmlFor="show-ignored"
            className="text-xs text-muted-foreground cursor-pointer select-none"
          >
            Show ignored emails
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="page-size" className="text-xs text-muted-foreground">
            Per page
          </label>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => handlePageSizeChange(Number(v))}
          >
            <SelectTrigger id="page-size" className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center rounded-xl border border-card-border bg-muted/50 p-3">
          <p className="text-sm font-medium text-foreground">
            {selectedIds.length} selected
          </p>
          <TripPicker
            trips={trips}
            value={bulkTripId}
            onChange={setBulkTripId}
            disabled={bulkLink.isPending}
          />
          <Button
            size="sm"
            onClick={handleBulkLink}
            disabled={bulkLink.isPending || !bulkTripId}
          >
            {bulkLink.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Paperclip className="h-3.5 w-3.5 mr-1.5" />
            )}
            Add {selectedIds.length} to trip
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setChecked({})}
            disabled={bulkLink.isPending}
          >
            Clear
          </Button>
        </div>
      )}

      {selectedLinkedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-foreground">
            {selectedLinkedIds.length} linked selected
          </p>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkUnlink}
            disabled={bulkUnlink.isPending}
          >
            {bulkUnlink.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Link2Off className="h-3.5 w-3.5 mr-1.5" />
            )}
            Unlink {selectedLinkedIds.length}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCheckedLinked({})}
            disabled={bulkUnlink.isPending}
          >
            Clear
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Loading your inbox…
        </p>
      ) : visibleMessages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border p-8 text-center space-y-1">
          <Mail className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {committedQuery
              ? "No matching emails found."
              : "No emails on this page."}
          </p>
          <p className="text-xs text-muted-foreground">
            {committedQuery
              ? "Try a different search term."
              : "Try going back a page, or search above (e.g. from:delta.com)."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card overflow-hidden">
          {visibleMessages.map((m) => (
            <li
              key={m.id}
              className="p-4 space-y-3 transition-colors hover:bg-muted/30 cursor-pointer"
              onClick={() => onView(m.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {selectableMessages.some((s) => s.id === m.id) && (
                    <Checkbox
                      className="mt-2.5"
                      checked={!!checked[m.id]}
                      onCheckedChange={() => toggleChecked(m.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Select email"
                    />
                  )}
                  <SenderAvatar from={m.from} className="h-9 w-9 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate hover:underline">
                      {m.subject || "(no subject)"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {getDisplayName(m.from)} · {formatDate(m.date)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {m.snippet}
                    </p>
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
                </div>
              </div>

              {!m.alreadyLinked && !m.alreadyIgnored && (
                <div
                  className="flex flex-col sm:flex-row gap-2 sm:items-center pl-12"
                  onClick={(e) => e.stopPropagation()}
                >
                  <TripPicker
                    trips={trips}
                    value={selectedTrip[m.id] ?? ""}
                    onChange={(v) =>
                      setSelectedTrip((prev) => ({ ...prev, [m.id]: v }))
                    }
                    disabled={link.isPending}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleLink(m)}
                      disabled={link.isPending || !selectedTrip[m.id]}
                    >
                      <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                      Add to trip
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleIgnore(m)}
                      disabled={ignore.isPending}
                    >
                      Not travel
                    </Button>
                  </div>
                </div>
              )}

              {m.alreadyIgnored && !m.alreadyLinked && (
                <div className="pl-12" onClick={(e) => e.stopPropagation()}>
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

              {m.alreadyLinked && (
                <div
                  className="flex items-center gap-2 pl-12"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={!!checkedLinked[m.id]}
                    onCheckedChange={() => toggleCheckedLinked(m.id)}
                    aria-label="Select linked email"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setUnlinkTarget(m)}
                    disabled={unlink.isPending}
                  >
                    <Link2Off className="h-3.5 w-3.5 mr-1.5" />
                    Unlink
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {visibleMessages.length > 0 && (pageIndex > 0 || data?.nextPageToken) && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreviousPage}
            disabled={pageIndex === 0 || isFetching}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {pageIndex + 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            disabled={!data?.nextPageToken || isFetching}
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : null}
            Next
          </Button>
        </div>
      )}

      <AlertDialog
        open={unlinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink this email?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This frees{" "}
                  <span className="font-medium text-foreground">
                    {unlinkTarget?.subject || "(no subject)"}
                  </span>{" "}
                  so you can add it to a trip again.
                </p>
                <div className="rounded-lg border border-card-border bg-muted/40 p-3 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Will be deleted
                  </p>
                  <p className="mt-1 text-foreground">
                    {unlinkTarget?.linkedDocumentName ||
                      "The trip document created from this email"}
                    {unlinkTarget?.linkedTripTitle ? (
                      <>
                        {" "}
                        <span className="text-muted-foreground">
                          from {unlinkTarget.linkedTripTitle}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Any itinerary entries created from this document are removed
                    too. This can't be undone, but you can re-add the email
                    afterwards.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlink.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmUnlink();
              }}
              disabled={unlink.isPending}
            >
              {unlink.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Link2Off className="h-3.5 w-3.5 mr-1.5" />
              )}
              Unlink &amp; delete document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {linkTarget && (
        <AttachmentPickerDialog
          messageId={linkTarget.messageId}
          onClose={() => setLinkTarget(null)}
          onConfirm={handleConfirmLink}
          isLinking={link.isPending}
        />
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
      return "Gmail page: Gmail is not connected for this user. Connecting requires an OAuth redirect Elaine cannot trigger — direct them to Settings to connect.";
    }
    return `Gmail page: connected as ${status.googleEmail}. Users can review AI-found travel email suggestions, manually browse their inbox to attach any email (or multiple selected emails at once) to a trip as document(s), view full email content, and reconsider previously ignored emails.`;
  }, [statusLoading, status]);
  usePageAssistantContext("gmail", context);

  function handleScan() {
    scan.mutate(undefined, {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getGetGmailSuggestionsQueryKey() });
        toast.success(
          `Scanned ${result.scanned} emails — ${result.suggested} new suggestion(s)`,
        );
      },
      onError: () =>
        toast.error("Could not scan Gmail right now. Please try again."),
    });
  }

  if (statusLoading) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
    );
  }

  if (!status?.connected) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Gmail</h1>
          <p className="text-muted-foreground mt-1">
            Connect your Gmail account from Settings to scan for travel
            confirmations.
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
            {status.lastScanAt
              ? ` · last scanned ${formatDate(status.lastScanAt)}`
              : ""}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleScan}
          disabled={scan.isPending}
        >
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
