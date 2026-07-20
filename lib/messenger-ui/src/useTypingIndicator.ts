import { useEffect, useRef, useState } from "react";

/**
 * Sends a "typing" ping while the user is composing, and polls the server
 * every 800 ms to find out who else is currently typing in the conversation.
 *
 * Returns the display names of other users currently typing.
 * Uses raw fetch (fire-and-forget ping + manual polling interval) rather than
 * generated React Query hooks so it doesn't trigger loading-state re-renders.
 */
export function useTypingIndicator(
  conversationId: number | undefined,
  input: string,
): string[] {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const pingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced outgoing ping — fire when the user changes the input value.
  // Cleared immediately when input empties (user sent or deleted their draft).
  useEffect(() => {
    if (!conversationId) return;
    if (!input) {
      if (pingRef.current) {
        clearTimeout(pingRef.current);
        pingRef.current = null;
      }
      return;
    }
    if (pingRef.current) clearTimeout(pingRef.current);
    pingRef.current = setTimeout(() => {
      void fetch(`/api/messenger/conversations/${conversationId}/typing`, {
        method: "POST",
        credentials: "include",
      });
    }, 150);
    return () => {
      if (pingRef.current) clearTimeout(pingRef.current);
    };
  }, [conversationId, input]);

  // Poll who's typing every 800 ms while a conversation is open.
  useEffect(() => {
    if (!conversationId) {
      setTypingNames([]);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/messenger/conversations/${conversationId}/typing`,
          { credentials: "include" },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          typing: Array<{ userId: number; displayName: string }>;
        };
        if (!cancelled) {
          setTypingNames(data.typing.map((t) => t.displayName));
        }
      } catch {
        // network blip — silently ignore, next poll will recover
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 800);

    return () => {
      cancelled = true;
      clearInterval(interval);
      setTypingNames([]);
    };
  }, [conversationId]);

  return typingNames;
}
