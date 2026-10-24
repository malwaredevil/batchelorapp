type HistoryMessage = { role: "user" | "assistant"; content: string };

/** The shared, bounded history of spoken or written communication turns. */
export function appendCommunicationHistoryTurn(
  history: HistoryMessage[],
  inputText: string,
  replyText: string,
): HistoryMessage[] {
  return [
    ...history,
    { role: "user" as const, content: inputText },
    { role: "assistant" as const, content: replyText },
  ].slice(-20);
}
