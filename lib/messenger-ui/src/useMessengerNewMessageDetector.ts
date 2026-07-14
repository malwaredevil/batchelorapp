import { useEffect, useRef, useCallback } from "react";
import {
  useListConversations,
  getListConversationsQueryKey,
  type MessengerConversationSummary,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

export interface NewMessageEvent {
  convId: number;
  convName: string;
  senderName: string | null;
  senderId: number | null;
  body: string;
  messageId: number;
}

interface UseMessengerNewMessageDetectorOptions {
  /** Current user — used to skip notifications for your own messages. */
  currentUserId: number;
  /** Called once per new incoming message. */
  onNewMessage: (event: NewMessageEvent) => void;
  /** Whether detection is active (pass false when messenger panel is already open). */
  enabled?: boolean;
}

export function useMessengerNewMessageDetector({
  currentUserId,
  onNewMessage,
  enabled = true,
}: UseMessengerNewMessageDetectorOptions) {
  // Map of convId -> last seen message ID; populated on first load, no toasts fired.
  const lastSeenRef = useRef<Map<number, number>>(new Map());
  const initializedRef = useRef(false);

  const { data: conversations } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: enabled ? 10_000 : false,
      enabled,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });

  const handleNewMessage = useCallback(
    (event: NewMessageEvent) => {
      onNewMessage(event);
    },
    [onNewMessage],
  );

  useEffect(() => {
    if (!conversations || conversations.length === 0) return;

    if (!initializedRef.current) {
      // First load: seed map, don't fire any toasts
      for (const conv of conversations) {
        if (conv.lastMessage) {
          lastSeenRef.current.set(conv.id, conv.lastMessage.id);
        }
      }
      initializedRef.current = true;
      return;
    }

    if (!enabled) return;

    for (const conv of conversations) {
      const lastMsg = conv.lastMessage;
      if (!lastMsg) continue;

      const prevId = lastSeenRef.current.get(conv.id) ?? 0;

      if (lastMsg.id > prevId) {
        lastSeenRef.current.set(conv.id, lastMsg.id);

        // Don't notify for your own messages
        if (lastMsg.senderId === currentUserId) continue;

        // Derive display name for DM conversations
        let convName = conv.name ?? "";
        if (conv.isDirect) {
          const other = conv.participants?.find((p) => p.id !== currentUserId);
          convName = other?.displayName ?? "Direct Message";
        }

        handleNewMessage({
          convId: conv.id,
          convName,
          senderName: lastMsg.senderName ?? null,
          senderId: lastMsg.senderId ?? null,
          body: lastMsg.deletedAt ? "" : lastMsg.body,
          messageId: lastMsg.id,
        });
      }
    }
  }, [conversations, currentUserId, enabled, handleNewMessage]);
}
