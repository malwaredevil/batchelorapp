import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Search, Loader2, CheckCircle2, XCircle, Paperclip, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGetGmailStatus,
  useScanGmail,
  useGetGmailSuggestions,
  useDismissGmailSuggestion,
  useGetGmailInbox,
  useLinkGmailMessage,
  useIgnoreGmailMessage,
  useListTrips,
  getGetGmailSuggestionsQueryKey,
  getGetGmailInboxQueryKey,
  type GmailScanDecision,
  type GmailInboxMessage,
  type Trip,
} from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/lib/assistant-context";

function formatDate(value: string | null): string {
  if (!value) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

function SuggestionsTab({ trips }: { trips: Trip[] }) {
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
          toast.success("Added as a trip document");
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
    <ul className="space-y-3">
      {suggestions.map((s) => {
        const extracted = (s.extractedData ?? {}) as Record<string, unknown>;
        return (
          <li key={s.id} className="rounded-xl border border-card-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{s.subject || "(no subject)"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.fromAddress} · {formatDate(s.receivedAt)}
                </p>
              </div>
              {typeof extracted.documentType === "string" && (
                <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium capitalize text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                  {extracted.documentType.replace(/_/g, " ")}
                </span>
              )}
            </div>

            {(typeof extracted.providerName === "string" || typeof extracted.referenceNumber === "string") && (
              <p className="text-xs text-muted-foreground">
                {[extracted.providerName, extracted.referenceNumber]
                  .filter((v): v is string => typeof v === "string" && v.length > 0)
                  .join(" · ")}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
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

function InboxBrowserTab({ trips }: { trips: Trip[] }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const { data, isLoading, isFetching } = useGetGmailInbox({ q: committedQuery || undefined, pageToken });
  const link = useLinkGmailMessage();
  const ignore = useIgnoreGmailMessage();
  const [selectedTrip, setSelectedTrip] = useState<Record<string, string>>({});

  function handleSearch() {
    setPageToken(undefined);
    setCommittedQuery(query.trim());
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
          qc.invalidateQueries({ queryKey: getGetGmailInboxQueryKey({ q: committedQuery || undefined, pageToken }) });
          toast.success("Added as a trip document");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not link this email"),
      },
    );
  }

  function handleIgnore(m: GmailInboxMessage) {
    ignore.mutate(m.id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetGmailInboxQueryKey({ q: committedQuery || undefined, pageToken }) });
        toast.success("Marked as not travel-related");
      },
      onError: () => toast.error("Could not update this email"),
    });
  }

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

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Searching your inbox…</p>
      ) : (data?.messages.length ?? 0) === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border p-8 text-center">
          <p className="text-sm text-muted-foreground">No matching emails found.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data!.messages.map((m) => (
            <li key={m.id} className="rounded-xl border border-card-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{m.subject || "(no subject)"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.from} · {formatDate(m.date)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-1">{m.snippet}</p>
                </div>
                {m.alreadyLinked && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    Linked
                  </span>
                )}
                {m.alreadyIgnored && !m.alreadyLinked && (
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    Ignored
                  </span>
                )}
              </div>

              {!m.alreadyLinked && !m.alreadyIgnored && (
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
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
            </li>
          ))}
        </ul>
      )}

      {data?.nextPageToken && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setPageToken(data.nextPageToken!)} disabled={isFetching}>
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

  const context = useMemo(() => {
    if (statusLoading) return undefined;
    if (!status?.connected) {
      return "Gmail page: Gmail is not connected for this user. Connecting requires an OAuth redirect elAIne cannot trigger — direct them to Settings to connect.";
    }
    return `Gmail page: connected as ${status.googleEmail}. Users can review AI-found travel email suggestions or manually browse their inbox to attach any email to a trip as a document.`;
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
          <SuggestionsTab trips={trips} />
        </TabsContent>
        <TabsContent value="browse" className="pt-4">
          <InboxBrowserTab trips={trips} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
