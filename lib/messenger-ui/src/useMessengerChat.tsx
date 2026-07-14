import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListConversations,
  useGetConversationMessages,
  useSendMessage,
  useMarkMessageRead,
  useDeleteMessage,
  useEditMessage,
  useClearConversation,
  getGetConversationMessagesQueryKey,
  getGetUnreadCountQueryKey,
  getListConversationsQueryKey,
  type MessengerMessengerMessage,
  type MessengerSendMessageBody,
  type MessengerConversationSummary,
} from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

export type { MessengerMessengerMessage };

export function useMessengerChat(isOpen: boolean, conversationId?: number) {
  const qc = useQueryClient();
  const [isSending, setIsSending] = useState(false);

  const { data: conversations } = useListConversations({
    query: {
      queryKey: getListConversationsQueryKey(),
      refetchInterval: isOpen ? 5_000 : 60_000,
    } as UseQueryOptions<MessengerConversationSummary[]>,
  });

  // Use explicit conversationId if provided; otherwise fall back to first
  // non-archived conversation (widget compatibility).
  const firstActiveId = conversations?.find((c) => !c.archivedAt)?.id ?? null;
  const convId = conversationId ?? firstActiveId;

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
  const { mutateAsync: editMessageMutation } = useEditMessage();
  const { mutateAsync: clearConversationMutation } = useClearConversation();

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

  const editMessage = useCallback(
    async (messageId: number, body: string) => {
      await editMessageMutation({ id: messageId, data: { body } });
      if (convId) {
        qc.invalidateQueries({
          queryKey: getGetConversationMessagesQueryKey(convId),
        });
      }
    },
    [editMessageMutation, qc, convId],
  );

  const clearConversation = useCallback(async () => {
    if (!convId) return;
    await clearConversationMutation({ id: convId });
    qc.invalidateQueries({
      queryKey: getGetConversationMessagesQueryKey(convId),
    });
    qc.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
    qc.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [clearConversationMutation, qc, convId]);

  return {
    convId,
    messages: messages as MessengerMessengerMessage[],
    isLoading: isFetching && messages.length === 0,
    isSending,
    sendMessage,
    markRead,
    deleteMessage,
    editMessage,
    clearConversation,
    refetchMessages,
  };
}
