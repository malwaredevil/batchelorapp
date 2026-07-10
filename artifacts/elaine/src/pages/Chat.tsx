import {
  useMemo,
  useState,
  useCallback,
  useDeferredValue,
  useRef,
  useEffect,
} from "react";
import {
  ExternalLink,
  ImageIcon,
  Link2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { getTripPhotoImageUrl } from "@workspace/api-client-react";
import {
  getElaineConversationMessagesFn,
  getElaineDailyBriefQueryKey,
  getListElaineConversationsQueryKey,
  useDeleteElaineConversation,
  useDismissElaineDailyBrief,
  useGetElaineDailyBrief,
  useListElaineConversations,
  useRegenerateElaineDailyBrief,
  useRenameElaineConversation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useFullChat } from "@/lib/useFullChat";
import { FullChatPanel } from "@/components/FullChatPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const URL_RE = /https?:\/\/[^\s)"'>\]]+/g;

function useSurfacedContent(
  messages: { role: string; content: string }[],
  magnetResult: ReturnType<typeof useFullChat>["magnetResult"],
) {
  return useMemo(() => {
    const links = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const matches = msg.content.match(URL_RE);
      if (!matches) continue;
      for (const raw of matches) {
        const url = raw.replace(/[.,;:]+$/, "");
        if (!links.has(url)) {
          let host = url;
          try {
            host = new URL(url).hostname.replace(/^www\./, "");
          } catch {
            // keep raw url as label if it doesn't parse
          }
          links.set(url, host);
        }
      }
    }

    const images =
      magnetResult?.matches.map((match) => ({
        src: getTripPhotoImageUrl(match.tripId, match.photoId),
        tripId: match.tripId,
        tripTitle: match.tripTitle,
      })) ?? [];

    return { links: Array.from(links.entries()), images };
  }, [messages, magnetResult]);
}

function formatConversationDate(iso: string): string {
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

/**
 * Elaine's own dedicated, ChatGPT-style full chat surface. This is the
 * "SUPER AI Agent" home for the standalone module — appId="elaine" gives
 * the model full tool access across pottery, quilting, and travels without
 * being scoped to any single sub-app's page context. The surfaced-links
 * sidebar and the travels magnet-duplicate-check tool live here too (moved
 * from travels' local full-screen page); they naturally stay empty/inactive
 * unless the conversation touches travel/magnet data.
 */
export default function Chat() {
  const chat = useFullChat({ active: true });
  const { links, images } = useSurfacedContent(
    chat.messages,
    chat.magnetResult,
  );
  const hasSidePanelContent = links.length > 0 || images.length > 0;
  const qc = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  // useDeferredValue delays the query sent to the server by one render cycle,
  // preventing a fetch on every keystroke.
  const deferredSearch = useDeferredValue(searchQuery.trim() || undefined);
  const [loadingConvId, setLoadingConvId] = useState<number | null>(null);
  const [editingConvId, setEditingConvId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: conversations = [] } = useListElaineConversations({
    q: deferredSearch,
    query: {
      queryKey: getListElaineConversationsQueryKey(deferredSearch),
      refetchOnWindowFocus: false,
    },
  });
  const deleteConversation = useDeleteElaineConversation({
    mutation: {
      onSuccess: () => {
        // Invalidate both the unfiltered list and any active search result.
        void qc.invalidateQueries({
          queryKey: getListElaineConversationsQueryKey(),
        });
      },
    },
  });
  const renameConversation = useRenameElaineConversation({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getListElaineConversationsQueryKey(),
        });
      },
    },
  });

  useEffect(() => {
    if (editingConvId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingConvId]);

  const startEditing = useCallback((id: number, currentTitle: string) => {
    setEditingConvId(id);
    setEditingTitle(currentTitle);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingConvId(null);
    setEditingTitle("");
  }, []);

  const commitEditing = useCallback(
    (id: number) => {
      const trimmed = editingTitle.trim();
      setEditingConvId(null);
      if (!trimmed) return;
      renameConversation.mutate({ id, title: trimmed });
    },
    [editingTitle, renameConversation],
  );

  // Daily morning brief
  const { data: brief, isLoading: briefLoading } = useGetElaineDailyBrief();
  const dismissBrief = useDismissElaineDailyBrief({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getElaineDailyBriefQueryKey() });
      },
    },
  });
  const regenerateBrief = useRegenerateElaineDailyBrief({
    mutation: {
      onSuccess: (data) => {
        qc.setQueryData(getElaineDailyBriefQueryKey(), data);
      },
    },
  });
  const showBrief = brief != null && !brief.dismissed;

  const handleSelectConversation = useCallback(
    async (id: number) => {
      if (loadingConvId === id) return;
      setLoadingConvId(id);
      try {
        const msgs = await getElaineConversationMessagesFn(id);
        chat.handleLoadConversation(id, msgs);
      } catch {
        // If load fails, just clear to a new conversation
        chat.handleNewConversation();
      } finally {
        setLoadingConvId(null);
      }
    },
    [chat, loadingConvId],
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Daily morning brief — spans full width above all three panels */}
      {briefLoading && (
        <div className="shrink-0 border-b border-amber-200/50 bg-amber-50/60 px-6 py-3 dark:border-amber-900/30 dark:bg-amber-950/15">
          <div className="flex items-center gap-2.5 text-sm text-amber-700/60 dark:text-amber-300/40">
            <Sun className="h-4 w-4 animate-pulse" />
            <span>Preparing your morning brief…</span>
          </div>
        </div>
      )}
      {!briefLoading && showBrief && (
        <div className="shrink-0 border-b border-amber-200/50 bg-amber-50/60 px-6 py-3 dark:border-amber-900/30 dark:bg-amber-950/15">
          <div className="flex items-start gap-3">
            <Sun className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="flex-1 text-sm leading-relaxed text-foreground">
              {brief.content}
            </p>
            <div className="flex shrink-0 items-center gap-1 pl-1">
              <button
                type="button"
                onClick={() => regenerateBrief.mutate(undefined)}
                disabled={regenerateBrief.isPending}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                title="Regenerate brief"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${regenerateBrief.isPending ? "animate-spin" : ""}`}
                />
              </button>
              <button
                type="button"
                onClick={() => dismissBrief.mutate(undefined)}
                disabled={dismissBrief.isPending}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* ── Left sidebar: conversation history ──────────────────────────── */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border/50 lg:flex">
          <div className="shrink-0 border-b border-border/50 p-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
              onClick={() => chat.handleNewConversation()}
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </Button>
            <div className="relative mt-2">
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
            {conversations.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {searchQuery ? "No results" : "No conversations yet"}
              </p>
            )}
            {conversations.map((conv) => {
              const isActive = chat.conversationId === conv.id;
              const isLoading = loadingConvId === conv.id;
              const isEditing = editingConvId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group relative flex cursor-pointer items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/60 ${
                    isActive ? "bg-muted" : ""
                  }`}
                  onClick={() =>
                    !isEditing && void handleSelectConversation(conv.id)
                  }
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        ref={renameInputRef}
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => commitEditing(conv.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitEditing(conv.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEditing();
                          }
                        }}
                        className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs font-medium leading-snug text-foreground outline-none focus:border-ring"
                      />
                    ) : (
                      <p
                        className={`truncate text-xs font-medium leading-snug ${
                          isActive ? "text-foreground" : "text-foreground/80"
                        }`}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startEditing(conv.id, conv.title);
                        }}
                      >
                        {isLoading ? "Loading…" : conv.title}
                      </p>
                    )}
                    {conv.preview && (
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70 leading-snug">
                        {conv.preview}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatConversationDate(conv.updatedAt)}
                    </p>
                  </div>
                  {!isEditing && (
                    <button
                      type="button"
                      className="invisible ml-1 mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:visible group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(conv.id, conv.title);
                      }}
                      title="Rename conversation"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="invisible ml-1 mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:visible group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation.mutate(conv.id, {
                        onSuccess: () => {
                          if (isActive) chat.handleNewConversation();
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
          </div>
        </aside>

        {/* ── Main chat panel ───────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <FullChatPanel
            chat={chat}
            avatarSize={30}
            bubbleWidthClass="max-w-[75%]"
          />
        </div>

        {/* ── Right sidebar: surfaced content ───────────────────────────── */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto p-4 lg:flex">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Elaine surfaced
          </h2>
          {!hasSidePanelContent && (
            <p className="text-xs text-muted-foreground">
              Images, links, and websites Elaine finds during your conversation
              will show up here.
            </p>
          )}

          {images.length > 0 && (
            <div className="mb-5 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                Images
              </p>
              <div className="grid grid-cols-2 gap-2">
                {images.map((img, i) => (
                  <a key={i} href={`/travels/trips/${img.tripId}`}>
                    <div className="group overflow-hidden rounded-lg border border-border/50">
                      <img
                        src={img.src}
                        alt={img.tripTitle}
                        className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
                      />
                      <p className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">
                        {img.tripTitle}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {links.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                Websites & sources
              </p>
              <ul className="space-y-1.5">
                {links.map(([url, host]) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1.5 rounded-lg border border-border/50 px-2.5 py-2 text-xs transition-colors hover:border-primary/30 hover:bg-muted/50"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-foreground">{host}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
