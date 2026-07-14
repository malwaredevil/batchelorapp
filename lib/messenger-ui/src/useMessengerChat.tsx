import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListConversations,
  useGetConversationMessages,
  useSendMessage,
  useMarkMessageRead,
  useDeleteMessage,
  getGetConversationMessagesQueryKey,
  getGetUnreadCountQueryKey,
  getListConversationsQueryKey,
  type MessengerMessengerMessage,
  type MessengerSendMessageBody,
  type MessengerConversationSummary,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

export type { MessengerMessengerMessage };

export function useMessengerChat(isOpen: boolean) {
  const qc = useQueryClient();
  const [isSending, setIsSending] = useState(false);

  const { data: conversations } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: isOpen ? 5_000 : 60_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });

  const convId = conversations?.[0]?.id ?? null;

  const {
    data: messages = [],
    isFetching,
    refetch: refetchMessages,
  } = useGetConversationMessages(
    convId ?? 0,
    {},
    {
      query: {
        queryKey: getGetConversationMessagesQueryKey(convId ?? 0),
        enabled: !!convId,
        refetchInterval: isOpen ? 3_000 : 30_000,
      } as UseQueryOptions<MessengerMessengerMessage[]>,
    },
  );

  const { mutateAsync: sendMessageMutation } = useSendMessage();
  const { mutateAsync: markReadMutation } = useMarkMessageRead();
  const { mutateAsync: deleteMessageMutation } = useDeleteMessage();

  const sendMessage = useCallback(
    async (
      body: string,
      attachments: MessengerSendMessageBody["attachments"] = [],
    ) => {
      if (!convId || !body.trim()) return;
      setIsSending(true);
      try {
        await sendMessageMutation({
          id: convId,
          data: { body: body.trim(), attachments },
        });
        qc.invalidateQueries({
          queryKey: getGetConversationMessagesQueryKey(convId),
        });
        qc.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
        qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      } finally {
        setIsSending(false);
      }
    },
    [convId, sendMessageMutation, qc],
  );

  const markRead = useCallback(
    async (messageId: number) => {
      try {
        await markReadMutation({ id: messageId });
        qc.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
        qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      } catch {
        // best-effort
      }
    },
    [markReadMutation, qc],
  );

  const deleteMessage = useCallback(
    async (messageId: number) => {
      await deleteMessageMutation({ id: messageId });
      if (convId) {
        qc.invalidateQueries({
          queryKey: getGetConversationMessagesQueryKey(convId),
        });
      }
    },
    [deleteMessageMutation, qc, convId],
  );

  return {
    convId,
    messages: messages as MessengerMessengerMessage[],
    isLoading: isFetching && messages.length === 0,
    isSending,
    sendMessage,
    markRead,
    deleteMessage,
    refetchMessages,
  };
}
