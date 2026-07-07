import { useMemo, useState, useCallback } from "react";
import {
  ExternalLink,
  ImageIcon,
  Link2,
  Plus,
  Search,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { getTripPhotoImageUrl } from "@workspace/api-client-react";
import {
  useListElaineConversations,
  useDeleteElaineConversation,
  type ConversationMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListElaineConversationsQueryKey,
} from "@workspace/api-client-react";
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
  const [loadingConvId, setLoadingConvId] = useState<number | null>(null);

  const { data: conversations = [] } = useListElaineConversations({
    query: {
      queryKey: getListElaineConversationsQueryKey(),
      refetchOnWindowFocus: false,
    },
  });
  const deleteConversation = useDeleteElaineConversation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListElaineConversationsQueryKey() });
      },
    },
  });

  const filteredConversations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.preview?.toLowerCase().includes(q) ?? false),
    );
  }, [conversations, searchQuery]);

  const handleSelectConversation = useCallback(
    async (id: number) => {
      if (loadingConvId === id) return;
      setLoadingConvId(id);
      try {
        const res = await fetch(`/api/elaine/conversations/${id}/messages`);
        if (!res.ok) throw new Error("Failed to load conversation");
        const msgs = (await res.json()) as ConversationMessage[];
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
            {filteredConversations.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {searchQuery ? "No results" : "No conversations yet"}
              </p>
            )}
            {filteredConversations.map((conv) => {
              const isActive = chat.conversationId === conv.id;
              const isLoading = loadingConvId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group relative flex cursor-pointer items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/60 ${
                    isActive ? "bg-muted" : ""
                  }`}
                  onClick={() => void handleSelectConversation(conv.id)}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-xs font-medium leading-snug ${
                        isActive
                          ? "text-foreground"
                          : "text-foreground/80"
                      }`}
                    >
                      {isLoading ? "Loading…" : conv.title}
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
