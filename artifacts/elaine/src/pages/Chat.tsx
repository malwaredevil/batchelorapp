import { useMemo } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { useElaineChat, ElaineChatPanel } from "@workspace/elaine-ui";

const URL_RE = /https?:\/\/[^\s)"'>\]]+/g;

function useSurfacedLinks(messages: { role: string; content: string }[]) {
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
    return Array.from(links.entries());
  }, [messages]);
}

/**
 * Elaine's own dedicated, ChatGPT-style full chat surface. This is the
 * "SUPER AI Agent" home for the standalone module — appId="elaine" gives
 * the model full tool access across pottery, quilting, and travels without
 * being scoped to any single sub-app's page context.
 */
export default function Chat() {
  const chat = useElaineChat({ appId: "elaine", active: true });
  const links = useSurfacedLinks(chat.messages);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-border/50 md:max-w-2xl md:mx-auto md:w-full">
          <ElaineChatPanel chat={chat} avatarSize={30} bubbleWidthClass="max-w-[75%]" />
        </div>

        <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto p-4 lg:flex">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Elaine surfaced
          </h2>
          {links.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Links and sources Elaine finds during your conversation will
              show up here.
            </p>
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
