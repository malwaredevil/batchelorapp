import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Brain,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Clock,
  User,
  Home,
  Timer,
  ChevronDown,
  ChevronUp,
  Search,
  ScrollText,
  RefreshCw,
  Radio,
  Smartphone,
  Mail,
  MessageSquare,
  Monitor,
} from "lucide-react";
import {
  useListElaineMemory,
  getListElaineMemoryQueryKey,
  useCreateElaineMemory,
  useUpdateElaineMemory,
  useDeleteElaineMemoryItem,
  useGetElaineCrossChannelContext,
  useClearElaineCrossChannelContext,
  getGetElaineCrossChannelContextQueryKey,
  useGetElaineUnifiedHistory,
  type HouseholdMemoryItem,
  type MemoryScope,
  type MemoryCategory,
  type MemorySensitivity,
  type CrossChannelEntry,
  type UnifiedHistoryMessage,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ElaineAvatar, ElaineName } from "@workspace/elaine-ui";

const SCOPE_LABELS: Record<MemoryScope, string> = {
  household: "Household",
  personal: "Personal",
  temporary: "Temporary",
};

const SCOPE_ICONS: Record<MemoryScope, typeof Home> = {
  household: Home,
  personal: User,
  temporary: Timer,
};

const SCOPE_COLORS: Record<MemoryScope, string> = {
  household: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  personal:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  temporary:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  fact: "Fact",
  preference: "Preference",
  instruction: "Instruction",
  person: "Person",
  place: "Place",
  collection: "Collection",
};

const SENSITIVITY_COLORS: Record<MemorySensitivity, string> = {
  low: "",
  medium: "border-amber-300 dark:border-amber-700",
  high: "border-red-300 dark:border-red-700",
};

function formatRelative(date: string) {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return d.toLocaleDateString();
}

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  const now = new Date();
  if (d < now) return "Expired";
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / 86400000);
  if (days === 1) return "Expires tomorrow";
  if (days < 30) return `Expires in ${days} days`;
  return `Expires ${d.toLocaleDateString()}`;
}

interface MemoryCardProps {
  item: HouseholdMemoryItem;
  onDeleted: () => void;
  onUpdated: () => void;
}

function MemoryCard({ item, onDeleted, onUpdated }: MemoryCardProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(item.content);
  const [editScope, setEditScope] = useState<MemoryScope>(item.scope);
  const [editCategory, setEditCategory] = useState<MemoryCategory>(
    item.category,
  );
  const [editSensitivity, setEditSensitivity] = useState<MemorySensitivity>(
    item.sensitivity,
  );
  const [deleting, setDeleting] = useState(false);
  const updateMemory = useUpdateElaineMemory();
  const deleteMemory = useDeleteElaineMemoryItem();
  const ScopeIcon = SCOPE_ICONS[item.scope];
  const expiry = formatExpiry(item.expiresAt);

  function handleSave() {
    if (!editContent.trim()) return;
    updateMemory.mutate(
      {
        id: item.id,
        body: {
          content: editContent.trim(),
          scope: editScope,
          category: editCategory,
          sensitivity: editSensitivity,
        },
      },
      {
        onSuccess: () => {
          toast.success("Memory updated");
          setEditing(false);
          onUpdated();
        },
        onError: () => toast.error("Failed to update memory"),
      },
    );
  }

  function handleDelete() {
    setDeleting(true);
    deleteMemory.mutate(item.id, {
      onSuccess: () => {
        toast.success("Memory removed");
        onDeleted();
      },
      onError: () => {
        toast.error("Failed to remove memory");
        setDeleting(false);
      },
    });
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
        <Textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          rows={3}
          className="resize-none text-sm"
          autoFocus
        />
        <div className="flex flex-wrap gap-2">
          <Select
            value={editScope}
            onValueChange={(v) => setEditScope(v as MemoryScope)}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="household">Household</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
              <SelectItem value="temporary">Temporary</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={editCategory}
            onValueChange={(v) => setEditCategory(v as MemoryCategory)}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fact">Fact</SelectItem>
              <SelectItem value="preference">Preference</SelectItem>
              <SelectItem value="instruction">Instruction</SelectItem>
              <SelectItem value="person">Person</SelectItem>
              <SelectItem value="place">Place</SelectItem>
              <SelectItem value="collection">Collection</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={editSensitivity}
            onValueChange={(v) => setEditSensitivity(v as MemorySensitivity)}
          >
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low sensitivity</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setEditContent(item.content);
              setEditScope(item.scope);
              setEditCategory(item.category);
              setEditSensitivity(item.sensitivity);
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMemory.isPending || !editContent.trim()}
          >
            <Check className="h-4 w-4 mr-1" />
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group rounded-xl border bg-card p-4 transition-all ${SENSITIVITY_COLORS[item.sensitivity]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground flex-1 leading-relaxed">
          {item.content}
        </p>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${SCOPE_COLORS[item.scope]}`}
        >
          <ScopeIcon className="h-3 w-3" />
          {SCOPE_LABELS[item.scope]}
        </span>
        <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">
          {CATEGORY_LABELS[item.category]}
        </span>
        {item.sensitivity !== "low" && (
          <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">
            {item.sensitivity === "high" ? "🔒 Sensitive" : "⚠️ Medium"}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {item.lastConfirmedAt
            ? `Confirmed ${formatRelative(item.lastConfirmedAt).toLowerCase()}`
            : `Added ${formatRelative(item.createdAt).toLowerCase()}`}
        </span>
        <span className="text-xs text-muted-foreground">
          {item.source.replace(/_/g, " ")}
        </span>
        {expiry && (
          <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {expiry}
          </span>
        )}
      </div>
    </div>
  );
}

interface AddMemoryFormProps {
  onAdded: () => void;
  onCancel: () => void;
}

function AddMemoryForm({ onAdded, onCancel }: AddMemoryFormProps) {
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<MemoryScope>("household");
  const [category, setCategory] = useState<MemoryCategory>("fact");
  const [sensitivity, setSensitivity] = useState<MemorySensitivity>("low");
  const [expiresInDays, setExpiresInDays] = useState("");
  const createMemory = useCreateElaineMemory();

  function handleCreate() {
    if (!content.trim()) return;
    const body = {
      content: content.trim(),
      scope,
      category,
      sensitivity,
      ...(scope === "temporary" && expiresInDays
        ? { expiresInDays: parseInt(expiresInDays, 10) }
        : {}),
    };
    createMemory.mutate(body, {
      onSuccess: () => {
        toast.success("Memory saved");
        onAdded();
      },
      onError: () => toast.error("Failed to save memory"),
    });
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
      <p className="text-sm font-medium text-foreground">Add a memory</p>
      <Textarea
        placeholder="e.g. Prefers hand-painted pottery over transfer prints"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
        className="resize-none text-sm"
        autoFocus
      />
      <div className="flex flex-wrap gap-2">
        <Select value={scope} onValueChange={(v) => setScope(v as MemoryScope)}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="household">Household</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="temporary">Temporary</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as MemoryCategory)}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fact">Fact</SelectItem>
            <SelectItem value="preference">Preference</SelectItem>
            <SelectItem value="instruction">Instruction</SelectItem>
            <SelectItem value="person">Person</SelectItem>
            <SelectItem value="place">Place</SelectItem>
            <SelectItem value="collection">Collection</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sensitivity}
          onValueChange={(v) => setSensitivity(v as MemorySensitivity)}
        >
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low sensitivity</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
        {scope === "temporary" && (
          <Input
            type="number"
            placeholder="Expires in (days)"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            className="w-44 h-8 text-xs"
            min="1"
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={createMemory.isPending || !content.trim()}
        >
          <Check className="h-4 w-4 mr-1" />
          Save
        </Button>
      </div>
    </div>
  );
}

const SCOPE_FILTER_OPTIONS = [
  { value: "all", label: "All scopes" },
  { value: "household", label: "Household" },
  { value: "personal", label: "Personal" },
  { value: "temporary", label: "Temporary" },
] as const;

const CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "fact", label: "Fact" },
  { value: "preference", label: "Preference" },
  { value: "instruction", label: "Instruction" },
  { value: "person", label: "Person" },
  { value: "place", label: "Place" },
  { value: "collection", label: "Collection" },
] as const;

const CHANNEL_ICONS: Record<string, typeof Radio> = {
  web: Monitor,
  slack: MessageSquare,
  sms: Smartphone,
  "sms/voice": Smartphone,
  voice: Smartphone,
  email: Mail,
};

const CHANNEL_FILTER_OPTIONS = [
  { value: "all", label: "All channels" },
  { value: "web", label: "Web" },
  { value: "Slack", label: "Slack" },
  { value: "SMS/voice", label: "SMS / Voice" },
  { value: "email", label: "Email" },
] as const;

const CHANNEL_BADGE_COLORS: Record<string, string> = {
  web: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  slack:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "sms/voice":
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  email:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

function channelBadgeColor(ch: string): string {
  return (
    CHANNEL_BADGE_COLORS[ch.toLowerCase()] ?? "bg-muted text-muted-foreground"
  );
}

function localDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatHistoryTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface FullHistoryProps {
  channelFilter: string;
  onChannelChange: (ch: string) => void;
}

function FullHistory({ channelFilter, onChannelChange }: FullHistoryProps) {
  const [page, setPage] = useState(1);
  const effectiveChannel = channelFilter === "all" ? undefined : channelFilter;
  const { data, isLoading, isFetching } = useGetElaineUnifiedHistory(
    page,
    effectiveChannel,
  );

  const messages = data?.messages ?? [];
  const hasMore = data?.hasMore ?? false;
  const total = data?.total ?? 0;

  // Build display list with date separators
  type DisplayItem =
    | { kind: "sep"; label: string }
    | { kind: "msg"; msg: UnifiedHistoryMessage; isRunEnd: boolean };

  const items: DisplayItem[] = [];
  let lastDateLabel = "";
  let lastChannel = "";
  let lastRole = "";

  // messages are newest-first from API; reverse to render oldest-first
  const ordered = [...messages].reverse();
  for (let i = 0; i < ordered.length; i++) {
    const msg = ordered[i]!;
    const dl = localDateLabel(msg.createdAt);
    if (dl !== lastDateLabel) {
      items.push({ kind: "sep", label: dl });
      lastDateLabel = dl;
      lastChannel = "";
      lastRole = "";
    }
    const next = ordered[i + 1];
    const isRunEnd =
      !next ||
      localDateLabel(next.createdAt) !== dl ||
      next.channel !== msg.channel ||
      (msg.role === "assistant" && next.role === "user") ||
      (msg.role === "user" && next.role !== "assistant");
    if (msg.channel !== lastChannel || msg.role !== lastRole) {
      lastChannel = msg.channel;
      lastRole = msg.role;
    }
    items.push({ kind: "msg", msg, isRunEnd });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-sm text-muted-foreground">
        Loading history…
      </div>
    );
  }

  if (!isLoading && total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Clock className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {channelFilter === "all"
            ? "No message history yet."
            : `No messages from ${channelLabel(channelFilter)} yet.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Channel filter pills */}
      <div className="flex flex-wrap gap-2">
        {CHANNEL_FILTER_OPTIONS.map((opt) => {
          const Icon =
            opt.value === "all" ? Radio : channelIcon(opt.value as string);
          const active = channelFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => {
                onChannelChange(opt.value);
                setPage(1);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all border ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-card-border hover:border-primary/30"
              }`}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="space-y-1">
        {items.map((item, idx) => {
          if (item.kind === "sep") {
            return (
              <div key={`sep-${idx}`} className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  {item.label}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            );
          }

          const { msg, isRunEnd } = item;
          const ChanIcon = channelIcon(msg.channel);
          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
            >
              {/* Channel icon — show only at start of a run */}
              <div className="w-6 shrink-0 flex flex-col items-center">
                {!isUser && (
                  <div className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                    <ChanIcon className="h-3 w-3 text-primary" />
                  </div>
                )}
              </div>

              <div
                className={`flex flex-col gap-0.5 max-w-[80%] ${isUser ? "items-end" : "items-start"}`}
              >
                <div
                  className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isUser
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted text-foreground rounded-tl-sm"
                  }`}
                >
                  {msg.content}
                </div>
                {isRunEnd && (
                  <div
                    className={`flex items-center gap-1.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                  >
                    <span className="text-[11px] text-muted-foreground/60">
                      {formatHistoryTime(msg.createdAt)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${channelBadgeColor(msg.channel)}`}
                    >
                      <ChanIcon className="h-2.5 w-2.5" />
                      {channelLabel(msg.channel)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {(hasMore || page > 1) && (
        <div className="flex items-center justify-between pt-2">
          <button
            disabled={page <= 1 || isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            ← Newer
          </button>
          <span className="text-xs text-muted-foreground">
            {total} message{total !== 1 ? "s" : ""}
          </span>
          <button
            disabled={!hasMore || isFetching}
            onClick={() => setPage((p) => p + 1)}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
}

function channelIcon(channel: string): typeof Radio {
  const key = channel.toLowerCase();
  return CHANNEL_ICONS[key] ?? Radio;
}

function channelLabel(channel: string): string {
  if (channel.toLowerCase() === "sms/voice") return "SMS/Voice";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function gistParts(gist: string): { topic: string; reply: string } | null {
  const m = gist.match(/^topic:\s*(.*?)\s*\|\s*reply:\s*(.*)/s);
  if (!m) return null;
  return { topic: m[1]!.trim(), reply: m[2]!.trim() };
}

export default function Memory() {
  const qc = useQueryClient();
  const { data: memory = [], isLoading } = useListElaineMemory();
  const { data: crossChannelData, isLoading: ccLoading } =
    useGetElaineCrossChannelContext();
  const clearCrossChannel = useClearElaineCrossChannelContext();
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | MemoryScope>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | MemoryCategory>(
    "all",
  );
  const [showAdd, setShowAdd] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [clearingSum, setClearingSum] = useState(false);
  const deleteMemory = useDeleteElaineMemoryItem();
  const [activeTab, setActiveTab] = useState<"memory" | "history">("memory");
  const [historyChannel, setHistoryChannel] = useState("all");

  const summary = memory.find((m) => m.type === "summary") ?? null;
  const facts = memory.filter((m) => m.type !== "summary");

  const filtered = facts.filter((m) => {
    if (scopeFilter !== "all" && m.scope !== scopeFilter) return false;
    if (categoryFilter !== "all" && m.category !== categoryFilter) return false;
    if (search && !m.content.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  function refresh() {
    void qc.invalidateQueries({ queryKey: getListElaineMemoryQueryKey() });
  }

  function handleClearSummary() {
    if (!summary) return;
    setClearingSum(true);
    deleteMemory.mutate(summary.id, {
      onSuccess: () => {
        toast.success(
          "Memory summary cleared — it will rebuild from your next conversation",
        );
        refresh();
        setClearingSum(false);
      },
      onError: () => {
        toast.error("Failed to clear summary");
        setClearingSum(false);
      },
    });
  }

  function handleClearCrossChannel() {
    clearCrossChannel.mutate(undefined, {
      onSuccess: () => {
        toast.success("Cross-channel activity cleared");
        void qc.invalidateQueries({
          queryKey: getGetElaineCrossChannelContextQueryKey(),
        });
      },
      onError: () => {
        toast.error("Failed to clear activity");
      },
    });
  }

  const householdCount = facts.filter((m) => m.scope === "household").length;
  const personalCount = facts.filter((m) => m.scope === "personal").length;
  const tempCount = facts.filter((m) => m.scope === "temporary").length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-serif font-semibold text-foreground flex items-center gap-1.5">
            What <ElaineName /> Remembers
          </h1>
          <p className="text-sm text-muted-foreground">
            Facts, preferences, and context stored for future conversations
          </p>
        </div>
        {activeTab === "memory" && (
          <Button
            className="ml-auto"
            size="sm"
            onClick={() => setShowAdd(!showAdd)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1 border border-card-border">
        <button
          onClick={() => setActiveTab("memory")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
            activeTab === "memory"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Brain className="h-4 w-4" />
          Memory
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
            activeTab === "history"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ScrollText className="h-4 w-4" />
          Full history
        </button>
      </div>

      {/* Full history tab */}
      {activeTab === "history" && (
        <FullHistory
          channelFilter={historyChannel}
          onChannelChange={setHistoryChannel}
        />
      )}

      {/* Memory tab content */}
      {activeTab === "memory" && (
        <>
          {/* ── Conversation Summary ── */}
          {!isLoading && (
            <div className="rounded-xl border border-card-border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-card-border">
                <ScrollText className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    Conversation Summary
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your personal continuity summary — explicit facts remain
                    separately auditable below
                  </p>
                </div>
                {summary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1 shrink-0"
                    onClick={handleClearSummary}
                    disabled={clearingSum}
                    title="Clear summary — Elaine will rebuild it from scratch"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
              </div>
              <div className="px-4 py-4">
                {summary ? (
                  <div className="space-y-2">
                    <p className="text-sm text-foreground leading-relaxed">
                      {summary.content}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last updated {formatRelative(summary.updatedAt)}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>
                      No summary yet — it builds up automatically as you chat
                      with <ElaineName />.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Cross-channel Activity ── */}
          {!ccLoading && (
            <div className="rounded-xl border border-card-border bg-card overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-card-border">
                <Radio className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    Recent activity across channels
                  </p>
                  <p className="text-xs text-muted-foreground">
                    What <ElaineName /> has discussed with you on web, Slack,
                    SMS, and email
                  </p>
                </div>
                {(crossChannelData?.entries ?? []).length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1 shrink-0"
                    onClick={handleClearCrossChannel}
                    disabled={clearCrossChannel.isPending}
                    title="Clear cross-channel activity log"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
              </div>
              <div className="px-4 py-3">
                {(crossChannelData?.entries ?? []).length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>
                      No activity yet — each conversation on any channel will
                      appear here.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {(crossChannelData?.entries ?? []).map(
                      (entry: CrossChannelEntry, i: number) => {
                        const ChanIcon = channelIcon(entry.channel);
                        const parts = gistParts(entry.gist);
                        return (
                          <div key={i} className="flex gap-3 items-start">
                            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted">
                              <ChanIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-medium text-foreground">
                                  {channelLabel(entry.channel)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  · {entry.ts}
                                </span>
                              </div>
                              {parts ? (
                                <div className="mt-0.5 space-y-0.5">
                                  <p className="text-xs text-foreground/80 leading-relaxed truncate">
                                    <span className="text-muted-foreground">
                                      You:{" "}
                                    </span>
                                    {parts.topic}
                                  </p>
                                  <p className="text-xs text-foreground/80 leading-relaxed truncate">
                                    <span className="text-muted-foreground">
                                      Elaine:{" "}
                                    </span>
                                    {parts.reply}
                                  </p>
                                </div>
                              ) : (
                                <p className="mt-0.5 text-xs text-foreground/80 leading-relaxed truncate">
                                  {entry.gist}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "Household",
                count: householdCount,
                scope: "household" as MemoryScope,
              },
              {
                label: "Personal",
                count: personalCount,
                scope: "personal" as MemoryScope,
              },
              {
                label: "Temporary",
                count: tempCount,
                scope: "temporary" as MemoryScope,
              },
            ].map(({ label, count, scope }) => {
              const ScopeIcon = SCOPE_ICONS[scope];
              return (
                <button
                  key={scope}
                  onClick={() =>
                    setScopeFilter(scopeFilter === scope ? "all" : scope)
                  }
                  className={`rounded-xl border p-3 text-left transition-all hover:border-primary/30 ${
                    scopeFilter === scope
                      ? "border-primary/40 bg-primary/5"
                      : "border-card-border bg-card"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <ScopeIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {label}
                    </span>
                  </div>
                  <p className="text-2xl font-semibold text-foreground">
                    {count}
                  </p>
                </button>
              );
            })}
          </div>

          {showAdd && (
            <AddMemoryForm
              onAdded={() => {
                refresh();
                setShowAdd(false);
              }}
              onCancel={() => setShowAdd(false)}
            />
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search memories…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="shrink-0"
              >
                Filters
                {showFilters ? (
                  <ChevronUp className="h-4 w-4 ml-1" />
                ) : (
                  <ChevronDown className="h-4 w-4 ml-1" />
                )}
              </Button>
            </div>

            {showFilters && (
              <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-muted/40 border border-card-border">
                <Select
                  value={scopeFilter}
                  onValueChange={(v) =>
                    setScopeFilter(v as "all" | MemoryScope)
                  }
                >
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_FILTER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={categoryFilter}
                  onValueChange={(v) =>
                    setCategoryFilter(v as "all" | MemoryCategory)
                  }
                >
                  <SelectTrigger className="w-40 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_FILTER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(scopeFilter !== "all" || categoryFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setScopeFilter("all");
                      setCategoryFilter("all");
                    }}
                    className="h-8 text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          {isLoading && (
            <div className="flex justify-center py-12 text-muted-foreground text-sm">
              Loading memories…
            </div>
          )}

          {!isLoading && facts.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <ElaineAvatar size={48} />
              <div>
                <p className="font-medium text-foreground">
                  Nothing remembered yet
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  As you chat with <ElaineName />, she'll build up useful
                  context about your household.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAdd(true)}
                className="mt-2"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add your first memory
              </Button>
            </div>
          )}

          {!isLoading && facts.length > 0 && filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No memories match your filters.{" "}
              <button
                onClick={() => {
                  setSearch("");
                  setScopeFilter("all");
                  setCategoryFilter("all");
                }}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Clear filters
              </button>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="space-y-2">
              {filtered.map((item) => (
                <MemoryCard
                  key={item.id}
                  item={item}
                  onDeleted={refresh}
                  onUpdated={refresh}
                />
              ))}
              {filtered.length < facts.length && (
                <p className="text-xs text-center text-muted-foreground pt-2">
                  Showing {filtered.length} of {facts.length} memories
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-card-border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Household</strong> memories
              are visible to everyone in the household.{" "}
              <strong className="text-foreground">Personal</strong> memories are
              only used in your own conversations.{" "}
              <strong className="text-foreground">Temporary</strong> memories
              expire automatically. High-sensitivity memories are shown only in
              contexts where they're explicitly relevant.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
