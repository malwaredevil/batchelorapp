import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink, ImageIcon, Link2 } from "lucide-react";
import { getTripPhotoImageUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  ElaineAvatar,
  ElaineWordmark,
} from "@/components/assistant/ElaineAvatar";
import { useAssistantChat } from "@/components/assistant/useAssistantChat";
import { AssistantChatPanel } from "@/components/assistant/AssistantChatPanel";

const URL_RE = /https?:\/\/[^\s)"'>\]]+/g;

function useSurfacedContent(
  messages: { role: string; content: string }[],
  magnetResult: ReturnType<typeof useAssistantChat>["magnetResult"],
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

export default function ElaineChat() {
  const chat = useAssistantChat({ active: true });
  const { links, images } = useSurfacedContent(
    chat.messages,
    chat.magnetResult,
  );
  const hasSidePanelContent = links.length > 0 || images.length > 0;

  return (
    <div className="flex h-[calc(100vh-var(--header-h,0px))] min-h-[70vh] flex-col">
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3 sm:px-6">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <ElaineAvatar size={32} />
        <ElaineWordmark className="text-xl" />
        <span className="text-sm text-muted-foreground">
          — focused chat, full tool access
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-border/50 md:max-w-2xl md:mx-auto md:w-full">
          <AssistantChatPanel
            chat={chat}
            avatarSize={30}
            bubbleWidthClass="max-w-[75%]"
          />
        </div>

        <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto p-4 lg:flex">
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
                  <Link key={i} href={`/trips/${img.tripId}`}>
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
                  </Link>
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
